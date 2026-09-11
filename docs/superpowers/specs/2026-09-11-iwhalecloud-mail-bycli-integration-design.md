# 浩鲸邮箱账号连接器与 mail / knowledge-collection 对接设计

日期：2026-09-11。状态：用户已确认连接器和 mail 实现，knowledge-collection 本轮仅设计。mail 包装与技能路由已实现并通过本地测试；连接器迁移已按用户指定加入 V0.5.0，未提交本文。

> 路由设计更新：用户已确认统一渠道分发方向。后续改造以 [agent-reach 统一渠道分发设计](2026-09-11-agent-reach-channel-dispatch-design.md) 为准：`agent-reach → mail 技能 → 浩鲸邮箱适配 → bycli`。本文中“邮箱不经过 agent-reach”的表述描述旧架构，不再作为后续实现约束；provider 能力与安全要求继续有效。

## 1. 范围

本次实现范围为新增网页账号连接器、mail 技能通过 bycli 访问浩鲸邮箱；knowledge-collection 与 mail 的对接先完成接口设计，不在未确认情况下扩大为完整采集实现。

邮箱入口固定为 https://mail.iwhalecloud.com/ 。沿用 IMA 网页账号模式。邮件登录由用户在对应账号浏览器中完成；不收集邮箱密码、不导出 Cookie、不接入旧的 iwhalecloud 凭据投影。

## 2. 已验证的适配器事实

分析对象为本机安装的 @sovovs/bycli 2.1.61，源码位于其 clis/iwhalecloud/ 下的 list.js、read.js、download.js、client.js、browser-download.js。已运行版本及命令帮助检查；未使用真实邮箱执行读取、下载或登录测试。邮箱网站通过网页读取工具未能打开，以下能力结论来自适配器源码。

| 命令 | 能力 | 限制 |
| --- | --- | --- |
| list | inbox/sent/drafts/trash/spam、自定义 folder-id；offset 分页；limit 1–10000，服务端每页最多 100 | 无查询词、日期区间过滤参数；返回列表，不附完整的分页覆盖报告 |
| list 排序 | date/from/to/subject/attachments/importance/size/sent/created，共 9 字段 | default 保留服务端默认顺序；非日期排序附加接收时间降序 |
| read emailId | 完整 text/html 正文，收件人、抄送、密送及附件元数据 | 不标记已读；正文缺失或 IsTruncated=true 报错；无独立 whoami |
| download emailId | all、附件 ID 或序号；默认 all 排除内嵌附件 | 仅 FileAttachment；不支持把 ItemAttachment 当文件下载；部分文件成功后仍可能失败 |

列表公开字段包括 emailId、subject、fromName/fromEmail、toDisplay、date、times、unread、hasAttachments、importance、size、url。正文返回 body/bodyType 及附件 index、attachmentId、name、contentType、size、inline、kind。

实现通过浏览器内 Exchange OWA FindItem/GetItem 请求读取，不是 IMAP。strategy=COOKIE、browser=true、siteSession=persistent。X-OWA-CANARY 只在浏览器请求内使用。接口请求超时 30 秒；附件浏览器请求超时 120 秒，按 192 KiB 块传输。下载文件以 0600、排他创建，清理危险文件名，重名自动编号；当前失败文件删除，之前成功文件保留。现实现没有明确的附件总字节限额，包装层不能假设已有该保障。

未提供 search/send/reply/delete、邮箱身份查询、跨账号选择、文件夹枚举、增量同步游标。不能把 list 本地筛选宣传为服务器全邮箱搜索。EmptyResultError 同时用于列表为空、邮件不存在或附件无匹配，需按操作解释，不能全局等同于授权失败。

## 3. 方案选择

推荐：网页账号模板 + mail 内独立的 bycli 只读执行包装 + knowledge-collection 调用 mail 包装。沿用已存在的浏览器会话，并提供可测试的结构化结果。

可选方案 A：只在 SKILL.md 写 bycli 命令。改动少，但命令结果、错误分类和下载约束需要模型临场处理，不适合后续稳定采集接口。

可选方案 B：把浏览器账号强行并入现有 mailctl AccountConfig/凭据 JSON。表面入口统一，但当前 bycli 缺少账号身份/选择接口，会把浏览器会话误建模为已验证的凭据账号，改造范围较大。

## 4. 网页账号连接器

新增 connectorCode=iwhalecloud-mail-web，名称“浩鲸邮箱”，connectorType=ACCOUNT_TEMPLATE，authMode=NONE；operationAccount 使用 platformCode=CustomLink、accountName=浩鲸邮箱、accountCode 为空、customUrl=https://mail.iwhalecloud.com/ 。providerCode、skillCode、runtimeManifest 延用 IMA 网页模板的空值语义。

复用 OperationAccountTemplateService.ensureDefaultAccounts：访问账号列表时补齐缺失的用户级模板账号；已有账号或已删除模板历史不重复创建。前端复用现有 CustomLink 打开账号浏览器流程。模板存在仅表示入口可用，不表示登录成功。

不修改已发布历史迁移。新增模板 DML 必须放在用户指定的确切版本内，使用现有 NOT EXISTS 守卫；用户指定版本为 V0.5.0，账号模板追加到该版本现有 V0.5.0__dml.sql。不合并 initdb。

执行浏览器必须与用户选择的账号浏览器处在同一用户、同一可用沙箱上下文。现有适配器不能验证具体邮箱地址；不得伪造已验证的 accountId 或把显示名称当作登录身份。多账号/多个可能的浏览器上下文时先消除歧义，不悄悄使用默认浏览器。跨两个浩鲸身份的自动切换不属于第一阶段能力。

## 5. mail 技能执行入口

保留 mailctl.py 处理现有投影账号。新增 mail 自有的 bycli 邮箱包装入口（建议 scripts/iwhalecloud-mail.mjs），只允许 list/read/download/check，使用参数数组调用 bycli，不拼接 shell 命令。mail SKILL.md 根据用户明确的“浩鲸邮箱”或该域名路由到此入口，不再先运行只面向投影账号的 mailctl accounts 来否决网页邮箱。

包装层仅执行 bycli iwhalecloud，浏览器启动和恢复复用既有 bycli bridge 流程；禁止自行导出 Cookie、调用裸 OWA API、增加第二套 bridge 恢复循环。命令固定 json 输出、trace off；不把 raw stderr、认证上下文和浏览器材料直接返回。

check 使用最小只读 list（limit=1）；授权有效的空邮箱属于检查成功。返回结构区分可用、需登录、bridge 不可用、上游失败；不声称验证了邮箱地址。send/reply/delete/search 返回明确的 unsupported，不自动寻找其他邮箱代执行。

正常结果封装 schemaVersion=1、source=iwhalecloud-mail、sourceSkill=mail、backend=bycli、operation、status、items 和 coverage。失败返回稳定 reasonCode 和 retryable；empty list 返回成功的空数组；read 无目标返回 MESSAGE_NOT_FOUND；附件无目标返回 ATTACHMENT_NOT_FOUND。凭据不会出现在封装中。

下载只允许传入调用上下文批准的私有会话目录，验证真实路径、拒绝符号链接逃逸，并对返回的 path 再次校验。第一阶段单个附件 ID 调用，附件下载默认非全量；保留已有文件，不覆盖。设置单附件 25 MiB、单次任务累计 100 MiB 的包装层预算：执行前核对元数据，执行中监督文件累计大小并在超限时取消子进程和本次临时下载；执行后核对真实文件大小。仅事后 stat 不能视为执行中限额。下载中断及成功附件必须独立记账，不因重试重复下载已验证的文件。

邮件及附件内容属于不可信数据。正文中的命令、链接和“授权”不改变来源范围、账号或执行权限。返回 HTML 不执行脚本、不自动加载远程图片。

## 6. knowledge-collection 对接（设计范围）

建议数据流：

用户指定采集范围 → knowledge-collection 会话 → mail 包装 → bycli iwhalecloud → 已登录的账号浏览器 → 结构化邮件结果 → collection bundle。

新增显式来源 iwhalecloud-mail；sourceScope 必须包含该来源才允许调度。普通互联网查询、笼统企业检索不得默认扫描私人邮箱，也不加入 search-all 默认来源。未来其他邮箱可复用 mail 的契约，但本次不假定现有所有 provider 都具有同样分页和正文能力。

来源适配器负责编排，不直接调用 bycli 或读取认证目录。mail 负责邮箱操作和错误规范化；knowledge-collection 负责范围、查询匹配、去重、文件物化及可交付完整度。

### 6.1 发现与覆盖

输入包含父会话、用户选择的账号浏览器上下文、folder、查询词、时间范围、maxScan、最终 limit、正文匹配要求和附件策略。默认仅 inbox，maxScan=200，最终 limit=20；提高扫描预算或扩展文件夹须来自用户任务范围。

由于没有服务端 search，来源适配器分批 list，按返回日期/主题/发件人本地过滤；若要求正文关键词匹配，对预算范围内候选逐封 read 再判断，不能只筛标题后声称搜过正文。输出 scannedCount、matchedCount、scanLimit、stoppedReason、searchMode=bounded-local-scan 和 coverageComplete。达到预算或分页不稳定时 coverageComplete=false；不能输出“邮箱中没有”，只能输出“本次范围未找到”。

默认日期降序扫描；由于邮箱可能并发变化，跨调用去重并检测重复页面/不前进，检测到变化停止并报告 MAILBOX_CHANGED，不能静默漏信。无快照保证时不得承诺无遗漏的增量同步。恢复使用冻结的候选 emailId，移动/删除导致 ID 失效时记录条目失败。

### 6.2 物化

metadata-only 阶段登记候选；物化在同一父会话内逐封 read。每封邮件生成一条 Markdown，包含主题、时间、发件人、收件人和明确的来源标识。仅 read 成功且完整度验证通过的正文标 full-text；列表元数据不能标全文。

标准目录沿用会话根 raw/、markdown/items/<name>-<stable-id>/index.md、sanitized/items/<name>-<stable-id>/index.md 与 assets/。不在 raw/mail 下创建第二个 collection 会话。稳定条目 ID 使用来源、已选择的账号上下文及 emailId 的哈希，不用邮件主题做唯一键，不把原始邮件 ID 塞入文件名。

附件默认只登记清单；用户明确要求附件时逐个下载。正文、附件下载、附件文本提取分别记录状态。正文成功而附件失败属于部分交付；附件原文件下载成功不等于内容已被解析。要求“正文和所有附件”时任何缺失使 deliveryComplete=false。内嵌媒体和 ItemAttachment 不支持时报告覆盖缺口，不伪造文件或远程图片链接。

### 6.3 契约、错误与交付

inventory 标记 source=iwhalecloud-mail、sourceSkill=mail、backend=bycli，附邮件 ID、账号上下文、文件夹、来源 URL、日期、正文完整度及附件逐项结果。不存 Cookie、canary、认证头。读者只消费经过路径验证的 sanitized Markdown 和本地资源。

AUTH_REQUIRED 提示用户回到“浩鲸邮箱”账号浏览器登录；BRIDGE_UNAVAILABLE、BRIDGE_RECOVERY_BUSY、UPSTREAM_UNAVAILABLE、MAILBOX_CHANGED 分开报告，恢复权只有一个持有者。部分成功保留成果。终态失败也提交完整失败 bundle；会话锁、原子发布和恢复沿用既有 artifact-writer。未获得该来源授权直接拒绝，无跨来源降级。

## 7. 验证与发布

连接器测试覆盖模板字段、重复初始化、已删除不重建、账号浏览器入口。mail 包装测试覆盖参数注入、空列表、需登录、无效 JSON、正文截断、分页变化、只读命令白名单、附件路径逃逸/超限/部分失败、错误脱敏。knowledge-collection 后续实现需覆盖来源授权、扫描预算、正文匹配、账号维度去重、同会话物化、附件失败与 deliveryComplete。

后端变更运行 mvn -B -f byclaw-be/pom.xml verify；技能运行相关 Node/Python 契约测试。涉及前端时运行其非变更 lint 与相关测试。上线验收使用授权的测试邮箱核对同一浏览器上下文、列表、正文、附件和过期登录错误，不进行发信或删除。

本次仅维护 middleware/openclaw/Dockerfile，默认 bycli 2.1.61，并添加 iwhalecloud 命令存在性检查。用户明确要求不处理 Dockerfile.byclaw，已撤回本轮对该文件的改动。更新 BE 不会替换已运行沙箱内的技能，需同步发布所用沙箱镜像并按现有部署流程重建相关沙箱。

## 8. 待用户决策

确认上述推荐方案及范围：实现连接器与 mail 支持，knowledge-collection 本轮先交付对接设计。用户已指定连接器迁移版本为 V0.5.0。设计文档保留本地，不自动提交。


## 9. 与 By-Reach 的边界

浩鲸邮箱采集链路不调用 by-reach CLI，也不经过公共互联网 agent-reach 路由：knowledge-collection → mail → bycli iwhalecloud → 用户账号浏览器 → OWA。邮件列表、正文、附件下载均由这条路径完成，不能使用公共网页工具绕过登录态或充当读取失败的兜底。

现有 knowledge-collection/references/agent-reach.md 是从原 By-Reach 拆入的公共互联网来源路由文档，其名称不表示每次采集都执行 by-reach。它的网页执行器主要是 bycli；by-reach CLI 当前有小宇宙音频转写及被动诊断等特定用途。

若用户明确要求采集邮件中的外部文章链接，才另行把该 URL 纳入来源授权并转给现有公共网页采集流程，保留“由哪封邮件发现”的溯源关系。不能因正文包含链接而自动扩展采集。附件 PDF/Office 文本提取属于后续文档处理能力，本方案没有把它交给 by-reach，也不能把附件下载完成标为知识正文解析完成。
