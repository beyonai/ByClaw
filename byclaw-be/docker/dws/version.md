# DWS CLI 二进制版本

Docker 镜像（`Dockerfile`，已内置 DWS 支持）使用的 DWS CLI 二进制说明。

| 项 | 值 |
| --- | --- |
| 版本 | v1.0.52 |
| 构建信息 | 4e59f9a, 2026-07-15T01:10:43Z |
| 来源 | npm 包 `dingtalk-workspace-cli@1.0.52`（`assets/dws-linux-amd64.tar.gz`） |
| 平台 | linux-amd64（ELF x86-64） |
| 文件 | `dws-linux-amd64.tar.gz` |
| SHA256 | `b7dfd9a4b3489211359261747ed0cb9c8c261434bb762ad3f76df33bdbabd5cb` |

> 多架构说明：仓库仅预存 amd64 二进制。构建 arm64 镜像时，`Dockerfile` 通过 `TARGETARCH`
> 走 else 分支，从同版本 npm 包在线拉取 `assets/dws-linux-arm64.tar.gz`（SHA256
> `0d357ef0535f99f2f63b5ecbfdee9c32448be2a2c24f3096c03126b3b7570bc5`）。升级版本时同步更新
> `Dockerfile` 的 `DWS_VERSION` 与本文件。

## 更新方法

1. 拉取目标版本 npm 包并提取 linux-amd64 二进制：
   ```bash
   npm pack dingtalk-workspace-cli@<version>
   tar -xzf dingtalk-workspace-cli-<version>.tgz
   cp package/assets/dws-linux-amd64.tar.gz docker/dws/dws-linux-amd64.tar.gz
   ```
2. 更新本文件中的版本、构建信息与 SHA256（`shasum -a 256 docker/dws/dws-linux-amd64.tar.gz`）。
3. 保持与本地开发环境的 `dws --version` 一致，避免运行时行为漂移。

## Token 持久化

容器内 dws 使用 file-DEK 后端（`DWS_DISABLE_KEYCHAIN=1`，见 `Dockerfile`），
token 加密存储在 `/home/appuser/.dws`（镜像以非 root 用户 appuser 运行），不依赖 gnome-keyring/dbus。

- standalone/docker-compose：需挂 `byclaw-dws-auth` 卷到 `/home/appuser/.dws`，重启无需重新授权。
- k3s：`byclaw-be` 当前为多副本（replicas:2），dws 单点登录态尚未持久化，
  见 `deploy/k3s/manifests/service/byclaw-be.yaml` 的 `TODO(dws-auth)` 说明。
