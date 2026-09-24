---
outline: deep
---

# 插件身份

插件的 ID、显示名称、版本和元数据定义在 `package.json` 中。

## package.json

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "我的第一个 Kite 插件",
  "author": "Your Team",
  "license": "Apache-2.0",
  "engines": {
    "kite": ">=0.16.0"
  }
}
```

## 字段

| 字段 | 说明 |
| ---- | ---- |
| `name` | 插件 ID，也是 URL 的一部分。1–64 个小写字母、数字或连字符，以字母或数字开头结尾；不使用 npm scope |
| `displayName` | 插件管理中显示的名称，1–128 个字符 |
| `version` | 语义化版本，不带 `v` 前缀。内容变更时必须递增版本 |
| `engines.kite` | 支持的 Kite 版本范围，省略时默认 `>=0.16.0` |
| `description` / `author` / `homepage` / `license` | 可选元数据 |
