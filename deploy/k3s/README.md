# ByClaw K3s + Longhorn 一键部署

该目录用于把 OpenSandbox 从 Docker runtime 升级为 K3s runtime，并使用 Longhorn RWX PVC 承载 `/by` 工作区。

## 核心入口

```bash
# 复制并修改配置
cp deploy/k3s/env.k3s.example deploy/k3s/env.k3s
vi deploy/k3s/env.k3s

# 本机已有 kubeconfig / 在 k3s server 节点执行
K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh init
K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh update

# 只渲染 generated manifests 供审查
K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh render
```

远程部署沿用仓库现有 `envs/<name>` 模式：

```bash
# envs/204/.env 配 HOST / HOST_USER / DEPLOY_DIR
# envs/204/env.k3s 配 K3s / Longhorn / 镜像 / Secret
sh scripts/deploy-k3s.sh 204 init
sh scripts/deploy-k3s.sh 204 update
sh scripts/deploy-k3s.sh 204 stop
```

## 内网集群网络（默认）

`K3S_CLUSTER_INTERNAL_ONLY=true`（默认）时，k3s 安装仅使用 `K3S_NODE_INTERNAL_IPS` 中的 VPC 内网地址：

- `--node-ip` / `--advertise-address`：内网 IP
- `K3S_JOIN_URL`：自动设为 `https://<第一台 server 内网 IP>:6443`
- `--tls-san`：内网 IP + `K3S_TLS_SANS` 中的私网地址（公网 IP 会被忽略）
- 不设置 `--node-external-ip`

`K3S_API_HOST` / `K3S_*_HOSTS` 仍可填公网 IP，**仅用于 SSH 部署**，不参与 k3s 集群通信。

## K3s 国内镜像

服务器从 GitHub 拉取 k3s 二进制较慢时，在 `env.k3s` 中启用 Rancher 官方中国镜像：

```bash
K3S_USE_CN_MIRROR=true
```

等价于在节点上执行：

```bash
curl -sfL https://rancher-mirror.rancher.cn/k3s/k3s-install.sh | INSTALL_K3S_MIRROR=cn sh -
```

也可手动指定：

```bash
K3S_INSTALL_SCRIPT_URL=https://rancher-mirror.rancher.cn/k3s/k3s-install.sh
K3S_INSTALL_MIRROR=cn
```

`K3S_USE_CN_MIRROR=true` 还会在各节点写入 `/etc/rancher/k3s/registries.yaml`，把 `docker.io` / `registry.k8s.io` 等拉取重定向到国内镜像，避免 `rancher/mirrored-pause` 等系统镜像从 Docker Hub 超时。同时 server 节点会使用内网 IP 作为 `--advertise-address`，避免 remotedialer 误连公网 `6443` 超时。

## 私有 Harbor 镜像仓库

在 `env.k3s` 配置 `K3S_PRIVATE_REGISTRIES`（可多个，逗号分隔），`install-k3s.sh` 会在**全部 server/agent 节点**写入认证信息并重启已运行的 k3s 服务：

```bash
# host[:port]|username|password[|http|insecure] — 整行必须加引号（| 是 shell 管道符）
K3S_PRIVATE_REGISTRIES='192.168.0.158:8080|admin|your-password|http|true'
```

HTTP 端口型 Harbor（如 `:8080`）需写 `|http|true`。HTTPS 自签证书可写 `|https|true`。密码配置在 `env.k3s` / `envs/<name>/env.k3s`，不要提交到 git。

镜像引用示例：`192.168.0.158:8080/byclaw/byclaw-fe:main`。

OpenSandbox 组件（controller/server/execd/egress）默认从阿里云 registry 拉取。若现场无法访问该 registry，需先由镜像发布流程或人工同步到 Harbor，再在 `env.k3s` 配置：

```bash
# 在有外网的机器执行，按 Harbor 项目路径调整
REG=192.168.0.158:8080
SRC=sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox
for img in controller:v0.2.0 server:v0.1.14 execd:v1.0.18 egress:v1.0.12; do
  docker pull "$SRC/${img%%:*}:${img##*:}"  # 或 crane/skopeo
  docker tag  "$SRC/${img%%:*}:${img##*:}" "$REG/opensandbox/${img%%:*}:${img##*:}"
  docker push "$REG/opensandbox/${img%%:*}:${img##*:}"
done
```

然后设置 `IMAGE_SANDBOX_CONTROLLER=192.168.0.158:8080/opensandbox/controller:v0.2.0` 等，并重跑 `install-opensandbox-controller.sh`。

版本以 [opensandbox-group/OpenSandbox](https://github.com/opensandbox-group/OpenSandbox/tree/main/kubernetes/charts) 为准：**controller `v0.2.0`**（chart 0.2.0）、**server `v0.1.14`**、**execd `v1.0.18`**、**egress `v1.0.12`**，勿把 server 版本套到 controller 上。

## 节点命名

默认根据 `K3S_NODE_INTERNAL_IPS` 内网 IP 末段自动设置 k3s `--node-name`：

- server：`byclaw-master-156`（`192.168.0.156`）
- agent：`byclaw-node-157`（`192.168.0.157`）

k3s 节点名须符合 DNS 标签规则（`a-z0-9-`），**不能使用下划线**。启用自定义节点名后，server/agent 的 systemd 单元均为 `k3s-<节点名>`（如 `k3s-byclaw-master-156`、`k3s-byclaw-node-157`），脚本会自动识别。

关闭自定义命名：`K3S_CUSTOM_NODE_NAMES=false`（回退为云主机 hostname）。

已加入集群的节点无法原地改名，需重装 k3s 后生效。

## 节点定义

`env.k3s` 中显式区分控制面和 worker：

```bash
K3S_SERVER_HOSTS=node-1,node-2,node-3
K3S_AGENT_HOSTS=node-4,node-5,node-6

K3S_NODE_POOL_GENERAL_HOSTS=node-1,node-2,node-3
K3S_NODE_POOL_BROWSER_HOSTS=node-4,node-5
K3S_NODE_POOL_HEAVY_HOSTS=node-6
```

`install-k3s.sh` 在安装前会对 **全部** server/agent 节点做幂等预处理（OS 依赖、目录、镜像加速、失败安装清理），再安装或复用已有 k3s，并打：


- `byclaw.io/k3s-role=server|agent`
- `byclaw.io/node-pool=sandbox-general|sandbox-browser|sandbox-heavy`

## OpenSandbox Controller

K8s runtime 需先安装 `opensandbox-controller`（BatchSandbox CRD + Operator）。`deploy.sh init` 默认执行 `install-opensandbox-controller.sh`；脚本会将 controller Helm chart 下载到 `/tmp/byclaw-opensandbox-controller/` 并复用缓存。节点未安装 Helm 时会自动下载 Helm 3 到同一缓存目录（`BYCLAW_K3S_AUTO_INSTALL_HELM=true`）。

如需固定 chart 来源，可在 `env.k3s` 设置：

```bash
OPENSANDBOX_CONTROLLER_CHART_URL=https://github.com/alibaba/OpenSandbox/releases/download/helm/opensandbox-controller/0.2.0/opensandbox-controller-0.2.0.tgz
# 或提前上传 chart 后设置：
# OPENSANDBOX_CONTROLLER_CHART_FILE=/tmp/opensandbox-controller-0.2.0.tgz
```

## Longhorn

`deploy.sh init` 默认执行 `install-longhorn.sh`：

- `LONGHORN_DATA_PATH=/data/longhorn`
- `LONGHORN_REPLICA_COUNT=3`
- 工作区 PVC：`WORKSPACE_PVC_NAME=byclaw-workspace`
- PVC 模式：`ReadWriteMany`

只初始化存储：

```bash
K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh storage-init
```

## Manifest 生成

部署前会由 `render-manifests.sh` 渲染到 `deploy/k3s/generated/`，该目录已被 `.gitignore` 忽略，因为生成物包含 Secret `stringData`。

生成内容包括：

- namespaces
- Longhorn RWX workspace PVC
- Redis / openGauss
- OpenSandbox server / RBAC / ConfigMap / Secret
- ByClaw BE / FE
- ByClaw ingress
- OpenSandbox HPA

完整部署手册见：

```text
docs/reports/opensandbox-k3s-longhorn-oneclick-deploy-manual.html
```
