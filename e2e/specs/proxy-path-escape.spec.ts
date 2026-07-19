import http from 'node:http'
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test'

import { kindClusterName } from '../env'

// Regression test for the Critical proxy path-escape vulnerability (CVE review C1).
//
// Exploit chain being reproduced:
//   1. Gin exposes the decoded %2e%2e segments through the proxy catch-all.
//   2. kube/proxy.go passed the decoded path to url.JoinPath, which lexically
//      cleans .. and lets the attacker escape the /proxy/ segment.
//   3. The cleaned URL (e.g. /api/v1/namespaces/kube-system/secrets) is sent
//      to the Kubernetes API server using Kite's own SA credentials
//      (charts/kite/values.yaml grants resources:["*"], verbs:["*"]).
//   4. handler.go only checks pods/services:get on the source namespace,
//      so a reader with pods:get in "default" can read secrets in kube-system.
//
// This test currently FAILS on vulnerable builds (status 200 + SecretList body)
// and PASSES once the escape is blocked. The failing assertion message includes
// the response body so the leak is visible in CI output.

async function expectStatus(response: APIResponse, status: number) {
  const text = await response.text()
  expect(response.status(), text).toBe(status)
}

async function expectForbidden(response: APIResponse, expected: string[]) {
  const body = await response.text()
  expect(response.status(), body).toBe(403)
  const parsed = JSON.parse(body) as { error: string }
  for (const value of expected) {
    expect(parsed.error).toContain(value)
  }
}

interface RawResponse {
  status: number
  body: string
  headers: http.IncomingHttpHeaders
}

// sendRawHTTP sends a request with full control over the request-line path,
// which Playwright's APIRequestContext may normalise (collapsing %2e%2e).
async function sendRawHTTP(
  baseURL: string,
  method: string,
  path: string,
  cookieHeader: string
): Promise<RawResponse> {
  const url = new URL(baseURL)
  return new Promise<RawResponse>((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? '443' : '80'),
        method,
        path,
        headers: { Cookie: cookieHeader },
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            headers: res.headers,
          })
        )
      }
    )
    req.on('error', reject)
    req.end()
  })
}

test('proxy path escape via encoded .. cannot bypass RBAC to read secrets', async ({
  request,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL
  if (typeof baseURL !== 'string') {
    throw new Error('Playwright baseURL is required')
  }

  const suffix = Date.now().toString(36)
  const username = `e2e-proxy-${suffix}`
  const password = 'E2Eproxy!2345'
  const roleName = `e2e-proxy-role-${suffix}`
  const podName = `e2e-proxy-pod-${suffix}`
  const secretName = `e2e-proxy-secret-${suffix}`
  const secretProofKey = 'proof'
  // base64("proxy-escape-proof-<suffix>") — recognisable payload so we can
  // detect it in a leaked SecretList body.
  const secretProofValue = Buffer.from(`proxy-escape-proof-${suffix}`).toString(
    'base64'
  )

  const clusterName = kindClusterName.startsWith('kind-')
    ? kindClusterName
    : `kind-${kindClusterName}`
  const clusterPath = `/api/v1/_clusters/${encodeURIComponent(clusterName)}`
  const podPath = `${clusterPath}/pods/default/${podName}`
  const secretPath = `${clusterPath}/secrets/kube-system/${secretName}`

  let userId: number | undefined
  let roleId: number | undefined
  let podCreated = false
  let secretCreated = false
  let readerRequest: APIRequestContext | undefined

  try {
    // --- Setup: low-privilege reader with pods:get in default only -------------
    const createdUser = await request.post('/api/v1/admin/users/', {
      data: { username, password, name: 'Proxy Escape Reader' },
    })
    expect(createdUser.status(), await createdUser.text()).toBe(201)
    userId = (await createdUser.json()).id as number

    const createdRole = await request.post('/api/v1/admin/roles/', {
      data: {
        name: roleName,
        description: 'pods:get in default only — must NOT reach secrets',
        clusters: [clusterName],
        namespaces: ['default'],
        resources: ['pods'],
        verbs: ['get'],
      },
    })
    expect(createdRole.status(), await createdRole.text()).toBe(201)
    roleId = (await createdRole.json()).role.id as number

    await expectStatus(
      await request.post(`/api/v1/admin/roles/${roleId}/assign`, {
        data: { subjectType: 'user', subject: username },
      }),
      201
    )

    // --- Setup: a pod in default the reader can legitimately "get" ------------
    const createdPod = await request.post(`${clusterPath}/pods/default`, {
      data: {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: podName, labels: { 'e2e.kite.io/test': suffix } },
        spec: {
          containers: [
            { name: 'pause', image: 'registry.k8s.io/pause:3.10.1' },
          ],
        },
      },
    })
    expect(createdPod.status(), await createdPod.text()).toBe(201)
    podCreated = true

    // --- Setup: a secret in kube-system the reader must NOT see ----------------
    const createdSecret = await request.post(
      `${clusterPath}/secrets/kube-system`,
      {
        data: {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: { name: secretName, namespace: 'kube-system' },
          type: 'Opaque',
          data: { [secretProofKey]: secretProofValue },
        },
      }
    )
    expect(createdSecret.status(), await createdSecret.text()).toBe(201)
    secretCreated = true

    // Wait for the pod to be reportable via get (controller-runtime cache lag).
    await expect
      .poll(async () => (await request.get(podPath)).status())
      .toBe(200)

    // --- Login as reader -------------------------------------------------------
    readerRequest = await playwrightRequest.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    })
    await expectStatus(
      await readerRequest.post('/api/auth/login/password', {
        data: { username, password },
      }),
      204
    )

    // --- Baseline: reader CAN get the pod in default --------------------------
    await expectStatus(await readerRequest.get(podPath), 200)

    // --- Baseline: reader CANNOT list/get secrets in kube-system --------------
    // Direct RBAC check — this is what the proxy escape must NOT bypass.
    await expectForbidden(
      await readerRequest.get(`${clusterPath}/secrets/kube-system`),
      ['get secrets', 'namespace kube-system', clusterName]
    )
    await expectForbidden(await readerRequest.get(secretPath), [
      'get secrets',
      'namespace kube-system',
      clusterName,
    ])

    // Extract the auth cookie for a raw HTTP request. Playwright's
    // APIRequestContext may normalise %2e%2e in the URL; we need the raw
    // bytes to reach Gin without client-side path normalization.
    const storage = await readerRequest.storageState()
    const cookieHeader = storage.cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ')
    expect(cookieHeader).toContain('auth_token=')

    // --- Exploit: encoded .. to escape /proxy/ → /api/v1/namespaces/kube-system/secrets
    //
    // URL sent to Kite:
    //   /api/v1/_clusters/<cluster>/namespaces/default/pods/<pod>/proxy/%2e%2e/%2e%2e/%2e%2e/%2e%2e/kube-system/secrets
    //
    // Gin exposes the decoded .. segments to kube/proxy.go, which previously
    // called url.JoinPath(host, "api/v1/namespaces", "default", "pods", <pod>,
    // "proxy", "/../../../../kube-system/secrets") and cleaned it to
    //   <k8s-api-host>/api/v1/namespaces/kube-system/secrets
    // and is sent under Kite's SA (cluster-admin by default chart).
    const dotdot = '%2e%2e'
    const escapeDepth = 4 // proxy -> pods -> default -> namespaces/
    const exploitPath = `${clusterPath}/namespaces/default/pods/${encodeURIComponent(
      podName
    )}/proxy/${Array(escapeDepth).fill(dotdot).join('/')}/kube-system/secrets`

    const exploitResponse = await sendRawHTTP(
      baseURL,
      'GET',
      exploitPath,
      cookieHeader
    )

    // --- Assertion: the escape MUST be blocked --------------------------------
    // On the vulnerable build this fails with status 200 and a SecretList body
    // containing our proof secret — that failure IS the reproduction.
    expect(
      exploitResponse.status,
      `Proxy path escape was not blocked.\n` +
        `  Exploit URL path: ${exploitPath}\n` +
        `  Expected status: >= 400 (RBAC denial or bad request)\n` +
        `  Actual status:   ${exploitResponse.status}\n` +
        `  Response body preview: ${exploitResponse.body.slice(0, 500)}`
    ).toBeGreaterThanOrEqual(400)

    // Defence-in-depth: even if the status check is relaxed, the proof secret
    // must never appear in the response body.
    expect(
      exploitResponse.body,
      'Proof secret value leaked through proxy path escape'
    ).not.toContain(secretProofValue)
    expect(
      exploitResponse.body,
      'Proof secret name leaked through proxy path escape'
    ).not.toContain(secretName)

    // --- Also verify escape to cluster-scoped /api/v1/secrets is blocked ------
    // 5 levels of .. reaches /api/v1/secrets (cluster-wide secret list).
    const clusterScopedPath = `${clusterPath}/namespaces/default/pods/${encodeURIComponent(
      podName
    )}/proxy/${Array(escapeDepth + 1)
      .fill(dotdot)
      .join('/')}/secrets`
    const clusterScopedResponse = await sendRawHTTP(
      baseURL,
      'GET',
      clusterScopedPath,
      cookieHeader
    )
    expect(
      clusterScopedResponse.status,
      `Cluster-scoped proxy escape was not blocked.\n` +
        `  Exploit URL path: ${clusterScopedPath}\n` +
        `  Actual status:   ${clusterScopedResponse.status}\n` +
        `  Response body preview: ${clusterScopedResponse.body.slice(0, 500)}`
    ).toBeGreaterThanOrEqual(400)
    expect(clusterScopedResponse.body).not.toContain(secretProofValue)
    expect(clusterScopedResponse.body).not.toContain(secretName)

    // --- Sanity: a legitimate (non-escaping) proxy path is still usable ------
    // The pod runs pause, so Kubernetes may return an upstream 400/404/503.
    // Verify the request was not rejected by Kite's proxy-path validation or
    // RBAC before reaching Kubernetes.
    const legitimatePath = `${clusterPath}/namespaces/default/pods/${encodeURIComponent(
      podName
    )}/proxy/`
    const legitimateResponse = await sendRawHTTP(
      baseURL,
      'GET',
      legitimatePath,
      cookieHeader
    )
    expect(
      legitimateResponse.status,
      `Legitimate proxy access was blocked by the fix.\n` +
        `  Path: ${legitimatePath}\n` +
        `  Status: ${legitimateResponse.status}\n` +
        `  Body: ${legitimateResponse.body.slice(0, 200)}`
    ).not.toBe(403)
    expect(legitimateResponse.body).not.toContain('invalid proxy path')
  } finally {
    // --- Cleanup --------------------------------------------------------------
    if (podCreated) {
      await request.delete(`${podPath}?wait=false`).catch(() => undefined)
    }
    if (secretCreated) {
      await request.delete(`${secretPath}?wait=false`).catch(() => undefined)
    }
    if (userId !== undefined) {
      await request
        .delete(`/api/v1/admin/users/${userId}`)
        .catch(() => undefined)
    }
    if (roleId !== undefined) {
      await request
        .delete(`/api/v1/admin/roles/${roleId}`)
        .catch(() => undefined)
    }
    await readerRequest?.dispose()
  }
})
