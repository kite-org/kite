# GPU 佔用顯示插件(fork 功能)

當叢集有 GPU 時,側邊欄自動出現「GPU」頁面,顯示:

- 全叢集 GPU 總卡數 / 已佔用 / 空閒
- 依節點分組,每張卡一格:佔用中的卡顯示 pod / container(可點擊跳轉),空卡顯示 Idle
- 偵測到 dcgm-exporter 時自動升級為卡級即時資料:每卡使用率、顯存、實體卡 UUID 與 pod 歸屬
- 每個節點提供「重置 GPU」按鈕:刪除該節點的 nvidia-device-plugin pod(DaemonSet 自動重建)以重新註冊 GPU

無 GPU 的叢集不顯示選單;多叢集各自獨立偵測,切換叢集即時生效。

## 部署需求

### 1.(必要)dcgm-exporter 設定 —— 卡級 pod 歸屬

要正確抓取每張卡上的佔用資訊,dcgm-exporter **必須**同時設定:

```yaml
# gpu-operator ClusterPolicy → spec.dcgmExporter.env
- name: DCGM_EXPORTER_KUBERNETES
  value: "true"
- name: DCGM_EXPORTER_KUBERNETES_GPU_ID_TYPE
  value: "uid"        # ← 關鍵,絕不能是 device-name
```

**為什麼 `uid` 是關鍵**:exporter 透過 kubelet podresources API 對應「哪個 pod 分到哪張卡」。nvidia device plugin 向 kubelet 回報的裝置 ID 是 GPU UUID;若設成 `device-name`(以 `nvidia0` 這類名稱比對)會永遠對不上,metrics 完全不帶 pod label,頁面上所有卡都會顯示 Idle、無法正確抓取佔用狀態。

既有叢集修正方式(gpu-operator 會自動 rolling restart exporter,一次一台,不影響工作負載):

```bash
kubectl patch clusterpolicy cluster-policy --type json -p '[
  {"op":"test","path":"/spec/dcgmExporter/env/2/name","value":"DCGM_EXPORTER_KUBERNETES_GPU_ID_TYPE"},
  {"op":"replace","path":"/spec/dcgmExporter/env/2/value","value":"uid"}
]'
```

> **注意**:若 gpu-operator 由 Helm 管理,請同步把上述 env 寫入 values,否則下次 `helm upgrade` 會沖掉。
> `env/2` 的 index 依實際 env 陣列順序調整,`test` op 會保護改錯位置。

### 2. Prometheus URL(dcgm 卡級模式的前提)

kite 會自動發現叢集內的 Prometheus,但**只認 9090 / 8429 port**。VictoriaMetrics 的 `vmsingle` 預設 **8428** 不會被發現,需在 kite 管理介面(設定 → 叢集)手動填入,例如:

```
http://vmsingle-vmks.monitoring.svc.cluster.local:8428
```

`.svc` 開頭的 URL kite 會自動經該叢集的 API server proxy 存取,kite 本體部署在哪個叢集都可以。

### 3. 降級行為(自動,無需設定)

| 條件 | 顯示層級 |
|---|---|
| 只有 K8s API | **排程視圖**:依 Pod resource requests 推算佔用數量,合成卡格 |
| + Prometheus + dcgm-exporter | **卡級即時**:每卡使用率 / 顯存 / UUID |
| + `GPU_ID_TYPE=uid` | 卡級 + **每卡 pod 歸屬**(完整功能) |

dcgm 查詢失敗時自動退回排程視圖,不會讓頁面出錯。偵測結果每叢集快取 60 秒。

### 4. RBAC

- GPU 頁面:需具備該叢集存取權(同 overview / prometheus endpoints 水位)
- 重置 GPU(刪 device-plugin pod):額外檢查該 namespace 的 `pods` `delete` 權限,並記錄操作者於 log

### 5. 支援的 GPU 資源類型

預設 `nvidia.com/gpu`。可用環境變數擴充(未知的 key 以數量級追蹤):

```
GPU_RESOURCE_KEYS=nvidia.com/gpu,amd.com/gpu
```

## API

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/v1/plugins` | 各插件對當前叢集的啟用狀態(前端據此顯示/隱藏選單) |
| GET | `/api/v1/plugins/gpu/overview` | 整頁資料:summary、各節點卡格、pod 歸屬 |
| POST | `/api/v1/plugins/gpu/nodes/:node/reset-device-plugin` | 刪除該節點 device-plugin pod;`?dryRun=true` 僅預覽目標 |

## 架構與上游 merge

本功能以輕量插件層實作,程式碼自成一體:

```
pkg/plugins/registry.go     插件 interface 與註冊表
pkg/plugins/gpu/            GPU 插件後端
ui/src/plugins/index.tsx    前端插件註冊層
ui/src/plugins/gpu/         GPU 插件前端(含自帶 i18n)
```

核心檔案僅各插入 1–2 行 hook,全部以 `kite-fork` 註解標記:

- `routes.go` — `pluginsall.RegisterRoutes(api)`(於 RBACMiddleware 之前)
- `ui/src/routes.tsx` — spread `...pluginRoutes`
- `ui/src/components/app-sidebar.tsx` — `<PluginSidebarItems />`

merge 上游後若 hook 遺失,`grep -rn "kite-fork"` 找回插入點即可。新增插件:實作 `plugins.Plugin` interface + 在 `pkg/plugins/all` blank import;前端加一個 descriptor 到 `ui/src/plugins/index.tsx`。
