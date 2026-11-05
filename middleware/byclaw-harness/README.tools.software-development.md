# 软件开发工具沙箱

`Dockerfile.tools.software-development` 在现有 browser 工具镜像上增加 pnpm、uv、C/C++ 编译工具、SQLite、PostgreSQL 17 和 pgvector。用于 TypeScript / Next.js、Python / FastAPI 项目的编码、构建、测试和浏览器验收。项目依赖按项目锁定，不全局安装 React、FastAPI、模型权重或项目代码。

统一标识如下；镜像清单的 purpose 必须与后台 templateKey 一致，否则 SSH 握手拒绝申请。

| 字段 | 值 |
| --- | --- |
| 显示名称 | 软件开发 |
| Service Key / 服务类型 | `byclaw-tools-software-development` |
| templateKey / purpose | `software-development` |
| 镜像标签 | `D0.6.0_software-development` |
| 基础镜像 | `192.168.0.81:8080/byclaw/byclaw-harness-tools:D0.6.0_browser` |
| 启动命令 | `/usr/local/bin/byclaw-software-development-entrypoint tools` |

## 构建与大小验收

从 ByClaw 仓库根目录为 `linux/amd64` 构建。发布时固定已验证的 browser 父镜像摘要；候选标签通过验收后才更新正式标签、复制到 ACR。构建与发布是独立操作，本实现不修改在线配置。

```bash
docker build --platform linux/amd64 \
  -f middleware/byclaw-harness/Dockerfile.tools.software-development \
  --build-arg BROWSER_IMAGE='192.168.0.81:8080/byclaw/byclaw-harness-tools@sha256:<已验证摘要>' \
  -t byclaw-harness-tools:software-development-candidate .

bash middleware/byclaw-harness/scripts/tool-software-development-smoke.sh \
  byclaw-harness-tools:software-development-candidate
```

使用 Podman 时设置 `CONTAINER_ENGINE=podman`。smoke 脚本先导出尚未启动的镜像文件系统，**rootfs tar 达到 4 GiB（4,294,967,296 字节）即失败**，再创建自己的隔离容器测试真实 SSH、数据库认证、向量计算、项目数据库继承扩展、重启数据恢复和凭据轮换。导出量包含 tar 开销，与压缩仓库传输量、容器引擎报告大小分开记录。没有运行该检查不能声称镜像已小于 4 GiB。

体积策略：复用已精简的 browser 层；APT 使用 `--no-install-recommends`；不初始化数据库到镜像；安装与清理缓存在同一层完成；不带源码仓库、项目依赖、GPU/Java/Office/媒体/游戏引擎。继承层无法通过后续删除缩小，父镜像过大时需先处理父层。系统 Debian 包版本记录在 `/usr/local/share/byclaw-tool-sandbox/debian-packages.tsv`。

PostgreSQL 固定大版本 17；pgvector 默认使用 Debian 13 的 `postgresql-17-pgvector=0.8.0-1`，通过 Debian 签名的国内 APT 源安装，不在构建时访问 PGDG 或 GitHub。若更改扩展包版本，显式传入 `PGVECTOR_PACKAGE_VERSION` 并重新验收。pnpm/uv 默认版本沿用仓库约定，可通过构建参数升级。

构建使用现有国内源配置器，Node headers 的 node-gyp 新旧配置和新增 uv 设置也写入 SSH 会话环境。`UV_PYTHON_DOWNLOADS=never` 禁止自动拉取另一套 Python。正式验收仍需实际执行项目的 `pnpm install --frozen-lockfile`、`uv sync --locked` 和原生模块构建，检查真实下载地址；第三方安装脚本、Git 依赖和项目显式索引可能绕开缺省源，不能仅凭环境变量或版本号宣布全部来源已验证。

## 数据库启动和访问

入口先检查数据目录并获得独占锁，以 `postgres` 系统用户初始化/运行 PostgreSQL，等待真实 SQL 连接，再启动原有工具 SSH/浏览器入口。工具或数据库任一退出时回收另一侧；SIGTERM 先停止工具，再用 PostgreSQL fast shutdown 关闭数据库。容器/云平台停止宽限建议至少 45 秒，避免在正常退出期间强制终止数据库。不会修改已有错误大版本目录，也不会递归改写挂载目录所有权。

数据库只监听 `127.0.0.1`，不发布 5432。Unix socket 使用 peer 认证，TCP 使用 SCRAM；没有 trust 认证和固定口令。开发角色 `byclaw` 有 CREATEDB 权限，但无 SUPERUSER、CREATEROLE、REPLICATION、BYPASSRLS。入口在 `template1` 安装 vector，使新建项目数据库自动继承扩展；默认开发库也检查扩展。

SSH 执行会话自动获得 `PGHOST`、`PGPORT`、`PGUSER`、`PGDATABASE`、`PGPASSWORD` 和 `DATABASE_URL`。通过容器 exec 排查时需使用 `byclaw` 用户加载权限为 0600 的运行时文件：

```bash
source /run/byclaw-software-development/client/database.env
psql -X -c "SELECT '[1,0]'::vector <-> '[0,1]'::vector;"
createdb example_dev
createdb example_test
pg_dump -Fc example_dev > /by/example_dev.dump
```

不要输出或提交该环境文件/数据库 URL。每次启动重新生成开发角色口令，清理运行时凭据后退出；旧实例的应用进程不跨越这个生命周期。

| 环境变量 | 默认值 / 约束 |
| --- | --- |
| `BYCLAW_SOFTWARE_DEVELOPMENT_PGDATA` | `/var/lib/postgresql/software-development/17/data`，沙箱本地 |
| `BYCLAW_SOFTWARE_DEVELOPMENT_DATABASE` | `development`，小写字母开头，只含小写字母、数字、下划线，最长 63 字符 |
| `BYCLAW_SOFTWARE_DEVELOPMENT_PGPORT` | `5432`，1024–65535，仍仅回环地址 |
| `BYCLAW_SOFTWARE_DEVELOPMENT_STARTUP_TIMEOUT` | `60` 秒，5–300 秒 |

默认模式在同一容器 stop/start 或 restart 后保留数据库，但**删除/重建沙箱不会保留本地数据**。迁移文件、种子数据和必要的 `pg_dump` 导出应保存在用户工作区。初始化、角色和扩展设置是工具镜像内部的运行时引导，不涉及 ByClaw 业务库迁移或初始化 SQL。

如需数据库目录跨实例持久化，另挂经过数据库验证的本地/块存储目录，并指定 PGDATA。新挂载目录为空时入口创建并赋予 postgres 所有权；已有数据目录必须由镜像内实际 postgres UID 持有。不要猜 UID、递归 chown 用户工作区或挂载同一个目录给多个数据库进程。脚本拒绝已识别的 NFS/CIFS/FUSE/9p 数据目录；普通 `/by` 文件读写成功不证明其数据库持久化语义合格。PG17 数据不能直接交给其他大版本启动，升级使用导出/恢复或专门迁移。

## 后台配置示例

打开“沙箱配置管理 → 沙箱配置 → 沙箱基础配置 → 工具沙箱市场”，新增显示名称“软件开发”、Service Key 和服务类型 `byclaw-tools-software-development`。将 [Spec JSON 示例](tool-sandbox/software-development.spec.example.json) 填入 Spec JSON，确认镜像已经发布到示例指向的 ACR 仓库后启用。示例是 Spec JSON 对象；调用 saveServiceSpec API 时应将其序列化成字符串字段 `specJson`，不要将对象直接当成该 API 的字符串字段发送。

示例沿用现有个人 `/by` 挂载、运行时 SSH 密钥注入、私有 SSH WebSocket 8080 和带平台认证的浏览器查看端口 8081。浏览器为 eager，避免平台等待声明的 8081 端口而无法获取执行租约。应用的 3000/8000 等端口不列入启动就绪要求；单机项目可先通过同沙箱浏览器访问回环地址，直接链接预览需要单独配置访问入口。数据库端口不加入后台 ports。

资源示例：保障 2 核/4Gi、上限 4 核/8Gi；平台如不区分保障和上限，以平台实际资源为准。系统盘和用户工作区合计建议从 40 GiB 起步，**磁盘配额由云平台配置，不由 EXPOSE 或该示例隐式创建**。项目依赖、构建产物、数据库和 WAL 不属于 4 GiB 镜像预算。

镜像/配置更新后重建云模板，再用新实例验收；已有实例保留原模板。MicroVM 的启动命令必须使用数据库入口，不能仅依赖 Docker ENTRYPOINT。云模板不能快照运行时 SSH 身份、开发数据库凭据或用户数据；每个实例恢复后注入独立 SSH 密钥并运行入口。只生成 READY 模板不等于真实 A→B 远程执行可用。

## 验证入口

```bash
# 静态协议、窄构建上下文和路径检查；不要求容器服务。
python3 -m unittest discover -s middleware/tests -p 'test_software_development_sandbox.py' -v

# 将仓库只读挂载到隔离候选容器，使用独立网络命名空间。
# 测试入口替换浏览器/SSH子进程，真实测试 PostgreSQL；不替代完整镜像 smoke。
docker run --rm --network none --entrypoint python3 \
  -e BYCLAW_SOFTWARE_DEVELOPMENT_INTEGRATION=1 \
  -v "$PWD:/source:ro" \
  byclaw-harness-tools:software-development-candidate \
  /source/middleware/tests/test_software_development_sandbox.py -v
```

完整验收还需运行继承浏览器的 `scripts/tool-browser-slim-smoke.sh IMAGE`，并在目标云平台用匹配的 Harness 申请真实 `software-development` 租约，验证 SSH/helper/PTC 命令、文件往返、数据库、Next.js 构建、FastAPI 服务和浏览器页面操作。检查数据库退出、工具退出、SIGTERM、重启、错误数据版本和新用户工作区，不将本地版本输出当成云端业务就绪。
