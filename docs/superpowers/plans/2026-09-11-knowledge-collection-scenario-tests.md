# knowledge-collection 场景矩阵与测试结果

日期：2026-09-11。依据：`../specs/2026-09-11-agent-reach-channel-dispatch-design.md`，以及现有 knowledge-collection 工作流。

## 结果与证据边界

- knowledge-collection 全部 38 个 Node 测试文件通过（TAP 汇总 632 项，包括新增 96 项场景）。其中部分旧文件使用自定义 harness，Node 将整个文件计为 1 项；此数不是业务场景数或代码覆盖率。
- mail 的 2 个 Node 测试文件通过：33 项；Python unittest：175 项通过。
- 技能文档契约检查：knowledge-collection 62 项、agent-reach 11 项通过。这些检查不能证明大模型在自然语言场景中必然正确选路。
- 新增场景首次运行 79 通过、17 失败；修复输入类型校验后 96/96 通过，并完成上述全量相关回归。
- 测试运行真实的本地路由、状态持久化、文件物化、授权及发布代码；外部服务调用使用测试替身。未在本轮连接线上 BE、真实邮箱或企业平台，未验证真实账号登录、真实服务协议兼容性与线上镜像。

## 业务场景矩阵

以下“通过”表示对应自动化场景通过，不表示该类别所有可能输入已被穷尽。测试路径以 `middleware/openclaw/skills/knowledge-collection/scripts/` 为基准；邮件测试以 `middleware/openclaw/skills/mail/` 为基准。

| ID | 场景及操作 | 预期 | 测试依据 | 结果 |
|---|---|---|---|---|
| 01 | 分别指定公网、钉钉、飞书、企微、IMA、项目云盘、邮件 | 7 个渠道分别交给固定工作流；只有邮件进入 mail | routing/scenarios R01 | 通过 |
| 02 | 仅授权一种来源，尝试访问其他六种来源 | 42 种组合全部拒绝，不扩大 sourceScope | routing/scenarios R02 | 通过 |
| 03 | 明确从 IMA 收集 5 篇 | 数量要求不将企业来源转为 public-collect | routing/scenarios R03 | 通过 |
| 04 | 公网和项目云盘联合采集，但只授权其中之一 | 执行前拒绝缺失来源授权 | routing/scenarios R05 | 通过 |
| 05 | 公网和云盘都授权，一侧失败 | 保留成功一侧数据及失败原因，物化按各自来源执行 | unified-search、unified-candidates | 通过 |
| 06 | 未显式授权邮件的旧会话 | 默认来源不自动增加 mail | routing/integration、knowledge-collection | 通过 |
| 07 | selector/criteria/budget/options 输入 null、false、0、空字符串、数组 | 错误类型报 INVALID_REQUEST，不能当作省略 | routing/scenarios V01/V02 | 修复后通过 |
| 08 | 未知版本/渠道/操作、任意命令、凭据字段、非法预算 | 拒绝，且不写执行计划 | routing/scenarios V03 | 通过 |
| 09 | 查询被改写、日期区间反转、时区缺失或非法 | 拒绝改变任务语义 | routing/scenarios V03、public-discovery | 通过 |
| 10 | 重复 JSON 键，包括转义后同名键 | 严格解析拒绝歧义 | routing/integration | 通过 |
| 11 | evaluate 能力探测 | 不创建计划；未授权或未知能力不能执行 | routing/dispatcher、routing/integration | 通过 |
| 12 | mail 账号缺失、歧义、未绑定或只支持列表 | 停止；不能读取正文或偷偷换账号 | routing/scenarios、routing/integration、mail collection-facade | 通过 |
| 13 | 浏览器邮箱与 projected 邮箱能力不同 | 由 mail 协商能力；缺失能力元数据保留 unknown | mail collection-facade、mail Python | 通过 |
| 14 | 重复 resolve 相同输入 | 重用计划且保留原截止时间 | routing/dispatcher | 通过 |
| 15 | 重复 dispatch 已完成计划 | 重用已校验回执，执行器只运行一次 | routing/dispatcher | 通过 |
| 16 | resolve 后授权范围、查询或账号 revision 变化 | 旧计划失效 | routing/scenarios A01、routing/dispatcher | 通过 |
| 17 | 手工改变 plan 渠道或提交其他账号/旧 revision 的候选 | 拒绝调度/物化，不跨账号重用发现授权 | routing/scenarios A02/A03 | 通过 |
| 18 | 未经已提交 discovery，直接请求 materialize | 拒绝未登记候选 | routing/dispatcher、mail collection-facade | 通过 |
| 19 | 同一计划并发 dispatch | 只允许一个执行器 | routing/dispatcher | 通过 |
| 20 | 活跃计划期间启动另一计划或旧式写命令 | 排他锁阻止重复执行及竞争写入 | routing/scenarios S01 | 通过 |
| 21 | 执行器异常或执行进程消失 | 持久化 interrupted；不自动重启，不泄露原异常 | routing/dispatcher、routing/integration | 通过 |
| 22 | 父任务已过期 | 执行前停止，不触发读取 | routing/scenarios B01 | 通过 |
| 23 | 邮件分页、不同 attempt 继续采集 | 共用扫描额度和绝对截止时间，不能重置预算 | routing/integration、mail collection-facade | 通过 |
| 24 | 原企业/公网工作流收到不支持的新预算契约 | 明确拒绝，不伪称支持严格预算 | routing/integration | 通过 |
| 25 | 邮件标题未命中、正文命中；大小写变化 | 有界读取正文匹配，计入扫描预算 | mail collection-facade | 通过 |
| 26 | 邮件日期边界、本地日期时区、排他结束时间 | 按指定时区筛选，不依赖宿主时区 | mail collection-facade | 通过 |
| 27 | 空邮箱成功、认证失败、部分邮件读取失败 | 区分空结果/失败/部分成功，保留已获取正文 | mail collection-facade、routing/integration | 通过 |
| 28 | A 邮箱失败，B 邮箱成功 | B 不覆盖 A 的失败；父任务不能误判完成 | routing/integration | 通过 |
| 29 | 空邮箱分别采用 candidates/selected/all 交付目标 | candidates 可完成发现；selected/all 不算已交付 | routing/scenarios D01 | 通过 |
| 30 | 正文获取成功但附件下载失败 | 保留正文，状态 partial，deliveryComplete=false | routing/scenarios M01、routing/integration | 通过 |
| 31 | 附件重复下载、超额、类型不支持 | 复用已校验文件，累计计费；拒绝不支持或超预算文件 | mail collection-facade | 通过 |
| 32 | 附件丢失、内容篡改、路径越界或符号链接 | 交付/回执校验失败，不发布越界文件 | routing/integration、routing/dispatcher、mail wrapper | 通过 |
| 33 | 邮件正文与已登记附件正常物化 | 经现有 collection writer 发布，附件保留关联 | routing/integration | 通过 |
| 34 | 父任务要求全文，子请求仅要求摘要 | 不降低父任务交付门槛 | routing/scenarios R04、delivery-state | 通过 |
| 35 | 公网指定 URL 及数量 | 先处理授权 URL；优先级有序；达到去重数量后停止 | public-collect | 通过 |
| 36 | 搜索空结果、无效 JSON、登录页或数量不足 | 有界 fallback；两次尝试后不能无限重试 | public-discovery | 通过 |
| 37 | 在线搜索与热点渠道单侧/双侧失败 | 单侧成功保留数据和诊断；双侧失败明确失败 | public-discovery、online-search | 通过 |
| 38 | 结果不相关、两个 URL 正文相同、伪文章页面 | 不计入有效篇数，不创建重复物化项 | candidate-quality、topic-relevance、candidate-verifier | 通过 |
| 39 | 普通网页、微信文章、arXiv 论文 | 使用各自解析与清洗规则，验证内容结构 | web-materializer、wechat-materializer、arxiv-materializer | 通过 |
| 40 | 网页重定向、跨站链接、IP/端口/私有域名 | 只允许获授权的跳转；越界拒绝并脱敏诊断 | url-authorization、discovery-authorization、web-acquirer | 通过 |
| 41 | 验证码暂停、验证器异常、物化前崩溃后恢复 | 原工作流拥有恢复；复用持久证据并清理浏览器状态 | candidate-verifier、public-collect、probe-state | 通过 |
| 42 | 钉钉/飞书/企微/IMA/云盘发现与物化 | 保持各来源解析、授权、错误及分页语义 | enterprise/adapters、enterprise/shared、enterprise-collection | 通过 |
| 43 | 企业 paused/unavailable 状态经统一门面返回 | 不变成空成功；保留需用户操作或失败语义 | routing/integration | 通过 |
| 44 | crawl 与研究流程状态推进、旧会话恢复 | 继续使用原状态机及恢复规则 | crawl-state、knowledge-collection、enterprise/shared/resume | 通过 |
| 45 | 发布前文件缺失/变更、未完成、数量不足 | deliveryComplete=false，避免不完整交付 | delivery-state、candidate-verifier、publish-delivery | 通过 |
| 46 | 正常采集、粒度不足及修复、下游消费 | 状态、清单、粒度与发布门槛保持一致 | collection-state、granularity-repair、downstream-policy | 通过 |

## 发现并修复的问题

`routing/dispatcher.mjs` 使用 `request.criteria || {}` 等默认值表达式，导致显式错误值被折叠成默认对象；工作流 options 又在转换后才检查形状，空数组也变为对象。新增 20 个类型边界用例中 17 个失败（另 3 个数组用例原本已拒绝）。

修复：在默认值、能力协商与参数转换之前，统一校验已提供的 selector、criteria、budget、options 必须是非数组对象。省略字段仍沿用原默认值。新增场景完整覆盖上述回归，并将渠道 owner 期望写为独立常量，避免从被测注册表计算期望值。

## 尚需真实环境或模型行为验收的场景

以下已列入矩阵边界，不能用本地模拟通过替代：

| 场景 | 真实验收预期 | 本轮状态 |
|---|---|---|
| 用户只说“找 5 篇资料”、明确 IMA、指定邮箱、多来源、直接粘贴内容 | 模型按设计选路；直接内容不额外获取；明确来源不扩大 | 未执行模型行为验收；仅文档契约检查通过 |
| 邮件包含外部文章 URL，但只授权 mail | 不自动访问外链；新增公网授权后才能另行请求公网 | 已测跨渠道授权拒绝；未执行自然语言端到端验收 |
| 真实浩鲸邮箱与 QQ/projected 邮箱 | 登录上下文、正文、分页、附件与真实响应一致 | 未连接真实服务 |
| 真实账号过期、扫码/MFA、浏览器切换账号 | 停止并返回明确操作要求，不误用其他账号 | 本地错误/绑定变化分支已测；真实 UI 未测 |
| 线上 BE 沙箱和部署镜像 | bycli、bridge、mailctl 可用且版本一致 | 本轮未部署或连接线上 |
| 大邮箱、弱网、大附件、强制杀进程 | 实测资源上界、持久状态和恢复不重复执行 | 预算/失活 owner 分支已测；未做生产压力或真实进程故障注入 |
| 附件内部内容解析后入库 | 由后续解析/入库能力独立证明完成 | 本轮只验证附件下载与交付，不把下载视作解析完成 |

统一路由不支持的 resource 等操作按设计边界显式拒绝；原有工作流入口仍由其原执行器负责。本报告不宣称所有操作已具备统一门面支持，也不宣称穷尽所有状态组合。

## 重跑命令

在仓库根目录执行，所有命令为本地测试：

```bash
rtk proxy node --test middleware/openclaw/skills/knowledge-collection/scripts/routing/scenarios.test.mjs
rtk proxy python3 -m unittest discover -s middleware/openclaw/skills/mail/tests -q
rtk proxy python3 -m unittest discover -s middleware/openclaw/tests -p test_knowledge_collection_skill.py -q
rtk proxy python3 -m unittest discover -s middleware/openclaw/tests -p test_agent_reach_skill.py -q
```

全量 Node 使用 Python 枚举 knowledge-collection/scripts 下所有 `*.test.mjs`，加上 mail/scripts 下两个 `*.test.mjs`，对每个文件执行 `node --test <file>`；本轮并发数 3、每文件超时 180 秒。输出位于 `/tmp/kc-scenario-final/`，逐文件退出码记录于 `results.json`。首次失败及修复后新增场景日志分别为 `/tmp/kc-scenarios-red.log`、`/tmp/kc-scenarios-green.log`；这些临时日志可能被系统清理，下表保存本轮汇总。

最初尝试 pytest 时环境无该模块，随后使用项目测试实际采用的标准库 unittest 成功运行，无需安装依赖。

## 逐文件执行记录

| 测试文件 | TAP 项数 | 退出码 |
|---|---:|---:|
| `middleware/openclaw/skills/knowledge-collection/scripts/arxiv-materializer.test.mjs` | 9 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/baseline-audit.test.mjs` | 6 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/candidate-quality.test.mjs` | 20 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/candidate-verifier.test.mjs` | 15 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/collection-state.test.mjs` | 7 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/crawl-state.test.mjs` | 1 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/delivery-state.test.mjs` | 5 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/discovery-authorization.test.mjs` | 23 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/downstream-policy.test.mjs` | 1 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/cloud-knowledge.test.mjs` | 4 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/dingtalk.test.mjs` | 26 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/feishu.test.mjs` | 5 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/fws.test.mjs` | 21 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/ima.test.mjs` | 33 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/enterprise/adapters/wecom.test.mjs` | 20 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/enterprise/dispatcher.test.mjs` | 18 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/resume.test.mjs` | 5 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/enterprise/shared/shared.test.mjs` | 130 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/enterprise-collection.test.mjs` | 1 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/granularity-repair.test.mjs` | 10 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/knowledge-collection.test.mjs` | 1 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/online-search/provider.test.mjs` | 9 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/online-search/tencent-wsa.test.mjs` | 10 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/performance-summary.test.mjs` | 5 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/probe-state.test.mjs` | 7 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/public-collect.test.mjs` | 7 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/public-discovery.test.mjs` | 31 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/publish-delivery.test.mjs` | 22 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/routing/dispatcher.test.mjs` | 9 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/routing/integration.test.mjs` | 13 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/routing/scenarios.test.mjs` | 96 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/topic-relevance.test.mjs` | 13 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/unified-candidates.test.mjs` | 2 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/unified-search.test.mjs` | 5 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/url-authorization.test.mjs` | 5 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/web-acquirer.test.mjs` | 18 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/web-materializer.test.mjs` | 14 | 0 |
| `middleware/openclaw/skills/knowledge-collection/scripts/wechat-materializer.test.mjs` | 5 | 0 |
| `middleware/openclaw/skills/mail/scripts/collection-facade.test.mjs` | 16 | 0 |
| `middleware/openclaw/skills/mail/scripts/iwhalecloud-mail.test.mjs` | 17 | 0 |
