# @byclaw/dsh-idle-reporter

[English](README.md) | 中文

这个 DSH profile bundle 上报所在沙箱是否在干活。它把快照追加到所有沙箱共用的一个 Redis Stream；平台侧消费程序读取该 Stream，并释放上报 `releasable` 的沙箱。释放沙箱由平台负责；`DSH_HOME` 下的 DSH 会话在释放后保留。

## 什么算忙

满足以下任一条件时，沙箱为 **busy**：

- 任一会话中有存活的 Agent（根 Agent 或子 Agent）正在执行 turn，且没有在等用户；
- 有后台 job 处于 `running` 或 `stopping`。因此以 job 方式启动的常驻 dev server 会让沙箱一直保持存活。

等待审批或 ask-user 回答的 Agent 不算忙；子 Agent 在等用户时，它的父 Agent 也不算忙。等待中的 Agent 以计数形式上报。停在等用户的 turn 在空闲超时后同样可释放；恢复后该 turn 记为 interrupted，待回答的问题丢失，会话本身保留。

沙箱连续 `idleTimeoutMs` 不忙时为 **releasable**。空闲时间从进程启动开始计算。上报 `releasable` 前，插件会短暂确认没有 Agent 在执行状态仍为 idle 的维护任务（例如压缩）；若有，则保持 `busy` 直到下一次心跳。

## 已知限制

判断针对整个沙箱，而不是单个会话：任何会话里只要有 Agent 在干活或有 job 在跑，沙箱就是忙。下列情况只有在整个空闲超时期间都是沙箱里唯一在发生的事时，才可能导致误报 `releasable`。

| 情况 | 被算作 | 什么时候会有影响 |
|---|---|---|
| 父 Agent 在子 Agent 等审批时，并行跑另一个工具 | 空闲：父 Agent 被视为卡在等待中的子 Agent 上 | 只有当这个并行工具本身运行超过空闲超时，且审批一直没人处理时。DSH 自带的前台 Bash 上限远低于 30 分钟；现实中可能的是耗时很长的 MCP 调用。 |
| 在 DSH job 之外启动的进程，例如 Bash 里的 `nohup npm run dev &` | 空闲：DSH 看不到它 | 会实际发生。启动它的那一轮结束后，若空闲超时内没有其他工作，沙箱会被报为可释放，进程随沙箱一起被杀。DSH 自己放到后台运行的命令是 job，算忙。 |
| 由外部 provider（Claude Code、Codex、ACP）运行的子 Agent | 前台委派：忙，因为父 Agent 在等结果。后台委派：空闲，因为子 Agent 既不在 Agent 注册表里，也不是 job | ByClaw 镜像没有配置外部 provider，所以不会发生；进程内子 Agent 总能被看到（后台一次性子 Agent 是 job，可续接子 Agent 是 Agent）。 |

定时任务：ByClaw 镜像没有加载沙箱内的调度器（`web` profile 不含 `@deepseek-ai/dsh-schedule`）。ByClaw 聊天定时任务（`byclaw-cron-schedule`）运行在 ByClaw 服务端，释放沙箱不会让它们停止。

## 安装

ByClaw Docker 镜像会自动加载这个 bundle。其他环境下先构建，再加入 `web` profile：

```sh
pnpm --dir plugins/dsh-idle-reporter run build
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-idle-reporter
```

Redis 连接使用与 `@byclaw/dsh-integration` 相同的 `REDIS_*` 环境变量（standalone 或 cluster，经由 `@byclaw/by-framework`）。插件持有自己的连接。

## 配置

patch 插入 host 行 `byclaw-idle-reporter`。在该行设置 `disabled: true` 即可停用。

| 配置项 | 默认值 | patch 中的环境变量 | 含义 |
|---|---|---|---|
| `sandboxId` | `os.hostname()` | — | 写入每条记录的沙箱标识 |
| `streamKey` | `byclaw:dsh:sandbox:activity` | `BYCLAW_DSH_ACTIVITY_STREAM` | 所有沙箱共用的 Stream |
| `maxLen` | `10000` | — | Stream 近似上限（`MAXLEN ~`） |
| `idleTimeoutMs` | `1800000`（30 分钟） | `BYCLAW_DSH_IDLE_TIMEOUT_MS` | 变为 `releasable` 前的空闲时长 |
| `heartbeatMs` | `30000` | — | 快照记录的间隔 |

数值必须是正整数，字符串不能为空。配置非法，或 Redis 客户端无法创建（例如 `REDIS_MODE` 非法）时，插件记录一条错误并保持不工作；DSH 照常启动。

## Stream 记录

```text
XADD <streamKey> MAXLEN ~ <maxLen> * \
  sandboxId     <id>
  state         busy | releasable
  lastActiveAt  RFC 3339，沙箱最后一次忙的时间
  waitingUser   整数：阻塞在审批或 ask-user 上的 Agent 数
  agents        整数：正在干活的 Agent 数（诊断用）
  jobs          整数：running 或 stopping 的 job 数（诊断用）
  pid           整数：DSH 进程号
  at            RFC 3339，本条记录的产生时间
```

每条记录都是完整快照。追加时机：

- 启动时；
- 每次状态变化时，包括 `releasable` 之后重新开始干活的那一刻立即追加 `busy`；
- 每隔 `heartbeatMs`，无论状态如何。

同一时刻最多一个追加在进行；其间只有最新快照排在它后面。追加失败每次故障只记录一次日志，并由下一次心跳重试。Redis 不可达绝不会影响 DSH。关闭时插件停止定时器，不再追加任何记录。

## 消费方约定

平台消费程序（建议使用 consumer group 以获得至少一次投递）应当：

- 每个 `sandboxId` 只保留最新一条记录，并且读到 Stream 末尾后才行动；
- 最新记录为 `releasable` 时释放沙箱（随后 SIGTERM）。读取与 SIGTERM 之间仍存在新工作开始的窗口；这是可接受的，因为沙箱已空闲 `idleTimeoutMs`，且会话会保留；
- 启动宽限期过后，若某沙箱在 `3 × heartbeatMs`（默认 90 秒）内没有任何记录，视为已死并释放。静默是唯一的关闭信号，因此在该窗口内被 supervisor 重启的进程不会被误判为死亡。

## 验证

```sh
pnpm --dir plugins/dsh-idle-reporter run verify
```

观察线上 Stream：`redis-cli XREAD BLOCK 0 STREAMS byclaw:dsh:sandbox:activity '$'`。
