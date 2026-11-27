---
outline: deep
---

# Kube Proxy

Kite has a built-in kubectl Proxy feature that allows you to access Pods or Services directly through Kite without running `kubectl port-forward` locally.

## How to Use

1.  Navigate to the details page of the Pod or Service you want to access.
2.  In the `Ports` section, click to access directly.

![Kube Proxy](../screenshots/kube-proxy1.png)

![Kube Proxy](../screenshots/kube-proxy2.png)

## Notes

1. For security, proxied responses are sandboxed into an isolated origin and cannot use your Kite session or browser storage. Web UIs that load module scripts, call APIs, or use `localStorage` will usually not work; use `kubectl port-forward` for them.
2. Only HTTP services are supported for proxying.
