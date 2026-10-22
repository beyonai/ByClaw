# 构建末尾 byCLI 重连校验竞态修复（2026-10-22）

用户构建日志的 `runtime 33/35` 已完成 byCLI 2.1.73 安装、版本及扩展检查；失败在 `runtime 35/35` 的 `browser-supervisor-verify.py`，断言缺少 `byCLI Browser Bridge reconnected`。不是 npm 安装或插件编译失败。

原测试在假 daemon 写入第二次调用计数、status 计数达到 3 时立即向 supervisor 发 SIGTERM。调用计数是在子进程完成前写入的；这时 supervisor 可能仍在等待 daemon 重启。SIGTERM 会转发给该子进程，重连流程被测试自己终止，因此后续“重连完成”断言失败。

修复只涉及构建校验脚本，两个 Dockerfile 原有 COPY/RUN 会自动带入修复，无需修改生产启动策略或版本参数：

- 等待 supervisor 实际输出重连完成事件后再发送 SIGTERM，仍检查退出码、断开/恢复事件和 daemon 重启次数。
- watchdog 恢复、短暂断线与浏览器 generation 恢复统一使用该等待条件。
- 使用临时文件接收 stderr，超时/提前退出时附带诊断，finally 负责关闭测试进程。
- 成功恢复场景的测试 readiness 预算由 0.5 秒调整为 2 秒，以覆盖单核模拟构建下的进程调度；生产超时及失败场景的短超时保持原值。
- 假 daemon/status 的恢复过程加入 150 ms 延迟，使“已调用”与“已完成”明确分离；旧 watchdog 测试在此夹具下复现原断言失败。
- 新增真实恢复失败的负向测试，确保等待逻辑不能把失败当成就绪。

验证：本机 supervisor 回归通过；Podman linux/amd64、1 CPU/2 GiB 下定向构建执行 Dockerfile 末尾的下载目录权限、supervisor（22 场景）、entrypoint FD 三项校验通过。三个恢复场景在相同 Linux 单核容器中各连续重复 3 轮，9/9 通过。两份 Dockerfile 布局检查及 `git diff --check` 通过。此次复用已有本地运行时镜像，只重建并验证失败步骤的脚本链，没有重新构建整张业务发布镜像，也未部署 ACS。Git hook 全量测试按用户要求跳过。
