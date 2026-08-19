# Artifact 上传、预览与下载使用手册

本文面向 Agent Harness 调用方和 ByClaw 部署运维人员，说明如何上传单文件或 ZIP 站点、使用返回的能力 URL，以及如何在 Docker 单机版和 K3s 环境中配置路径或子域名访问。

## 1. 功能与访问模型

Artifact 服务提供以下能力：

- 上传单文件，包括 HTML、图片、PDF、文本、音视频和其他二进制文件。
- 上传包含 `index.html` 和静态资源的 ZIP，并以完整站点形式预览。
- 返回匿名、限时的预览 URL 和下载 URL。
- 使用路径路由，不要求为每个 Artifact 分配子域名。
- 默认使用独立文件目录或 RWX PVC，后续可以切换到 MinIO、OSS 等对象存储。

推荐的生产 URL 形式为：

```text
https://preview.beyonai.cn/artifact-preview/{artifactId}/{accessKey}/
https://preview.beyonai.cn/artifact-download/{artifactId}/{accessKey}
```

没有预览子域名时，可以使用主站或内网网关路径：

```text
https://www.beyonai.cn/byaiService/artifact-preview/{artifactId}/{accessKey}/
https://www.beyonai.cn/byaiService/artifact-download/{artifactId}/{accessKey}
```

每个 Artifact 的 `accessKey` 是独立的 32 字节随机能力密钥。服务端只保存它的 SHA-256，原始密钥只在上传成功响应中返回一次。

## 2. API 基础信息

后端默认 context path 为 `/byaiService`。以下示例使用：

```bash
API_BASE='https://www.beyonai.cn/byaiService'
BEYOND_TOKEN='<sandbox 中已有的 BEYOND_TOKEN>'
```

上传、元数据查询和撤销接口需要用户身份。上传接口强制使用请求头中的 `Beyond-Token`，不接受请求参数中的 `userCode` 代替身份。

预览和下载 URL 是匿名能力 URL，不需要 `Beyond-Token`。任何获得完整 URL 的人都可以在过期或撤销前访问，因此不要把 URL 写入公开日志、公开仓库或长期持久化到不可信系统。

### 2.1 上传 Artifact

```http
POST /byaiService/open/api/v1/artifacts
Beyond-Token: <BEYOND_TOKEN>
Content-Type: multipart/form-data
```

表单参数：

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `file` | 是 | 无 | 单文件或 ZIP，最大 300MB |
| `publishMode` | 否 | `AUTO` | `AUTO`、`SITE`、`FILE` 或 `DOWNLOAD_ONLY` |
| `entryPoint` | 否 | `index.html` | ZIP 站点入口，相对于解压后的站点根目录 |
| `stripTopLevelDirectory` | 否 | `true` | ZIP 只有一个顶层目录时移除该目录 |
| `expiresInSeconds` | 否 | `604800` | 有效期，最大 `2592000`，即 30 天 |
| `displayName` | 否 | 原文件名 | 展示名称，不参与对象路径解析 |
| `sha256` | 否 | 无 | 调用方预期的 SHA-256；服务端始终重新计算并校验 |

`AUTO` 的处理规则：

| 上传内容 | 结果 |
|----------|------|
| ZIP 中存在入口 HTML | `SITE`，解压站点用于预览，原 ZIP 用于下载 |
| ZIP 中不存在入口 HTML | `DOWNLOAD_ONLY`，`previewUrl` 为 `null` |
| 普通单文件 | `FILE`，浏览器可安全预览时 inline 展示 |

上传单个 HTML：

```bash
curl --fail-with-body \
  -X POST "${API_BASE}/open/api/v1/artifacts" \
  -H "Beyond-Token: ${BEYOND_TOKEN}" \
  -F 'file=@./index.html' \
  -F 'publishMode=AUTO' \
  -F 'expiresInSeconds=604800' \
  -F 'displayName=首页预览'
```

上传 ZIP 站点：

```bash
curl --fail-with-body \
  -X POST "${API_BASE}/open/api/v1/artifacts" \
  -H "Beyond-Token: ${BEYOND_TOKEN}" \
  -F 'file=@./site.zip' \
  -F 'publishMode=SITE' \
  -F 'entryPoint=index.html' \
  -F 'stripTopLevelDirectory=true'
```

带完整性校验上传：

```bash
FILE_SHA256="$(sha256sum ./site.zip | awk '{print $1}')"

curl --fail-with-body \
  -X POST "${API_BASE}/open/api/v1/artifacts" \
  -H "Beyond-Token: ${BEYOND_TOKEN}" \
  -F 'file=@./site.zip' \
  -F "sha256=${FILE_SHA256}"
```

macOS 可以使用 `shasum -a 256 ./site.zip` 计算 SHA-256。

成功响应遵循 ByClaw 的统一响应结构，Artifact 数据位于 `data`：

```json
{
  "code": 0,
  "msg": "Operation successful",
  "data": {
    "artifactId": "5be4a788-cdc1-4bed-8f56-b984e3c79b5f",
    "kind": "SITE",
    "status": "READY",
    "fileName": "site.zip",
    "entryPoint": "index.html",
    "size": 1839201,
    "sha256": "2f5c...",
    "previewUrl": "https://www.beyonai.cn/byaiService/artifact-preview/5be4a788-cdc1-4bed-8f56-b984e3c79b5f/AbCdEf.../",
    "downloadUrl": "https://www.beyonai.cn/byaiService/artifact-download/5be4a788-cdc1-4bed-8f56-b984e3c79b5f/AbCdEf...",
    "expiresAt": "2026-08-26T10:00:00+08:00",
    "warnings": []
  }
}
```

调用方应在收到响应后立即保存需要交给用户的 `previewUrl` 和 `downloadUrl`。后续元数据查询不会重新返回已经丢失的 `accessKey`。

### 2.2 查询 Artifact 元数据

```http
GET /byaiService/open/api/v1/artifacts/{artifactId}
Beyond-Token: <BEYOND_TOKEN>
```

```bash
curl --fail-with-body \
  "${API_BASE}/open/api/v1/artifacts/${ARTIFACT_ID}" \
  -H "Beyond-Token: ${BEYOND_TOKEN}"
```

只有 Artifact 所有者可以查询。返回内容包含状态、文件名、大小、摘要、入口和过期时间，但 `previewUrl` 与 `downloadUrl` 不会包含已经无法恢复的能力密钥。

### 2.3 撤销 Artifact

```http
DELETE /byaiService/open/api/v1/artifacts/{artifactId}
Beyond-Token: <BEYOND_TOKEN>
```

```bash
curl --fail-with-body \
  -X DELETE "${API_BASE}/open/api/v1/artifacts/${ARTIFACT_ID}" \
  -H "Beyond-Token: ${BEYOND_TOKEN}"
```

只有 Artifact 所有者可以撤销。撤销后状态切换为 `DELETING`，存储内容异步清理；能力 URL 立即停止提供内容。

### 2.4 预览与下载

直接访问上传响应中的 URL：

```bash
curl -I "${PREVIEW_URL}"
curl -L -o artifact.bin "${DOWNLOAD_URL}"
```

预览端点支持：

- `GET` 和 `HEAD`。
- 单区间 `Range`，例如 `Range: bytes=0-1023`。
- `ETag`、`If-None-Match` 和 `Last-Modified`。
- HTML 使用 `Cache-Control: no-cache`。
- 下载接口始终返回 `Content-Disposition: attachment`。

错误的 `accessKey`、已过期、已撤销和不存在的 Artifact 都按 `404` 处理，避免泄露 Artifact 是否存在。

## 3. ZIP 站点制作规范

推荐 ZIP 内容如下：

```text
site.zip
├── index.html
├── assets
│   ├── app.js
│   └── app.css
└── images
    └── logo.png
```

HTML 和 CSS 必须优先使用相对路径：

```html
<link rel="stylesheet" href="assets/app.css">
<script src="./assets/app.js"></script>
<img src="images/logo.png" alt="logo">
```

不要依赖根绝对路径：

```html
<script src="/assets/app.js"></script>
```

根绝对路径会指向当前域名的 `/assets/app.js`，不会自动包含 Artifact 的动态路径。上传时检测到入口 HTML 或 CSS 中明显的根绝对引用，会在 `warnings` 中返回提醒，但服务端不会自动修改文件。

第一阶段不提供 SPA fallback。`/users/42` 等前端路由只有在 ZIP 中存在对应真实文件时才能直接访问；Hash Router 或相对静态页面更适合当前预览模式。

ZIP 限制默认包括：压缩文件 300MB、解压总量 1GB、单文件 200MB、最多 10,000 个条目、目录深度 20、最大压缩率 100。服务会拒绝路径穿越、绝对路径、Windows 盘符、符号链接和特殊设备条目。

## 4. 公共 URL 与路由原则

`ARTIFACT_PUBLIC_BASE_URL` 只负责生成返回给调用方的公共 URL，不决定 Spring Controller 的内部路径。外部网关必须把该公共路径正确转发到 BE 的：

```text
/byaiService/artifact-preview/...
/byaiService/artifact-download/...
```

常见配置对应关系：

| 场景 | `ARTIFACT_PUBLIC_BASE_URL` | 外部返回 URL |
|------|----------------------------|--------------|
| 主域名路径 | `https://www.beyonai.cn/byaiService` | `https://www.beyonai.cn/byaiService/artifact-preview/...` |
| 内网路径 | `http://gateway.internal/byaiService` | `http://gateway.internal/byaiService/artifact-preview/...` |
| 子域名保留 context path | `https://preview.beyonai.cn/byaiService` | `https://preview.beyonai.cn/byaiService/artifact-preview/...` |
| 子域名根路径 | `https://preview.beyonai.cn` | `https://preview.beyonai.cn/artifact-preview/...` |

生产环境必须显式设置 `ARTIFACT_PUBLIC_BASE_URL`。服务不会根据未经校验的请求 `Host` 自动生成公共地址。

## 5. Docker 单机版部署

### 5.1 配置独立 Artifact 目录

在仓库根目录的私有 `.env` 中配置：

```dotenv
ARTIFACT_STORAGE_TYPE=file
ARTIFACT_STORAGE_LOCAL_ROOT=/mnt/byclaw-artifacts
ARTIFACT_STORAGE_BUCKET=byclaw-artifacts
ARTIFACT_PUBLIC_BASE_URL=https://www.beyonai.cn/byaiService
```

`deploy/standalone/docker-compose.yml` 会把 `ARTIFACT_STORAGE_LOCAL_ROOT` 挂载到 BE 容器的同一路径。该目录不会挂载进沙箱，避免沙箱进程在发布后原地篡改内容。

确认宿主机目录对容器用户 `1001:1001` 可写。生产环境建议使用独立磁盘或 NFS 挂载点，并把备份、容量告警和 inode 监控纳入运维体系。

### 5.2 执行数据库迁移

升级已有环境时，在启动新 BE 版本前通过项目现有迁移流程执行：

```text
deploy/migrations/versions/V0.4.1/V0.4.1__ddl.sql
```

全新初始化数据库时，`deploy/middleware/initdb/02_ddl.sql` 已包含 Artifact 表结构。

### 5.3 使用主域名路径

标准 standalone Nginx 已将 `/byaiService` 转发到 BE，并将上传上限设置为 `300m`。生成配置并启动：

```bash
sh deploy/standalone/start-all.sh
```

路径模式使用：

```dotenv
ARTIFACT_PUBLIC_BASE_URL=https://www.beyonai.cn/byaiService
```

如果外层还有 SLB、WAF 或另一层 Nginx，需要同步允许至少 300MB 请求体，并确保其上传超时满足现场网络条件。

### 5.4 使用预览子域名

最简单的子域名方式是保留 `/byaiService`，将 `preview.beyonai.cn` 的 `/byaiService` 转发到现有 FE Nginx 或直接转发到 BE，并配置：

```dotenv
ARTIFACT_PUBLIC_BASE_URL=https://preview.beyonai.cn/byaiService
```

如果希望子域名 URL 不带 `/byaiService`，可以在 Nginx 增加独立虚拟主机：

```nginx
server {
    listen 443 ssl;
    server_name preview.beyonai.cn;

    # 按现场证书管理方式配置 ssl_certificate 和 ssl_certificate_key。

    location /artifact-preview/ {
        rewrite ^/artifact-preview/(.*)$ /byaiService/artifact-preview/$1 break;
        proxy_pass http://be:8086;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /artifact-download/ {
        rewrite ^/artifact-download/(.*)$ /byaiService/artifact-download/$1 break;
        proxy_pass http://be:8086;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

对应环境变量：

```dotenv
ARTIFACT_PUBLIC_BASE_URL=https://preview.beyonai.cn
```

修改 `.env` 或 Nginx 模板后需要重新生成配置并重建相关容器。

## 6. K3s 部署

### 6.1 配置 RWX PVC 和公共 URL

复制环境变量模板：

```bash
cp deploy/k3s/env.k3s.example deploy/k3s/env.k3s
```

编辑私有 `deploy/k3s/env.k3s`：

```dotenv
ARTIFACT_PVC_NAME=byclaw-artifacts
ARTIFACT_PVC_SIZE=200Gi
ARTIFACT_STORAGE_TYPE=file
ARTIFACT_STORAGE_LOCAL_ROOT=/mnt/byclaw-artifacts
ARTIFACT_STORAGE_BUCKET=byclaw-artifacts
ARTIFACT_PUBLIC_BASE_URL=https://www.beyonai.cn/byaiService
```

渲染脚本会创建独立 `ReadWriteMany` PVC，并只把它读写挂载到 BE Pod。多副本 BE 因此可以立即读取其他副本刚发布的 Artifact。

先检查渲染结果：

```bash
K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh render
```

部署或升级：

```bash
K3S_ENV_FILE=deploy/k3s/env.k3s sh deploy/k3s/deploy.sh update
```

首次部署按项目 K3s 指南使用 `init`。升级已有数据库时，仍需确保 `V0.4.1__ddl.sql` 已通过现有迁移流程执行。

### 6.2 K3s 主域名路径模式

默认渲染的 Ingress 包含：

```yaml
- path: /byaiService
  pathType: Prefix
  backend:
    service:
      name: byclaw-be
      port:
        number: 8086
```

设置：

```dotenv
ARTIFACT_PUBLIC_BASE_URL=https://www.beyonai.cn/byaiService
```

内网环境只需把域名替换为用户浏览器能访问的 Ingress 地址。不要填写只能由 Pod 访问的 `*.svc.cluster.local` 地址。

### 6.3 K3s 子域名保留 context path

给 `preview.beyonai.cn` 增加一个指向 `byclaw-be:8086` 的 Ingress，并保留 `/byaiService` 路径即可：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: artifact-preview
  namespace: by-service
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - preview.beyonai.cn
      secretName: preview-beyonai-cn-tls
  rules:
    - host: preview.beyonai.cn
      http:
        paths:
          - path: /byaiService
            pathType: Prefix
            backend:
              service:
                name: byclaw-be
                port:
                  number: 8086
```

```dotenv
ARTIFACT_PUBLIC_BASE_URL=https://preview.beyonai.cn/byaiService
```

### 6.4 K3s 子域名根路径

若希望 URL 为 `https://preview.beyonai.cn/artifact-preview/...`，Traefik 必须在转发前补上 Spring context path：

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: artifact-add-context
  namespace: by-service
spec:
  addPrefix:
    prefix: /byaiService
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: artifact-preview
  namespace: by-service
  annotations:
    traefik.ingress.kubernetes.io/router.middlewares: by-service-artifact-add-context@kubernetescrd
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - preview.beyonai.cn
      secretName: preview-beyonai-cn-tls
  rules:
    - host: preview.beyonai.cn
      http:
        paths:
          - path: /artifact-preview
            pathType: Prefix
            backend:
              service:
                name: byclaw-be
                port:
                  number: 8086
          - path: /artifact-download
            pathType: Prefix
            backend:
              service:
                name: byclaw-be
                port:
                  number: 8086
```

对应配置：

```dotenv
ARTIFACT_PUBLIC_BASE_URL=https://preview.beyonai.cn
```

如果集群使用旧版 Traefik CRD，`Middleware` 的 API group 可能是 `traefik.containo.us/v1alpha1`；以集群中已安装的 CRD 为准。

## 7. 部署验证

Docker 单机版检查：

```bash
docker compose -f deploy/standalone/docker-compose.yml ps
curl -I http://127.0.0.1:8086/byaiService/actuator/health
```

K3s 检查：

```bash
kubectl -n by-service get pvc byclaw-artifacts
kubectl -n by-service get pods -l app=byclaw-be
kubectl -n by-service get ingress
kubectl -n by-service exec deploy/byclaw-be -- test -w /mnt/byclaw-artifacts
```

然后使用一个小型 HTML 或 ZIP 完成端到端验证：

1. 使用有效 `Beyond-Token` 上传。
2. 确认响应为 `READY`。
3. 在浏览器打开 `previewUrl`。
4. 使用 `curl -I` 检查 `Content-Type`、`Content-Disposition` 和安全响应头。
5. 使用 `Range: bytes=0-9` 检查是否返回 `206 Partial Content`。
6. 撤销 Artifact，确认原能力 URL 返回 `404`。

Range 验证示例：

```bash
curl -i \
  -H 'Range: bytes=0-9' \
  "${PREVIEW_URL}"
```

## 8. 常见问题

### 上传返回 401

确认使用 `Beyond-Token` 请求头，并且 Token 仍有效。不要把 Token 放在表单参数、查询参数或 Cookie 中代替该请求头。

### 返回的 URL 是相对路径

说明 `ARTIFACT_PUBLIC_BASE_URL` 为空。生产环境设置为浏览器可访问的外部地址并重启 BE。

### ZIP 上传成功但 `previewUrl` 为 null

`AUTO` 模式没有找到入口 HTML。检查 `entryPoint` 和 `stripTopLevelDirectory` 是否与 ZIP 目录结构一致，或者显式使用 `SITE` 让缺少入口直接报错。

### HTML 可以打开，但 CSS、JS 或图片 404

检查页面是否使用 `/assets/...` 等根绝对路径。改为 `assets/...` 或 `./assets/...`，并检查上传响应的 `warnings`。

### 大文件在到达 BE 前被拒绝

依次检查浏览器前的 CDN、WAF、SLB、Ingress、Nginx 和 Spring multipart 上限。仓库内的 Spring 与 standalone Nginx 默认均为 300MB，外部设施仍需单独配置。

### 多副本环境偶发找不到刚上传的文件

确认所有 BE Pod 挂载的是同一个 RWX PVC，而不是节点本地目录；检查 `ARTIFACT_STORAGE_LOCAL_ROOT` 和 Artifact 记录中的 `storageType/storageRoot`。

## 9. 安全说明

- 能力 URL 等同于临时访问凭证，应按敏感数据处理。
- 预览端点不会启用 CSP sandbox，上传的 HTML 和 JavaScript 能获得正常网页能力。
- 如果预览 URL 与主站同属 `www.beyonai.cn`，上传脚本与主站同源，可能访问未正确隔离的 Cookie、LocalStorage 或同源 API。
- 条件允许时，生产环境应优先使用 `preview.beyonai.cn`，并避免在该子域名设置主站 Cookie。
- Artifact 发布目录不能挂载到沙箱。沙箱只能通过上传 API 发布内容。
- 过期清理依赖数据库状态和共享存储；应监控长期停留在 `DELETING` 的记录、PVC 使用率和清理任务日志。

