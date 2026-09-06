# Kubeconfig API

Kite provides a kubeconfig download endpoint, token-management endpoints, and a Kubernetes API proxy. Download requests use the existing authenticated browser session. The proxy accepts only a dedicated Kubeconfig Token, not a browser login token or API key.

All token-management responses contain metadata only. They never return the JWT, its `jti`, or its hash.

## Download a kubeconfig

```http
POST /api/v1/kubeconfig
Content-Type: application/json
```

```json
{
  "clusterUUIDs": [
    "7be79e50-6213-4e73-bdf4-f606d9ae81e2"
  ],
  "ttlSeconds": 2592000
}
```

`clusterUUIDs` must contain at least one UUID for an enabled cluster the signed-in user can access. `ttlSeconds` must be an integer from 3,600 through 157,680,000.

Success returns the downloaded YAML directly:

```http
200 OK
Content-Type: application/yaml
Content-Disposition: attachment; filename="kite-kubeconfig.yaml"
Cache-Control: no-store
Pragma: no-cache
```

The response is not a JSON token response. It contains a kubeconfig with a single bearer token shared by the selected contexts.

Typical errors are `400` for an invalid request or UUID, `401` for a missing or expired browser session, `403` for a cluster the user cannot access, `404` for an unknown cluster, `409` for a disabled cluster, and `500` if signing or file generation fails.

## Current-user token management

```http
GET    /api/users/me/kubeconfig-tokens
DELETE /api/users/me/kubeconfig-tokens/:id
```

These endpoints require an authenticated user. The list includes only tokens owned by the current user. `DELETE` physically removes the token record. The token becomes invalid immediately and cannot be recovered. A missing token, including one owned by another user, returns `404`.

Example list response:

```json
{
  "tokens": [
    {
      "id": 42,
      "name": "kubeconfig-alice-20260814153045.987",
      "createdAt": "2026-08-14T07:30:45Z",
      "expiresAt": "2026-09-13T07:30:45Z",
      "lastUsedAt": "2026-08-14T08:00:00Z",
      "signingKeyId": "primary"
    }
  ]
}
```

Clients derive active and expired display states from the expiration time.

## Administrator token management

```http
GET    /api/v1/admin/kubeconfig-tokens
DELETE /api/v1/admin/kubeconfig-tokens/:id
```

These endpoints require an authenticated administrator. The administrator list includes the same safe metadata plus `ownerId` and `owner`. Administrators can physically delete any token; deletion invalidates it immediately and cannot be recovered.

The list supports `page` (default `1`), `size` (default `20`, maximum `100`), `owner` (case-insensitive username substring), and `status` (`active` or `expired`). Results are ordered by `createdAt` descending and include `tokens`, `total`, `page`, and `size`.

## Kubernetes API proxy

```http
GET|POST|PUT|PATCH|DELETE /api/v1/clusters/:clusterUUID/k8s-proxy/*path
Authorization: Bearer <kubeconfig-jwt>
```

The proxy forwards Kubernetes API paths for the selected cluster, including discovery, resource operations, logs, Watch, and supported upgrade requests. It evaluates token state, owner status, cluster access, and current Kite RBAC permissions for every request. Requests with an expired, deleted, invalid, or browser-login token receive a Kubernetes `Status` response with HTTP `401`; authorization failures receive `403`.

The external bearer token, cookies, and `Impersonate-*` headers are removed before forwarding to the target Kubernetes API.

## Authentication model

Kubeconfig Tokens are independently issued JWTs with `iss`, `sub`, `jti`, `token_use=kubeconfig`, `iat`, `nbf`, and `exp` claims. They are non-refreshable and have a server-side state record, so signature validation alone is insufficient. Kite checks the corresponding record on every proxy request and applies current RBAC rather than embedding a permissions snapshot in the token.

### Stateful token module

Kite uses the in-process `pkg/statefultoken` module for stateful token issuance, signature and server-side state validation, deletion, and last-used updates. The Kubeconfig domain connects it to `kubeconfig_tokens` through a storage adapter; cluster selection, kubeconfig YAML generation, owner-enabled checks, Kubernetes request parsing, and current RBAC remain in the Kubeconfig/cluster domain.

The module does not serve browser-session JWTs and does not store cluster or resource permissions in tokens. Kubeconfig Tokens currently use one HS256 key and KID; a verification key set and uninterrupted key rotation are not implemented yet.
