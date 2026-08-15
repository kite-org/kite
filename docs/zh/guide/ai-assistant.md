# AI 助手

Kite 内置了面向 Kubernetes 运维场景的 AI 助手。它可以在当前工作空间内帮助你理解集群状态、检查资源、查看日志、查询 Prometheus 指标，以及辅助完成常见变更操作。

![AI](../../screenshots/ai-chat.png)


## 启用 AI

1. 打开 `Settings`。
2. 进入 `General`。
3. 打开 `AI Agent` 开关。
4. 选择 Provider：
   - `OpenAI Compatible`
   - `Anthropic Compatible`
5. 填写 `Model` 和 `API Key`。
6. 按需填写 `Base URL` 和 `Max Tokens`。
7. 保存设置。

如果你使用自建网关或兼容接口，也可以通过 `Base URL` 指向自己的 API 地址。

## 打开助手

启用 AI 后，工作区右下角会出现一个浮动的 AI 按钮。点击后即可打开聊天面板。

在聊天面板中，你可以：

- 发起新会话
- 查看聊天历史
- 在独立标签页中打开会话，获得更大的操作空间

## 可以做什么

这个助手主要面向日常 Kubernetes 操作。常见用法包括：

- 解释当前页面、当前资源或当前命名空间的状态
- 读取某个资源的 YAML 内容
- 在当前命名空间或整个集群范围内列出资源
- 读取 Pod 日志用于排障
- 汇总当前集群的整体状态
- 在已配置 Prometheus 的情况下查询监控指标
- 在确认后创建、更新、补丁修改或删除 Kubernetes 资源

Kite 会把当前页面上下文传给 AI，因此它会优先结合当前选中的集群、命名空间和资源页面来理解你的问题。

## 确认与结构化输入

对于写操作，Kite 不会直接执行。助手会先生成待执行动作，再在聊天界面中请求你确认。

如果执行某个操作还缺少必要信息，助手也可以直接在聊天界面里请求：

- 一个简短的选项选择
- 一个小型结构化表单

这样就不需要为了简单输入再进行多轮自由文本确认。

![AI](../../screenshots/ai-form.png)

## 权限与边界

AI 助手遵循 Kite 现有的权限模型。

- 只会在当前选中的集群内执行操作
- 会遵循当前用户的 RBAC 权限
- `describe_resource` 以当前用户对目标资源的 `get` 权限作为授权依据。其输出可能同时包含 Kubernetes describer 查询到的 Events 和关联资源摘要，Kite 不会再对这些附带信息执行独立的 RBAC 检查；这是 describe 操作的既定授权边界
- 如果当前用户没有日志、执行命令或资源修改权限，AI 也无法绕过这些限制
- 只有当前集群配置了 Prometheus，AI 才能查询 Prometheus 指标

![AI](../../screenshots/ai-permission.png)

相关配置可以参考：

- [RBAC 配置](../config/rbac-config)
- [Prometheus 设置](../config/prometheus-setup)

::: tip
AI 可能会出错，确认执行前请仔细检查生成的操作内容。
:::
