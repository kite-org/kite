---
outline: deep
---

# Kube Proxy

Kite 内置了 kubectl Proxy 功能，让您可以直接通过 Kite 访问 Pods 或 Services，无需在本地运行 `kubectl port-forward`。

## 如何使用

1.  导航到您想要访问的 Pod 或 Service 详情页。
2.  在 `端口` 部分，直接点击即可访问。

![Kube Proxy](../../screenshots/kube-proxy1.png)

![Kube Proxy](../../screenshots/kube-proxy2.png)

## 注意事项

1. 出于安全考虑，代理返回的内容会被沙箱隔离到独立的 origin 中，无法使用 Kite 的登录会话和浏览器存储。加载 module 脚本、调用 API 或使用 `localStorage` 的 Web 前端通常无法正常使用，请改用 `kubectl port-forward`。
2. 只支持代理 HTTP 服务。
