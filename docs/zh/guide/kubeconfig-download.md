---
outline: deep
---

# 下载 kubeconfig

Kite 可以生成 kubeconfig，使您通过 Kite 访问 Kubernetes API 并使用 `kubectl`。下载文件包含独立的、有状态的 Kubeconfig Token；其中不包含浏览器登录 Token、目标集群 kubeconfig 或 Cluster Agent 凭证。

## 下载并选择集群

1. 登录并选择一个您有访问权限的集群。
2. 在顶部工具栏中，点击 **Kubectl Terminal** 旁的 **下载 Kubeconfig**。
3. 弹窗默认选中当前可访问且已启用的集群。可选择更多集群，或使用**全选** / **取消全选**；集群较多时，可通过搜索框按名称筛选。
4. 选择有效期预设，或选择**自定义**并选择到期的年、月、日、时、分、秒。
5. 点击**下载**。Kite 会下载 `kite-kubeconfig.yaml`。

默认有效期为 30 天。可选预设为 1 天、7 天、30 天和 1 年。自定义时长必须是 3,600 秒（1 小时）至 157,680,000 秒（1,825 天）之间的整数秒。弹窗显示的过期时间仅为估算，最终过期时间由服务端决定。

每个选中集群都会生成独立的 cluster 和 context。如果当前集群被选中，它会成为 kubeconfig 的 `current-context`；否则使用选中列表中的第一个集群。

## 使用下载文件

请将该文件视为密码并限制文件权限：

```bash
chmod 600 ~/Downloads/kite-kubeconfig.yaml
export KUBECONFIG=~/Downloads/kite-kubeconfig.yaml
kubectl config get-contexts
kubectl get pods -A
```

也可以仅为单个命令指定文件：

```bash
kubectl --kubeconfig ~/Downloads/kite-kubeconfig.yaml get pods -A
```

Kite 会根据您当前的 Kite 账号和 RBAC 权限，对每一次代理的 Kubernetes 请求授权。账号状态、集群访问权限、命名空间权限或资源权限的变化会作用于后续命令。

## 流式与交互式命令

该代理用于普通 Kubernetes API 请求，也用于 Watch、日志、`exec`、`attach` 和 `port-forward` 请求。例如：

```bash
kubectl get pods -A -w
kubectl logs -f deployment/example
kubectl exec -it pod/example -- sh
kubectl port-forward service/example 8080:80
```

`ktctl` 的固定支持版本和命令范围尚未确认。在项目发布固定版本和命令矩阵前，请勿将 ktctl 兼容性视为发布保证。

## Token 生命周期与删除

每次下载都会创建一个独立的 Kubeconfig Token。Token 不支持刷新或续期；过期后请重新下载 kubeconfig。删除一个 Token 不会影响您的其他 kubeconfig 下载。

在**账号设置**的独立 **Kubeconfig Tokens** 区域，可查看 Token 元数据并删除不再需要的 Token。管理员在独立的管理视图中查看和删除 Token。两个列表均不会显示 kubeconfig JWT、其 `jti` 或哈希。

删除 Token 会移除其记录，使其立即失效且不可撤销或恢复。Token 过期或被删除后，`kubectl` 请求会收到 HTTP 401 和提示重新下载 kubeconfig 的 Kubernetes Status 消息。文件丢失或泄露时，请立即删除其 Token，仅在需要时重新下载。
