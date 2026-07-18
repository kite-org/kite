import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test'

import { adminUser, kindClusterName } from '../env'

interface GeneralSetting {
  aiAgentEnabled: boolean
  aiProvider: string
  aiModel: string
  aiApiKeyConfigured: boolean
  aiBaseUrl: string
  aiMaxTokens: number
  kubectlEnabled: boolean
  kubectlImage: string
  nodeTerminalImage: string
  enableAnalytics: boolean
  enableVersionCheck: boolean
  passwordLoginDisabled: boolean
  enableMFA: boolean
  enablePasskeyLogin: boolean
  loginPrompt: string
}

interface LDAPSetting {
  enabled: boolean
  serverUrl: string
  useStartTLS: boolean
  bindDn: string
  bindPasswordConfigured: boolean
  userBaseDn: string
  userFilter: string
  usernameAttribute: string
  displayNameAttribute: string
  groupBaseDn: string
  groupFilter: string
  groupNameAttribute: string
}

async function expectJSON<T>(response: APIResponse, status: number) {
  const text = await response.text()
  expect(response.status(), text).toBe(status)
  return JSON.parse(text) as T
}

async function expectStatus(response: APIResponse, status: number) {
  const text = await response.text()
  expect(response.status(), text).toBe(status)
}

async function expectForbidden(response: APIResponse, expected: string[]) {
  const body = await expectJSON<{ error: string }>(response, 403)
  for (const value of expected) {
    expect(body.error).toContain(value)
  }
}

test('backend APIs work end to end against the real test environment', async ({
  request,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL
  if (typeof baseURL !== 'string') {
    throw new Error('Playwright baseURL is required')
  }

  const suffix = Date.now().toString(36)
  const username = `e2e-api-user-${suffix}`
  const password = 'E2EApi!2345'
  const resetPassword = 'E2EApi!3456'
  const finalPassword = 'E2EApi!4567'
  const roleName = `e2e-api-role-${suffix}`
  const decoyRoleName = `e2e-api-decoy-${suffix}`
  const apiKeyName = `e2e-api-key-${suffix}`
  const templateName = `e2e-api-template-${suffix}`
  const oauthProviderName = `e2e-oauth-${suffix}`
  const dummyClusterName = `e2e-api-cluster-${suffix}`
  const helmRepositoryName = `e2e-api-helm-${suffix}`
  const configMapName = `e2e-api-config-${suffix}`
  const deniedConfigMapName = `e2e-api-denied-${suffix}`
  const blockedConfigMapName = `e2e-api-blocked-${suffix}`
  const podName = `e2e-api-pod-${suffix}`
  const deniedPodName = `e2e-api-pod-denied-${suffix}`
  const deploymentName = `e2e-api-deployment-${suffix}`
  const deniedDeploymentName = `e2e-api-deployment-denied-${suffix}`
  const clusterName = kindClusterName.startsWith('kind-')
    ? kindClusterName
    : `kind-${kindClusterName}`
  const clusterPath = `/api/v1/_clusters/${encodeURIComponent(clusterName)}`
  const configMapPath = `${clusterPath}/configmaps/default/${configMapName}`
  const deniedConfigMapPath = `${clusterPath}/configmaps/kube-system/${deniedConfigMapName}`
  const podPath = `${clusterPath}/pods/default/${podName}`
  const deniedPodPath = `${clusterPath}/pods/kube-system/${deniedPodName}`
  const deploymentPath = `${clusterPath}/deployments/default/${deploymentName}`
  const deniedDeploymentPath = `${clusterPath}/deployments/kube-system/${deniedDeploymentName}`

  let userId: number | undefined
  let roleId: number | undefined
  let decoyRoleId: number | undefined
  let apiKeyId: number | undefined
  let templateId: number | undefined
  let oauthProviderId: number | undefined
  let dummyClusterId: number | undefined
  let helmRepositoryId: number | undefined
  let configMapCreated = false
  let deniedConfigMapCreated = false
  let podCreated = false
  let deniedPodCreated = false
  let deploymentCreated = false
  let deniedDeploymentCreated = false
  let originalGeneralSetting: GeneralSetting | undefined
  let originalLDAPSetting: LDAPSetting | undefined
  let originalGlobalSidebarPreference = ''
  let generalSettingChanged = false
  let ldapSettingChanged = false
  let globalSidebarChanged = false
  let anonymousRequest: APIRequestContext | undefined
  let readerRequest: APIRequestContext | undefined
  let helmRepositoryServer: ReturnType<typeof createServer> | undefined

  try {
    anonymousRequest = await playwrightRequest.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    })

    await expectStatus(await anonymousRequest.get('/healthz'), 200)
    await expectStatus(await anonymousRequest.get('/metrics'), 200)
    const version = await expectJSON<{ version: string }>(
      await anonymousRequest.get('/api/v1/version'),
      200
    )
    expect(version.version).toBeTruthy()
    await expectStatus(
      await anonymousRequest.get(`${clusterPath}/configmaps/default`),
      401
    )
    await expectStatus(await anonymousRequest.get('/api/auth/user'), 401)
    await expectStatus(await anonymousRequest.post('/api/auth/refresh'), 401)
    await expectStatus(await anonymousRequest.get('/api/v1/admin/users/'), 401)
    await expectJSON(
      await anonymousRequest.post('/api/auth/setup/create_super_user', {
        data: {
          username: `blocked-admin-${suffix}`,
          password,
        },
      }),
      403
    )
    await expectJSON(await anonymousRequest.get('/api/auth/login'), 400)
    await expectJSON(
      await anonymousRequest.post('/api/auth/login/ldap', { data: {} }),
      400
    )

    const bootstrap = await expectJSON<{
      setup: { initialized: boolean }
      user: { username: string }
    }>(await request.get('/api/v1/bootstrap'), 200)
    expect(bootstrap.setup.initialized).toBe(true)
    expect(bootstrap.user.username).toBe(adminUser.username)

    const currentUser = await expectJSON<{
      user: { username: string; roles: Array<{ name: string }> }
      globalSidebarPreference: string
    }>(await request.get('/api/auth/user'), 200)
    expect(currentUser.user.username).toBe(adminUser.username)
    expect(currentUser.user.roles.map((role) => role.name)).toContain('admin')
    originalGlobalSidebarPreference = currentUser.globalSidebarPreference

    const clusters = await expectJSON<Array<{ name: string }>>(
      await request.get('/api/v1/clusters'),
      200
    )
    expect(clusters.map((cluster) => cluster.name)).toContain(clusterName)
    const adminClusters = await expectJSON<Array<{ name: string }>>(
      await request.get('/api/v1/admin/clusters/'),
      200
    )
    expect(adminClusters.map((cluster) => cluster.name)).toContain(clusterName)
    const dummyCluster = await expectJSON<{ id: number }>(
      await request.post('/api/v1/admin/clusters/', {
        data: {
          name: dummyClusterName,
          description: 'temporary backend API E2E cluster',
        },
      }),
      201
    )
    dummyClusterId = dummyCluster.id
    await expectStatus(
      await request.put(`/api/v1/admin/clusters/${dummyClusterId}`, {
        data: {
          name: dummyClusterName,
          description: 'updated backend API E2E cluster',
          enabled: false,
        },
      }),
      200
    )
    const clustersAfterUpdate = await expectJSON<
      Array<{ id: number; description: string; enabled: boolean }>
    >(await request.get('/api/v1/admin/clusters/'), 200)
    expect(
      clustersAfterUpdate.find((cluster) => cluster.id === dummyClusterId)
    ).toMatchObject({
      description: 'updated backend API E2E cluster',
      enabled: false,
    })
    await expectJSON(
      await request.post('/api/v1/admin/clusters/import', {
        data: { inCluster: true },
      }),
      403
    )
    await expectStatus(
      await request.delete(`/api/v1/admin/clusters/${dummyClusterId}`),
      200
    )
    dummyClusterId = undefined
    await expectStatus(
      await request.get('/api/v1/_clusters/missing/configmaps/default'),
      404
    )

    const generalSetting = await expectJSON<GeneralSetting>(
      await request.get('/api/v1/admin/general-setting/'),
      200
    )
    originalGeneralSetting = generalSetting
    expect(typeof generalSetting.kubectlEnabled).toBe('boolean')
    expect(typeof generalSetting.enableVersionCheck).toBe('boolean')
    const updatedGeneralSetting = await expectJSON<GeneralSetting>(
      await request.put('/api/v1/admin/general-setting/', {
        data: {
          aiAgentEnabled: false,
          enableMFA: false,
          enablePasskeyLogin: false,
          loginPrompt: `Backend API E2E ${suffix}`,
        },
      }),
      200
    )
    generalSettingChanged = true
    expect(updatedGeneralSetting).toMatchObject({
      aiAgentEnabled: false,
      enableMFA: false,
      enablePasskeyLogin: false,
      loginPrompt: `Backend API E2E ${suffix}`,
    })
    await expectJSON(
      await request.put('/api/v1/admin/general-setting/', {
        data: { aiProvider: 'unsupported-provider' },
      }),
      400
    )

    originalLDAPSetting = await expectJSON<LDAPSetting>(
      await request.get('/api/v1/admin/ldap-setting/'),
      200
    )
    const updatedLDAPSetting = await expectJSON<LDAPSetting>(
      await request.put('/api/v1/admin/ldap-setting/', {
        data: {
          ...originalLDAPSetting,
          enabled: false,
          displayNameAttribute: `cn-${suffix}`,
        },
      }),
      200
    )
    ldapSettingChanged = true
    expect(updatedLDAPSetting.displayNameAttribute).toBe(`cn-${suffix}`)

    const oauthProvider = await expectJSON<{
      provider: { id: number; name: string; clientSecret: string }
    }>(
      await request.post('/api/v1/admin/oauth-providers/', {
        data: {
          name: oauthProviderName,
          clientId: `client-${suffix}`,
          clientSecret: `secret-${suffix}`,
          authUrl: 'http://127.0.0.1/oauth/authorize',
          tokenUrl: 'http://127.0.0.1/oauth/token',
          userInfoUrl: 'http://127.0.0.1/oauth/userinfo',
          scopes: 'openid profile',
          usernameClaim: 'preferred_username',
          enabled: true,
        },
      }),
      201
    )
    oauthProviderId = oauthProvider.provider.id
    expect(oauthProvider.provider.clientSecret).toBe('***')
    const oauthProviders = await expectJSON<{
      providers: Array<{ id: number; name: string; clientSecret: string }>
    }>(await request.get('/api/v1/admin/oauth-providers/'), 200)
    expect(
      oauthProviders.providers.find(
        (provider) => provider.id === oauthProviderId
      )
    ).toMatchObject({ name: oauthProviderName, clientSecret: '***' })
    await expectStatus(
      await anonymousRequest.get(
        `/api/auth/login?provider=${encodeURIComponent(oauthProviderName)}`
      ),
      200
    )
    await expectStatus(
      await anonymousRequest.get('/api/auth/callback', { maxRedirects: 0 }),
      302
    )
    const fetchedOAuthProvider = await expectJSON<{
      provider: { id: number; name: string }
    }>(
      await request.get(`/api/v1/admin/oauth-providers/${oauthProviderId}`),
      200
    )
    expect(fetchedOAuthProvider.provider.name).toBe(oauthProviderName)
    const updatedOAuthProvider = await expectJSON<{
      provider: { id: number; enabled: boolean }
    }>(
      await request.put(`/api/v1/admin/oauth-providers/${oauthProviderId}`, {
        data: {
          name: oauthProviderName,
          clientId: `client-updated-${suffix}`,
          authUrl: 'http://127.0.0.1/oauth/authorize',
          tokenUrl: 'http://127.0.0.1/oauth/token',
          userInfoUrl: 'http://127.0.0.1/oauth/userinfo',
          scopes: 'openid',
          usernameClaim: 'sub',
          enabled: false,
        },
      }),
      200
    )
    expect(updatedOAuthProvider.provider.enabled).toBe(false)

    helmRepositoryServer = createServer((serverRequest, response) => {
      if (serverRequest.url === '/index.yaml') {
        response.writeHead(200, { 'content-type': 'application/yaml' })
        response.end(
          `apiVersion: v1\nentries: {}\ngenerated: ${new Date().toISOString()}\n`
        )
        return
      }
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>((resolve, reject) => {
      helmRepositoryServer!.once('error', reject)
      helmRepositoryServer!.listen(0, '127.0.0.1', resolve)
    })
    const helmRepositoryAddress = helmRepositoryServer.address() as AddressInfo
    const helmRepository = await expectJSON<{ id: number; name: string }>(
      await request.post('/api/v1/admin/charts/repositories', {
        data: {
          name: helmRepositoryName,
          url: `http://127.0.0.1:${helmRepositoryAddress.port}`,
        },
      }),
      201
    )
    helmRepositoryId = helmRepository.id
    const helmRepositories = await expectJSON<
      Array<{ id: number; name: string }>
    >(await request.get(`${clusterPath}/charts/repositories`), 200)
    expect(helmRepositories).toContainEqual(
      expect.objectContaining({
        id: helmRepositoryId,
        name: helmRepositoryName,
      })
    )
    const charts = await expectJSON<{ items: unknown[]; total: number }>(
      await request.get(
        `${clusterPath}/charts?repository=${encodeURIComponent(helmRepositoryName)}`
      ),
      200
    )
    expect(charts).toMatchObject({ items: [], total: 0 })
    await expectJSON(
      await request.get(
        `${clusterPath}/charts/${encodeURIComponent(helmRepositoryName)}/missing`
      ),
      404
    )
    await expectJSON(
      await request.get(
        `${clusterPath}/charts/${encodeURIComponent(helmRepositoryName)}/missing/content/invalid`
      ),
      400
    )
    await expectStatus(
      await request.delete(
        `/api/v1/admin/charts/repositories/${helmRepositoryId}`
      ),
      200
    )
    helmRepositoryId = undefined
    await new Promise<void>((resolve, reject) => {
      helmRepositoryServer!.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    helmRepositoryServer = undefined

    const template = await expectJSON<{
      id: number
      name: string
      description: string
    }>(
      await request.post('/api/v1/admin/templates/', {
        data: {
          name: templateName,
          description: 'created through backend API e2e',
          yaml: `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${templateName}\n`,
        },
      }),
      201
    )
    templateId = template.id
    expect(template.name).toBe(templateName)
    const updatedTemplate = await expectJSON<{
      id: number
      description: string
    }>(
      await request.put(`/api/v1/admin/templates/${templateId}`, {
        data: {
          description: 'updated through backend API e2e',
          yaml: `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${templateName}\ndata:\n  stage: updated\n`,
        },
      }),
      200
    )
    expect(updatedTemplate.description).toBe('updated through backend API e2e')
    const templates = await expectJSON<Array<{ id: number; name: string }>>(
      await request.get(`${clusterPath}/templates`),
      200
    )
    expect(templates.some((item) => item.id === templateId)).toBe(true)

    const apiKeyResponse = await expectJSON<{
      apiKey: { id: number; username: string; apiKey: string }
    }>(
      await request.post('/api/v1/admin/apikeys/', {
        data: { name: apiKeyName },
      }),
      201
    )
    apiKeyId = apiKeyResponse.apiKey.id
    expect(apiKeyResponse.apiKey.username).toBe(apiKeyName)
    expect(apiKeyResponse.apiKey.apiKey).toBeTruthy()
    const apiKeys = await expectJSON<{
      apiKeys: Array<{ id: number; username: string; apiKey: string }>
    }>(await request.get('/api/v1/admin/apikeys/'), 200)
    const listedAPIKey = apiKeys.apiKeys.find((item) => item.id === apiKeyId)
    expect(listedAPIKey?.username).toBe(apiKeyName)
    expect(listedAPIKey?.apiKey).toMatch(/^kite\d+-/)
    const apiKeyToken = listedAPIKey!.apiKey

    const createdUser = await expectJSON<{
      id: number
      username: string
      enabled: boolean
    }>(
      await request.post('/api/v1/admin/users/', {
        data: {
          username,
          password,
          name: 'Backend API Reader',
        },
      }),
      201
    )
    userId = createdUser.id
    expect(createdUser.username).toBe(username)
    expect(createdUser.enabled).toBe(true)
    const updatedUser = await expectJSON<{ id: number; name: string }>(
      await request.put(`/api/v1/admin/users/${userId}`, {
        data: { name: 'Updated Backend API Reader' },
      }),
      200
    )
    expect(updatedUser.name).toBe('Updated Backend API Reader')

    readerRequest = await playwrightRequest.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    })
    await expectForbidden(
      await readerRequest.post('/api/auth/login/password', {
        data: { username, password },
      }),
      ['insufficient permissions']
    )

    const createdRole = await expectJSON<{
      role: { id: number; name: string }
    }>(
      await request.post('/api/v1/admin/roles/', {
        data: {
          name: roleName,
          description: 'read ConfigMaps in default',
          clusters: [clusterName],
          namespaces: ['default'],
          resources: ['configmaps', 'pods', 'deployments'],
          verbs: ['get'],
        },
      }),
      201
    )
    roleId = createdRole.role.id
    expect(createdRole.role.name).toBe(roleName)
    const fetchedRole = await expectJSON<{
      role: { id: number; name: string }
    }>(await request.get(`/api/v1/admin/roles/${roleId}`), 200)
    expect(fetchedRole.role.name).toBe(roleName)
    const roles = await expectJSON<{
      roles: Array<{ id: number; name: string }>
    }>(await request.get('/api/v1/admin/roles/'), 200)
    expect(roles.roles).toContainEqual(
      expect.objectContaining({ id: roleId, name: roleName })
    )
    const updatedRole = await expectJSON<{
      role: { id: number; description: string }
    }>(
      await request.put(`/api/v1/admin/roles/${roleId}`, {
        data: {
          name: roleName,
          description: 'read ConfigMaps, Pods, and Deployments in default',
          clusters: [clusterName],
          namespaces: ['default'],
          resources: ['configmaps', 'pods', 'deployments'],
          verbs: ['get'],
        },
      }),
      200
    )
    expect(updatedRole.role.description).toBe(
      'read ConfigMaps, Pods, and Deployments in default'
    )
    await expectJSON(
      await request.post(`/api/v1/admin/roles/${roleId}/assign`, {
        data: { subjectType: 'user', subject: username },
      }),
      201
    )
    await expectJSON(
      await request.post(`/api/v1/admin/roles/${roleId}/assign`, {
        data: { subjectType: 'user', subject: apiKeyName },
      }),
      201
    )
    const decoyRole = await expectJSON<{
      role: { id: number; name: string }
    }>(
      await request.post('/api/v1/admin/roles/', {
        data: {
          name: decoyRoleName,
          description: 'must not combine dimensions with the reader role',
          clusters: ['not-the-active-cluster'],
          namespaces: ['kube-system'],
          resources: ['configmaps', 'pods', 'deployments'],
          verbs: ['get'],
        },
      }),
      201
    )
    decoyRoleId = decoyRole.role.id
    await expectJSON(
      await request.post(`/api/v1/admin/roles/${decoyRoleId}/assign`, {
        data: { subjectType: 'user', subject: username },
      }),
      201
    )
    await expectStatus(
      await request.delete(
        `/api/v1/admin/roles/${decoyRoleId}/assign?subjectType=user&subject=${encodeURIComponent(username)}`
      ),
      200
    )
    await expectJSON(
      await request.post(`/api/v1/admin/roles/${decoyRoleId}/assign`, {
        data: { subjectType: 'user', subject: username },
      }),
      201
    )

    const users = await expectJSON<{
      users: Array<{ id: number; username: string }>
      total: number
    }>(
      await request.get(
        `/api/v1/admin/users/?search=${encodeURIComponent(username)}`
      ),
      200
    )
    expect(users.total).toBeGreaterThanOrEqual(1)
    expect(users.users).toContainEqual(
      expect.objectContaining({ id: userId, username })
    )
    await expectStatus(
      await request.post(`/api/v1/admin/users/${userId}/enable`, {
        data: { enabled: false },
      }),
      200
    )
    await expectForbidden(
      await readerRequest.post('/api/auth/login/password', {
        data: { username, password },
      }),
      ['insufficient permissions']
    )
    await expectStatus(
      await request.post(`/api/v1/admin/users/${userId}/enable`, {
        data: { enabled: true },
      }),
      200
    )
    await expectStatus(
      await request.post(`/api/v1/admin/users/${userId}/reset_password`, {
        data: { password: resetPassword },
      }),
      200
    )
    await expectStatus(
      await readerRequest.post('/api/auth/login/password', {
        data: { username, password },
      }),
      401
    )

    const createdConfigMap = await expectJSON<{
      metadata: { name: string; namespace: string }
      data: Record<string, string>
    }>(
      await request.post(`${clusterPath}/configmaps/default`, {
        data: {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: configMapName },
          data: { stage: 'created' },
        },
      }),
      201
    )
    configMapCreated = true
    expect(createdConfigMap.metadata.name).toBe(configMapName)
    expect(createdConfigMap.metadata.namespace).toBe('default')
    const deniedConfigMap = await expectJSON<{
      metadata: { name: string; namespace: string }
    }>(
      await request.post(`${clusterPath}/configmaps/kube-system`, {
        data: {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: deniedConfigMapName },
          data: { visibility: 'denied' },
        },
      }),
      201
    )
    deniedConfigMapCreated = true
    expect(deniedConfigMap.metadata.namespace).toBe('kube-system')

    const createdPod = await expectJSON<{
      metadata: { name: string; namespace: string }
    }>(
      await request.post(`${clusterPath}/pods/default`, {
        data: {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: { name: podName, labels: { 'e2e.kite.io/test': suffix } },
          spec: {
            containers: [
              {
                name: 'pause',
                image: 'registry.k8s.io/pause:3.10.1',
              },
            ],
          },
        },
      }),
      201
    )
    podCreated = true
    expect(createdPod.metadata).toMatchObject({
      name: podName,
      namespace: 'default',
    })
    const deniedPod = await expectJSON<{
      metadata: { name: string; namespace: string }
    }>(
      await request.post(`${clusterPath}/pods/kube-system`, {
        data: {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: {
            name: deniedPodName,
            labels: { 'e2e.kite.io/test': suffix },
          },
          spec: {
            containers: [
              {
                name: 'pause',
                image: 'registry.k8s.io/pause:3.10.1',
              },
            ],
          },
        },
      }),
      201
    )
    deniedPodCreated = true
    expect(deniedPod.metadata.namespace).toBe('kube-system')

    const deploymentBody = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: deploymentName,
        labels: { 'e2e.kite.io/test': suffix },
      },
      spec: {
        replicas: 0,
        selector: { matchLabels: { app: deploymentName } },
        template: {
          metadata: { labels: { app: deploymentName } },
          spec: {
            containers: [
              {
                name: 'pause',
                image: 'registry.k8s.io/pause:3.10.1',
              },
            ],
          },
        },
      },
    }
    const createdDeployment = await expectJSON<{
      metadata: { name: string; namespace: string }
    }>(
      await request.post(`${clusterPath}/deployments/default`, {
        data: deploymentBody,
      }),
      201
    )
    deploymentCreated = true
    expect(createdDeployment.metadata).toMatchObject({
      name: deploymentName,
      namespace: 'default',
    })
    const deniedDeployment = await expectJSON<{
      metadata: { name: string; namespace: string }
    }>(
      await request.post(`${clusterPath}/deployments/kube-system`, {
        data: {
          ...deploymentBody,
          metadata: {
            name: deniedDeploymentName,
            labels: { 'e2e.kite.io/test': suffix },
          },
          spec: {
            ...deploymentBody.spec,
            selector: { matchLabels: { app: deniedDeploymentName } },
            template: {
              ...deploymentBody.spec.template,
              metadata: { labels: { app: deniedDeploymentName } },
            },
          },
        },
      }),
      201
    )
    deniedDeploymentCreated = true
    expect(deniedDeployment.metadata.namespace).toBe('kube-system')

    await expect
      .poll(async () => (await request.get(configMapPath)).status())
      .toBe(200)
    await expect
      .poll(async () => (await request.get(deniedConfigMapPath)).status())
      .toBe(200)
    await expect
      .poll(async () => (await request.get(podPath)).status())
      .toBe(200)
    await expect
      .poll(async () => (await request.get(deniedPodPath)).status())
      .toBe(200)
    await expect
      .poll(async () => (await request.get(deploymentPath)).status())
      .toBe(200)
    await expect
      .poll(async () => (await request.get(deniedDeploymentPath)).status())
      .toBe(200)
    const currentConfigMap = await expectJSON<{
      metadata: Record<string, unknown>
      data: Record<string, string>
    }>(await request.get(configMapPath), 200)
    currentConfigMap.data = { stage: 'updated' }
    const updatedConfigMap = await expectJSON<{
      data: Record<string, string>
    }>(await request.put(configMapPath, { data: currentConfigMap }), 200)
    expect(updatedConfigMap.data.stage).toBe('updated')
    const patchedConfigMap = await expectJSON<{
      data: Record<string, string>
    }>(
      await request.patch(`${configMapPath}?patchType=merge`, {
        data: { data: { patched: 'true' } },
      }),
      200
    )
    expect(patchedConfigMap.data.patched).toBe('true')

    const currentPod = await expectJSON<{
      metadata: {
        name: string
        annotations?: Record<string, string>
      }
    }>(await request.get(podPath), 200)
    currentPod.metadata.annotations = { 'e2e.kite.io/updated': 'true' }
    const updatedPod = await expectJSON<{
      metadata: { annotations: Record<string, string> }
    }>(await request.put(podPath, { data: currentPod }), 200)
    expect(updatedPod.metadata.annotations['e2e.kite.io/updated']).toBe('true')
    const patchedPod = await expectJSON<{
      metadata: { labels: Record<string, string> }
    }>(
      await request.patch(`${podPath}?patchType=merge`, {
        data: { metadata: { labels: { 'e2e.kite.io/patched': 'true' } } },
      }),
      200
    )
    expect(patchedPod.metadata.labels['e2e.kite.io/patched']).toBe('true')
    const pods = await expectJSON<{
      items: Array<{ metadata: { name: string } }>
    }>(
      await request.get(
        `${clusterPath}/pods/default?labelSelector=${encodeURIComponent(`e2e.kite.io/test=${suffix}`)}`
      ),
      200
    )
    expect(pods.items.map((pod) => pod.metadata.name)).toContain(podName)
    await expectStatus(await request.get(`${podPath}/describe`), 200)
    await expectStatus(await request.get(`${podPath}/related`), 200)
    await expectJSON(
      await request.get(
        `${clusterPath}/namespaces/default/configmaps/${configMapName}/proxy/health`
      ),
      400
    )
    await expectStatus(
      await request.get(
        `${clusterPath}/events/resources?resource=pods&namespace=default&name=${encodeURIComponent(podName)}`
      ),
      200
    )

    const currentDeployment = await expectJSON<{
      metadata: {
        name: string
        annotations?: Record<string, string>
      }
    }>(await request.get(deploymentPath), 200)
    currentDeployment.metadata.annotations = { 'e2e.kite.io/updated': 'true' }
    const updatedDeployment = await expectJSON<{
      metadata: { annotations: Record<string, string> }
    }>(await request.put(deploymentPath, { data: currentDeployment }), 200)
    expect(updatedDeployment.metadata.annotations['e2e.kite.io/updated']).toBe(
      'true'
    )
    const patchedDeployment = await expectJSON<{
      metadata: { labels: Record<string, string> }
    }>(
      await request.patch(`${deploymentPath}?patchType=merge`, {
        data: { metadata: { labels: { 'e2e.kite.io/patched': 'true' } } },
      }),
      200
    )
    expect(patchedDeployment.metadata.labels['e2e.kite.io/patched']).toBe(
      'true'
    )
    const deployments = await expectJSON<{
      items: Array<{ metadata: { name: string } }>
    }>(
      await request.get(
        `${clusterPath}/deployments/default?labelSelector=${encodeURIComponent(`e2e.kite.io/test=${suffix}`)}`
      ),
      200
    )
    expect(
      deployments.items.map((deployment) => deployment.metadata.name)
    ).toContain(deploymentName)
    await expectStatus(await request.get(`${deploymentPath}/describe`), 200)
    await expectStatus(await request.get(`${deploymentPath}/related`), 200)

    const applyResponse = await expectJSON<{
      message: string
      kind: string
      name: string
      namespace: string
    }>(
      await request.post(`${clusterPath}/resources/apply`, {
        data: {
          yaml: `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${configMapName}\n  namespace: default\ndata:\n  stage: applied\n`,
        },
      }),
      200
    )
    expect(applyResponse).toMatchObject({
      kind: 'ConfigMap',
      name: configMapName,
      namespace: 'default',
    })
    await expectJSON(
      await request.post(`${clusterPath}/resources/apply`, {
        data: { yaml: '' },
      }),
      400
    )

    const overview = await expectJSON<{
      totalNodes: number
      totalPods: number
      totalNamespaces: number
    }>(await request.get(`${clusterPath}/overview`), 200)
    expect(overview.totalNodes).toBeGreaterThan(0)
    expect(overview.totalPods).toBeGreaterThan(0)
    expect(overview.totalNamespaces).toBeGreaterThan(0)
    await expectJSON(
      await request.get(
        `${clusterPath}/prometheus/resource-usage-history?duration=invalid`
      ),
      400
    )
    await expectJSON(
      await request.get(
        `${clusterPath}/prometheus/resource-usage-history?duration=1h`
      ),
      503
    )
    await expectJSON(
      await request.get(
        `${clusterPath}/prometheus/pods/default/${podName}/metrics?duration=invalid`
      ),
      400
    )
    await expectJSON(await request.get(`${clusterPath}/image/tags`), 400)
    await expectJSON(
      await request.post(`${clusterPath}/ai/chat`, { data: {} }),
      400
    )
    await expectJSON(
      await request.post(`${clusterPath}/ai/execute/continue`, { data: {} }),
      400
    )
    await expectJSON(
      await request.post(`${clusterPath}/ai/input/continue`, { data: {} }),
      400
    )

    await expect
      .poll(async () => {
        const response = await request.get(
          `${clusterPath}/search?q=${encodeURIComponent(configMapName)}`
        )
        if (!response.ok()) return 0
        const result = (await response.json()) as { total: number }
        return result.total
      })
      .toBeGreaterThan(0)

    await expect
      .poll(async () => {
        const response = await anonymousRequest!.get(configMapPath, {
          headers: { Authorization: apiKeyToken },
        })
        return response.status()
      })
      .toBe(200)
    const apiKeyUser = await expectJSON<{
      user: { username: string; roles: Array<{ name: string }> }
    }>(
      await anonymousRequest.get('/api/auth/user', {
        headers: { Authorization: apiKeyToken },
      }),
      200
    )
    expect(apiKeyUser.user.username).toBe(apiKeyName)
    expect(apiKeyUser.user.roles.map((role) => role.name)).toContain(roleName)
    await expectForbidden(
      await anonymousRequest.get('/api/v1/admin/users/', {
        headers: { Authorization: apiKeyToken },
      }),
      ['Admin role required']
    )
    await expectStatus(
      await anonymousRequest.get('/api/auth/user', {
        headers: { Authorization: 'kite-invalid' },
      }),
      401
    )

    await expect
      .poll(async () => {
        const response = await readerRequest!.post('/api/auth/login/password', {
          data: { username, password: resetPassword },
        })
        return response.status()
      })
      .toBe(204)
    const readerUser = await expectJSON<{
      user: { username: string; roles: Array<{ name: string }> }
    }>(await readerRequest.get('/api/auth/user'), 200)
    expect(readerUser.user.username).toBe(username)
    expect(readerUser.user.roles.map((role) => role.name)).toEqual(
      expect.arrayContaining([roleName, decoyRoleName])
    )

    const updatedCurrentUser = await expectJSON<{ name: string }>(
      await readerRequest.put('/api/users/me', {
        data: { name: 'Reader Updated Through API' },
      }),
      200
    )
    expect(updatedCurrentUser.name).toBe('Reader Updated Through API')
    await expectStatus(
      await request.delete('/api/v1/admin/sidebar_preference/global'),
      200
    )
    globalSidebarChanged = true
    await expectStatus(
      await readerRequest.post('/api/users/sidebar_preference', {
        data: { sidebar_preference: '{"reader":true}' },
      }),
      200
    )
    await expectStatus(
      await request.post('/api/v1/admin/sidebar_preference/global', {
        data: { sidebar_preference: '{"global":true}' },
      }),
      200
    )
    await expectForbidden(
      await readerRequest.post('/api/users/sidebar_preference', {
        data: { sidebar_preference: '{"blocked":true}' },
      }),
      ['sidebar customization is disabled']
    )
    if (originalGlobalSidebarPreference) {
      await expectStatus(
        await request.post('/api/v1/admin/sidebar_preference/global', {
          data: { sidebar_preference: originalGlobalSidebarPreference },
        }),
        200
      )
    } else {
      await expectStatus(
        await request.delete('/api/v1/admin/sidebar_preference/global'),
        200
      )
    }
    globalSidebarChanged = false

    await expectForbidden(
      await readerRequest.post('/api/users/me/mfa/setup', {
        data: { current_password: resetPassword },
      }),
      ['mfa is disabled']
    )
    await expectForbidden(
      await readerRequest.post('/api/users/me/mfa/enable', {
        data: { code: '000000' },
      }),
      ['mfa is disabled']
    )
    await expectForbidden(
      await readerRequest.post('/api/users/me/mfa/disable', {
        data: { code: '000000' },
      }),
      ['mfa is disabled']
    )
    await expectForbidden(await readerRequest.get('/api/users/me/passkeys'), [
      'passkey login is disabled',
    ])
    await expectForbidden(
      await readerRequest.post('/api/users/me/passkeys/begin', {
        data: { name: 'blocked', current_password: resetPassword },
      }),
      ['passkey login is disabled']
    )
    await expectForbidden(
      await readerRequest.post('/api/users/me/passkeys/finish', { data: {} }),
      ['passkey login is disabled']
    )
    await expectForbidden(
      await readerRequest.delete('/api/users/me/passkeys/1'),
      ['passkey login is disabled']
    )
    await expectForbidden(
      await anonymousRequest.post('/api/auth/passkey/login/begin'),
      ['passkey login is disabled']
    )
    await expectForbidden(
      await anonymousRequest.post('/api/auth/passkey/login/finish', {
        data: {},
      }),
      ['passkey login is disabled']
    )
    await expectStatus(
      await readerRequest.post('/api/users/me/password', {
        data: {
          current_password: resetPassword,
          new_password: finalPassword,
        },
      }),
      200
    )

    const allowedList = await expectJSON<{
      items: Array<{ metadata: { name: string; namespace: string } }>
    }>(await readerRequest.get(`${clusterPath}/configmaps/default`), 200)
    expect(
      allowedList.items.some(
        (item) =>
          item.metadata.name === configMapName &&
          item.metadata.namespace === 'default'
      )
    ).toBe(true)
    await expectStatus(await readerRequest.get(configMapPath), 200)

    await expectForbidden(
      await readerRequest.get(`${clusterPath}/configmaps/kube-system`),
      ['get configmaps', 'namespace kube-system', clusterName]
    )
    await expectForbidden(await readerRequest.get(deniedConfigMapPath), [
      'get configmaps',
      'namespace kube-system',
      clusterName,
    ])
    await expectForbidden(
      await readerRequest.get(
        `${clusterPath}/configmaps/_all/${configMapName}`
      ),
      ['get configmaps', 'namespace All', clusterName]
    )

    const allConfigMaps = await expectJSON<{
      items: Array<{ metadata: { name: string; namespace: string } }>
    }>(await readerRequest.get(`${clusterPath}/configmaps/_all`), 200)
    expect(allConfigMaps.items.length).toBeGreaterThan(0)
    expect(
      allConfigMaps.items.every((item) => item.metadata.namespace === 'default')
    ).toBe(true)
    expect(
      allConfigMaps.items.some((item) => item.metadata.name === configMapName)
    ).toBe(true)
    expect(
      allConfigMaps.items.some(
        (item) => item.metadata.name === deniedConfigMapName
      )
    ).toBe(false)

    const allowedPods = await expectJSON<{
      items: Array<{ metadata: { name: string; namespace: string } }>
    }>(await readerRequest.get(`${clusterPath}/pods/default`), 200)
    expect(allowedPods.items).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          name: podName,
          namespace: 'default',
        }),
      })
    )
    await expectStatus(await readerRequest.get(podPath), 200)
    await expectForbidden(
      await readerRequest.get(`${clusterPath}/pods/kube-system`),
      ['get pods', 'namespace kube-system', clusterName]
    )
    await expectForbidden(await readerRequest.get(deniedPodPath), [
      'get pods',
      'namespace kube-system',
      clusterName,
    ])
    const allPods = await expectJSON<{
      items: Array<{ metadata: { name: string; namespace: string } }>
    }>(await readerRequest.get(`${clusterPath}/pods/_all`), 200)
    expect(
      allPods.items.every((pod) => pod.metadata.namespace === 'default')
    ).toBe(true)
    expect(allPods.items.some((pod) => pod.metadata.name === podName)).toBe(
      true
    )
    expect(
      allPods.items.some((pod) => pod.metadata.name === deniedPodName)
    ).toBe(false)

    const allowedDeployments = await expectJSON<{
      items: Array<{ metadata: { name: string; namespace: string } }>
    }>(await readerRequest.get(`${clusterPath}/deployments/default`), 200)
    expect(allowedDeployments.items).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          name: deploymentName,
          namespace: 'default',
        }),
      })
    )
    await expectStatus(await readerRequest.get(deploymentPath), 200)
    await expectForbidden(
      await readerRequest.get(`${clusterPath}/deployments/kube-system`),
      ['get deployments', 'namespace kube-system', clusterName]
    )
    await expectForbidden(await readerRequest.get(deniedDeploymentPath), [
      'get deployments',
      'namespace kube-system',
      clusterName,
    ])
    const allDeployments = await expectJSON<{
      items: Array<{ metadata: { name: string; namespace: string } }>
    }>(await readerRequest.get(`${clusterPath}/deployments/_all`), 200)
    expect(
      allDeployments.items.every(
        (deployment) => deployment.metadata.namespace === 'default'
      )
    ).toBe(true)
    expect(
      allDeployments.items.some(
        (deployment) => deployment.metadata.name === deploymentName
      )
    ).toBe(true)
    expect(
      allDeployments.items.some(
        (deployment) => deployment.metadata.name === deniedDeploymentName
      )
    ).toBe(false)

    const namespaceList = await expectJSON<{
      items: Array<{ metadata: { name: string } }>
    }>(await readerRequest.get(`${clusterPath}/namespaces`), 200)
    expect(namespaceList.items.map((item) => item.metadata.name)).toEqual([
      'default',
    ])

    await expectStatus(
      await readerRequest.get('/api/v1/configmaps/default', {
        headers: { 'x-cluster-name': encodeURIComponent(clusterName) },
      }),
      200
    )
    await expectForbidden(
      await readerRequest.get(`${clusterPath}/secrets/default`),
      ['get secrets', 'namespace default', clusterName]
    )
    await expectForbidden(
      await readerRequest.post(`${clusterPath}/configmaps/default`, {
        data: {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: blockedConfigMapName },
        },
      }),
      ['create configmaps', 'namespace default', clusterName]
    )
    await expectForbidden(
      await readerRequest.put(configMapPath, { data: currentConfigMap }),
      ['update configmaps', 'namespace default', clusterName]
    )
    await expectForbidden(
      await readerRequest.patch(`${configMapPath}?patchType=merge`, {
        data: { data: { blocked: 'true' } },
      }),
      ['update configmaps', 'namespace default', clusterName]
    )
    await expectForbidden(
      await readerRequest.delete(`${configMapPath}?wait=false`),
      ['delete configmaps', 'namespace default', clusterName]
    )
    await expectForbidden(
      await readerRequest.patch(`${podPath}/resize`, {
        data: { spec: { containers: [] } },
      }),
      ['update pods', 'namespace default', clusterName]
    )
    await expectForbidden(
      await readerRequest.get(`${podPath}/files?container=pause&path=/`),
      ['exec pods', 'namespace default', clusterName]
    )
    await expectForbidden(
      await readerRequest.put(deploymentPath, { data: currentDeployment }),
      ['update deployments', 'namespace default', clusterName]
    )
    await expectForbidden(
      await readerRequest.post(`${clusterPath}/resources/apply`, {
        data: {
          yaml: `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${blockedConfigMapName}\n  namespace: default\n`,
        },
      }),
      ['create configmaps', 'namespace default', clusterName]
    )
    await expectStatus(await readerRequest.get(`${clusterPath}/overview`), 200)
    await expectJSON(
      await readerRequest.get(
        `${clusterPath}/prometheus/pods/default/${podName}/metrics?duration=invalid`
      ),
      400
    )
    await expectForbidden(await readerRequest.get('/api/v1/admin/users/'), [
      'Admin role required',
    ])

    await expectStatus(await request.delete(`${podPath}?wait=false`), 200)
    podCreated = false
    await expect
      .poll(async () => (await request.get(podPath)).status())
      .toBe(404)
    await expectStatus(await request.delete(`${deniedPodPath}?wait=false`), 200)
    deniedPodCreated = false
    await expectStatus(
      await request.delete(`${deploymentPath}?wait=false`),
      200
    )
    deploymentCreated = false
    await expect
      .poll(async () => (await request.get(deploymentPath)).status())
      .toBe(404)
    await expectStatus(
      await request.delete(`${deniedDeploymentPath}?wait=false`),
      200
    )
    deniedDeploymentCreated = false
    await expectStatus(await request.delete(`${configMapPath}?wait=false`), 200)
    configMapCreated = false
    await expect
      .poll(async () => (await request.get(configMapPath)).status())
      .toBe(404)
    await expectStatus(
      await request.delete(`${deniedConfigMapPath}?wait=false`),
      200
    )
    deniedConfigMapCreated = false

    const history = await expectJSON<{
      data: Array<{ operationType: string; success: boolean }>
      pagination: { total: number }
    }>(await request.get(`${configMapPath}/history?pageSize=20`), 200)
    expect(history.pagination.total).toBeGreaterThanOrEqual(4)
    expect(history.data.map((item) => item.operationType)).toEqual(
      expect.arrayContaining(['create', 'update', 'patch', 'delete'])
    )
    expect(history.data.every((item) => item.success)).toBe(true)

    const podHistory = await expectJSON<{
      data: Array<{ operationType: string; success: boolean }>
      pagination: { total: number }
    }>(await request.get(`${podPath}/history?pageSize=20`), 200)
    expect(podHistory.pagination.total).toBeGreaterThanOrEqual(4)
    expect(podHistory.data.map((item) => item.operationType)).toEqual(
      expect.arrayContaining(['create', 'update', 'patch', 'delete'])
    )
    expect(podHistory.data.every((item) => item.success)).toBe(true)

    const deploymentHistory = await expectJSON<{
      data: Array<{ operationType: string; success: boolean }>
      pagination: { total: number }
    }>(await request.get(`${deploymentPath}/history?pageSize=20`), 200)
    expect(deploymentHistory.pagination.total).toBeGreaterThanOrEqual(4)
    expect(deploymentHistory.data.map((item) => item.operationType)).toEqual(
      expect.arrayContaining(['create', 'update', 'patch', 'delete'])
    )
    expect(deploymentHistory.data.every((item) => item.success)).toBe(true)

    const auditLogs = await expectJSON<{
      data: Array<{ resourceName: string }>
      total: number
    }>(
      await request.get(
        `/api/v1/admin/audit-logs?resourceName=${encodeURIComponent(configMapName)}&size=20`
      ),
      200
    )
    expect(auditLogs.total).toBeGreaterThanOrEqual(4)
    expect(
      auditLogs.data.every((item) => item.resourceName === configMapName)
    ).toBe(true)

    await expectStatus(await readerRequest.post('/api/auth/refresh'), 200)
    await expectStatus(await readerRequest.post('/api/auth/logout'), 200)
    await expectStatus(await readerRequest.get('/api/auth/user'), 401)
    await expectStatus(
      await readerRequest.post('/api/auth/login/password', {
        data: { username, password: finalPassword },
      }),
      204
    )
    await expectStatus(await readerRequest.post('/api/auth/logout'), 200)

    await expectStatus(
      await request.delete(`/api/v1/admin/oauth-providers/${oauthProviderId}`),
      200
    )
    oauthProviderId = undefined
    await expectStatus(
      await request.put('/api/v1/admin/ldap-setting/', {
        data: originalLDAPSetting,
      }),
      200
    )
    ldapSettingChanged = false
    await expectStatus(
      await request.put('/api/v1/admin/general-setting/', {
        data: {
          aiAgentEnabled: originalGeneralSetting.aiAgentEnabled,
          enableMFA: originalGeneralSetting.enableMFA,
          enablePasskeyLogin: originalGeneralSetting.enablePasskeyLogin,
          loginPrompt: originalGeneralSetting.loginPrompt,
        },
      }),
      200
    )
    generalSettingChanged = false

    await readerRequest.dispose()
    readerRequest = undefined

    await expectStatus(
      await request.delete(`/api/v1/admin/users/${userId}`),
      200
    )
    userId = undefined
    await expectStatus(
      await request.delete(`/api/v1/admin/roles/${roleId}`),
      200
    )
    roleId = undefined
    await expectStatus(
      await request.delete(`/api/v1/admin/roles/${decoyRoleId}`),
      200
    )
    decoyRoleId = undefined
    await expectStatus(
      await request.delete(`/api/v1/admin/apikeys/${apiKeyId}`),
      200
    )
    apiKeyId = undefined
    await expectStatus(
      await request.delete(`/api/v1/admin/templates/${templateId}`),
      200
    )
    templateId = undefined
  } finally {
    await readerRequest?.dispose()
    await anonymousRequest?.dispose()
    if (podCreated) {
      await request.delete(`${podPath}?wait=false`).catch(() => undefined)
    }
    if (deniedPodCreated) {
      await request.delete(`${deniedPodPath}?wait=false`).catch(() => undefined)
    }
    if (deploymentCreated) {
      await request
        .delete(`${deploymentPath}?wait=false`)
        .catch(() => undefined)
    }
    if (deniedDeploymentCreated) {
      await request
        .delete(`${deniedDeploymentPath}?wait=false`)
        .catch(() => undefined)
    }
    if (configMapCreated) {
      await request.delete(`${configMapPath}?wait=false`).catch(() => undefined)
    }
    if (deniedConfigMapCreated) {
      await request
        .delete(`${deniedConfigMapPath}?wait=false`)
        .catch(() => undefined)
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
    if (decoyRoleId !== undefined) {
      await request
        .delete(`/api/v1/admin/roles/${decoyRoleId}`)
        .catch(() => undefined)
    }
    if (apiKeyId !== undefined) {
      await request
        .delete(`/api/v1/admin/apikeys/${apiKeyId}`)
        .catch(() => undefined)
    }
    if (templateId !== undefined) {
      await request
        .delete(`/api/v1/admin/templates/${templateId}`)
        .catch(() => undefined)
    }
    if (oauthProviderId !== undefined) {
      await request
        .delete(`/api/v1/admin/oauth-providers/${oauthProviderId}`)
        .catch(() => undefined)
    }
    if (dummyClusterId !== undefined) {
      await request
        .delete(`/api/v1/admin/clusters/${dummyClusterId}`)
        .catch(() => undefined)
    }
    if (helmRepositoryId !== undefined) {
      await request
        .delete(`/api/v1/admin/charts/repositories/${helmRepositoryId}`)
        .catch(() => undefined)
    }
    if (globalSidebarChanged) {
      if (originalGlobalSidebarPreference) {
        await request
          .post('/api/v1/admin/sidebar_preference/global', {
            data: { sidebar_preference: originalGlobalSidebarPreference },
          })
          .catch(() => undefined)
      } else {
        await request
          .delete('/api/v1/admin/sidebar_preference/global')
          .catch(() => undefined)
      }
    }
    if (ldapSettingChanged && originalLDAPSetting) {
      await request
        .put('/api/v1/admin/ldap-setting/', { data: originalLDAPSetting })
        .catch(() => undefined)
    }
    if (generalSettingChanged && originalGeneralSetting) {
      await request
        .put('/api/v1/admin/general-setting/', {
          data: {
            aiAgentEnabled: originalGeneralSetting.aiAgentEnabled,
            enableMFA: originalGeneralSetting.enableMFA,
            enablePasskeyLogin: originalGeneralSetting.enablePasskeyLogin,
            loginPrompt: originalGeneralSetting.loginPrompt,
          },
        })
        .catch(() => undefined)
    }
    if (helmRepositoryServer?.listening) {
      await new Promise<void>((resolve) => {
        helmRepositoryServer!.close(() => resolve())
      })
    }
  }
})
