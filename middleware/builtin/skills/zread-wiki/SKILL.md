---
name: zread-wiki
description: |
  使用本机 Zread CLI 为已经存在的本地代码仓库生成或续传 Wiki 文档。
  当用户要求基于代码仓库生成 Wiki、项目文档、代码导读或继续未完成的 Wiki 生成任务时使用。
---

# Zread Wiki

直接使用镜像中已安装的 `zread` CLI，不调用任何插件内置的 Wiki 包装工具。

## 边界

- Zread 不负责克隆、拉取或更新仓库。先确认目标仓库已经存在；需要准备代码时，单独使用 Git，并复用 Git 返回的路径。
- 不因再次生成或续传而重新克隆仓库。
- 仓库位置由用户或 Git 操作决定，不写死到某个公共目录。
- 文档由 Zread 写到目标仓库内的 `.zread/wiki/`。不要把输出移动到固定的全局目录。
- 模型配置由 `baiying-enhance` 在运行时同步。不要执行 `zread login`、`zread update`，也不要在命令参数、消息或日志中传递 API Key。

## 生成与进度

进入目标仓库根目录后运行：

```bash
zread generate --stdio -y --draft resume --skip-failed
```

必须保留 `--stdio`，持续读取 stdout 的 JSON-line 事件并向用户反馈阶段、页面和完成进度。不要等命令结束后才一次性报告。

命令成功后，确认 `.zread/wiki/` 存在并报告其仓库内相对路径。命令失败时，报告 Zread 返回的错误和当前仓库路径；不要删除已有草稿或文档。只有用户明确要求从头生成时，才把 `--draft resume` 改为 `--draft clear`。
