# DWS CLI 二进制版本

Docker 镜像（`Dockerfile.dws`）使用的 DWS CLI 二进制说明。

| 项 | 值 |
| --- | --- |
| 版本 | v1.0.52 |
| 构建信息 | 4e59f9a, 2026-07-15T01:10:43Z |
| 来源 | npm 包 `dingtalk-workspace-cli@1.0.52`（`assets/dws-linux-amd64.tar.gz`） |
| 平台 | linux-amd64（ELF x86-64） |
| 文件 | `dws-linux-amd64.tar.gz` |
| SHA256 | `b7dfd9a4b3489211359261747ed0cb9c8c261434bb762ad3f76df33bdbabd5cb` |

## 更新方法

1. 拉取目标版本 npm 包并提取 linux-amd64 二进制：
   ```bash
   npm pack dingtalk-workspace-cli@<version>
   tar -xzf dingtalk-workspace-cli-<version>.tgz
   cp package/assets/dws-linux-amd64.tar.gz docker/dws/dws-linux-amd64.tar.gz
   ```
2. 更新本文件中的版本、构建信息与 SHA256（`shasum -a 256 docker/dws/dws-linux-amd64.tar.gz`）。
3. 保持与本地开发环境的 `dws --version` 一致，避免运行时行为漂移。
