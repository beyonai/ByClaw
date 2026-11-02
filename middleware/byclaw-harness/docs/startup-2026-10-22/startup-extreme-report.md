# Harness 启动优化：持久路径解析、类型产物与浏览器首用

2026-10-22。目标是缩短真实 Worker/Web 可服务时间；用户自行构建部署 ACS，本轮不操作线上实例。

## 本轮实现

1. 浏览器 supervisor 保留私密 FD、首次调用唤醒、进程回收及异常关闭职责。原 `browser/byCLI on-demand; DSH starting` 并不表示启动 Chromium/byCLI。现在连持久化浏览器 profile 的 mkdir 与独占锁也移到首次浏览器调用前；不用浏览器就不访问该目录。`eager` 仍在启动 DSH 前完整检查。根入口的四次目录初始化合并为一次。
2. 编译 CLI 通过镜像内 preload 优化包名解析。只有 entrypoint 管理的两个 `node_modules` 链接与镜像布局一致时才启用，把查包起点换到对应本地路径。保留 Node exports、import/require 条件、包自身引用优先级、自定义祖先包回退及相对插件路径；异常布局走原解析，不缓存缺失包。
3. Typert 加载的是已经构建的类型产物。其 `require.resolve` 不经过上述 ESM hook，本轮单独将解析目录规范化为本地路径，再交给 Node 检查 exports。没有跳过类型校验或插件注册。
4. 前端资源的 source map section 只在字节快照变化时序列化一次，组合时复用相同 JSON 内容。JS、map、revision URL 保持逐字节一致；移除插件和 HMR 仍更新当前图，并只保留原约定的一代旧 URL。
5. supervisor 新增 `startup phase=prepared` / `startup phase=cli-spawned` 毫秒日志，区分 CLI 之前的准备开销。

两个 Dockerfile 同步携带补丁、编译产物和 preload；无需新增 `.env` 参数。修改仅在 ByClaw 所有的构建脚本/插件集成中，未编辑只读上游 DSH 仓库。

## 测量方法及结果

最终候选版本补齐包自身引用优先级后重新完成 12 次测量。以下均为三轮中位数：

| 条件 | CLI → integration | run → Worker | run → Web |
|---|---:|---:|---:|
| 本地正常文件系统 | 4.279 → **4.089 s** | 6.932 → **6.537 s** | 7.357 → **7.131 s** |
| 每次持久路径调用额外 5 ms（模拟） | 6.757 → **4.705 s** | 9.410 → **7.298 s** | 9.798 → **7.771 s** |

12 次均 Worker 上线、HTTP 200、无资源同步/Skill 同步错误。持久目录前缀的 `realpath` 调用稳定从 **331 → 28 次（减少约 91.5%）**；这是 JS 调用统计，不是 NFS RPC 统计。

原始计时：[普通环境](extreme-benchmark.json)、[延迟模拟](extreme-nas-benchmark.json)。候选运行镜像 ID：`2db8110a0132`，对照镜像 `0a800057063c`；它们仅用于本地验证，不是 ACS 已部署镜像。


环境：Mac Podman applehv，linux/amd64 模拟，容器限制 1 CPU / 2 GiB。原版使用此前已发布的 client composition 优化；候选叠加本轮改动。使用相同镜像基础、相同只读业务输入和隔离 Redis，59 名员工、6 个群组、43 条 Skill 关联，启用 agent routing。每组交错运行三轮，每轮新建容器；宿主/镜像页缓存未清空，不是物理机首次读盘测试。

CLI → integration 从同一个宿主日志采集器计算两条标记的时间差；Worker/Web 从 `podman run` 调用开始计时，包括本地启动器开销。HTTP 200、Worker online、资源同步无错误分别检查。这里只证明启动及针对性运行契约，不代替真实模型对话和全部工具的线上验收。

持久路径延迟模拟在选定的 JS 同步 fs 调用上增加 5 ms，用于检查对持久路径开销的敏感性。调用次数不等于 NFS RPC 数，5 ms 也不是测得的 ACS/NAS 延迟，不能把模拟结果当作云端数据。

## 验证证据

- 先在旧产物复现新增性能断言失败：相同大型 source map 序列化 2 次，要求 1 次；新产物通过。
- `tsc -b` 与官方 `tsdown` 构建通过；compiled Typert resolver 的优先级、exports 拒绝、自定义祖先、自引用和新增包检查通过。
- client-modules 上游 41 项 + Typert loader 上游 16 项通过；4 代 JS、source map SHA-256 与 revision URL 对照完全一致。
- Node 解析兼容性夹具在宿主和镜像 Node 22.19.0 通过，包含 ESM/CJS 条件、相对插件、自引用、包优先级、缺失包、私有子路径和自定义布局回退。
- supervisor 23 个场景在宿主和 Linux 镜像通过，涵盖 on-demand 首次激活、无调用退出、首用锁冲突、重连和并发。新增断言验证首次调用前不创建持久 profile。
- 新编译 CLI preload 路径的 FD 回归通过：一次性读取后清理环境，子进程无法继承读取凭据。
- Skill 懒加载/同一 Skill 并发合并、后续再次检查版本、授权撤销、关联变化、重试和释放验证通过；授权目录/版本缓存检查通过；真实 DSH Skill runtime 25 项通过。
- 两个 Dockerfile 布局检查、entrypoint 持久目录/用户补丁保留、模块布局迁移重复执行、补丁版本/未知源码拒绝及幂等检查通过。
- 构建验证使用既有基础/插件 builder 的定向产物重建和最终运行镜像，未重新下载、构建完整基础镜像。Git hook 全量测试按用户要求跳过；未宣称完成全仓库全量测试。

## 全链路复核与边界

| 环节 | 本轮处理 |
|---|---|
| ACS 分配、卷挂载、镜像缓存/拉取 | 属于云端启动流程，用户自行维护，本轮没有更改 |
| supervisor 与浏览器 | 推迟浏览器持久目录/锁，保留 FD、生命周期及首次调用安全边界 |
| CLI/插件编译 | 已使用编译 JS；本轮继续优化解析及资源组装，没有把未就绪服务提前报 ready |
| 包/类型加载 | 降低 NAS 前缀解析；相同包身份、导出条件和类型校验保持 |
| 前端资源 | 缓存不变 map 序列化，保留 source map 和热更新，不删除调试能力 |
| integration | 保留会话元数据、授权资源同步、模板代际发布与真实 Worker 注册 |
| Skill | 保留首次调用懒加载、版本比对、缺失/变更更新和撤权拒绝，不在启动下载所有 Skill |

继续将所有 Cordis/Zod 等包跨插件打成一个大 bundle 需要额外验证服务单例和类型身份；本轮没有为追求一个数字引入这种运行语义变化。当前同机无 NAS 延迟时收益较小，主要优化的是持久路径延迟累积；剩余 JS 加载、插件注册和授权同步仍有必要成本，不能称为不存在进一步优化空间。

## ACS 验收

最新已读线上样本是 2026-10-22 18:02:52 创建的 Pod，UID `131ae239-4ed4-4089-9cf4-1bbbe65b8cdd`，同名沙箱 `byclaw-5b15977d612f1976d9f7dcf95cf5ada6`。本轮改动尚未部署；该样本 CLI → integration **18.588 秒**、Pod → Worker **36.968 秒**、Pod → Web **38.454 秒**。

用户构建并更新业务镜像后，应以新 Pod UID 和 image digest 确认生效，再独立记录 Pod 创建、容器启动、supervisor prepared、CLI、integration activate、资源发布、Worker ready 和 Web 服务时间。Kubernetes Ready/platform RUNNING 早于真实 Worker 的情况不能作为达标依据。**ACS 30 秒目标仍待新镜像实测，不能按本地比例推算。**

```mermaid
flowchart LR
  A[镜像构建：JS 与类型产物] --> B[入口准备与私密 FD]
  B --> C[本地包解析与插件注册]
  C --> D[复用前端资源与 map]
  D --> E[授权及模板同步]
  E --> F[Worker / Web 实际就绪]
  F --> G[调用 Skill：鉴权和版本更新]
  F --> H[调用 browser：取锁并启动浏览器]
```
