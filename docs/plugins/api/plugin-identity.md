---
outline: deep
---

# Plugin Identity

Define the plugin's ID, display name, version, and metadata in `package.json`.

## package.json

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "My first Kite plugin",
  "author": "Your Team",
  "license": "Apache-2.0",
  "engines": {
    "kite": ">=0.16.0"
  }
}
```

## Fields

| Field | Description |
| ----- | ----------- |
| `name` | Plugin ID, also used in URLs. Use 1–64 lowercase letters, digits, or hyphens, starting and ending with a letter or digit. npm scopes are not supported |
| `displayName` | Name shown in plugin management, 1–128 characters |
| `version` | Semantic version without a `v` prefix. Increment it whenever the package contents change |
| `engines.kite` | Supported Kite version range. Defaults to `>=0.16.0` when omitted |
| `description` / `author` / `homepage` / `license` | Optional metadata |
