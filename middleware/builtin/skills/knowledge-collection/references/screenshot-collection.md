# 网页截图素材采集

## 范围与入口

用户明确要求保存页面/章节截图、收集截图素材或“截图 + 素材说明 ZIP”时使用此独立分支。只读采集已存在、已授权的业务页面；不触发分析、解包、创作、视频生成或其他写业务动作。截图中的 `analysis` 指可见业务分析，不包括 Agent 内部推理。

先取得上下文已经提供的完整可信 Session Root；缺少时按主 skill 的 STOP 规则请求上游。默认内部目录为 `<Session Root>/collections/<task-name>`；用户明确指定外部保存位置时，只在 `<Session Root>/.collection-runs/<run-id>` 暂存，外部位置保持 opaque，helper 不接收、不探测、不发布到该位置。所有截图和 ZIP 都留在当前可信 Session Root 中。文章分支的 `session.json`、文章 CLI、`downstreamInput` 与 `publish` 保持原契约。

入口是相对于 skill 的 `scripts/screenshot-collection.mjs`；命令均输出单个 JSON 对象，失败为非零退出码和 `{ "ok": false, "code": "..." }`。运行时仅需要 Node.js 18+、随 skill 分发的 `vendor/screenshot-deps.cjs`、既有 `session.mjs` 与 byCLI；无需运行时 npm install。PNG/ZIP 依赖与构建工具锁定在 `scripts/package-lock.json`，构建说明见 `scripts/vendor/README.md`。

## 1. 初始化显式目标

先把用户允许的 URL、页面、父章节、当前章节和长页分段列成有限目标。不得以 Agent 自己猜出的 URL 扩大授权。每个目标必须给出非空 `pageTitle`、`parent`、`section`、`segment`；根章节的 parent 也写可核对的页面名称，不能省略。

```bash
node scripts/screenshot-collection.mjs init \
  --session-root '<可信Session Root>' --session-dir 'collections/project-evidence' \
  --plan-json '{"title":"项目页面素材","targets":[{"id":"request-1","url":"https://example.com/project/1","pageTitle":"项目一","parent":"项目一","section":"需求说明","segment":"第1屏","evidenceType":"request","origin":"existing","businessStatus":"existing","use":"展示已有用户需求"}],"budget":{"maxAttempts":3,"noProgressLimit":2,"deadlineMs":600000}}'
```

`evidenceType` 为 `request | analysis | creation | unpack | result`；`origin` 为 `existing | newly-produced | unpacked`；`businessStatus` 为 `existing | newly-produced | in-progress | failed`。只有 `origin=newly-produced` 才允许 `businessStatus=newly-produced`；即使来源是“新生成”，采集命令也不会生成任何业务产物。已有/解包结果可以作为已有结果或参考图，禁止伪装为本次生成结果。

初始化只创建一次 `capture-manifest.json` 和 `captures/`，不覆盖已存在的目录，不创建文章状态。参数、目标或路径不合法时不创建目录。拒绝路径穿越、符号链接与凭据 URL（含用户名/密码或 token/Cookie/secret 等敏感查询参数）；正整数值的精确业务参数 `groupsessionid` / `sessionId` 可保留在授权 URL 中，不能扩展到其他值或其他 session 参数。不要把生产凭据写入任何参数或文本；manifest 只由入口命令修改，禁止手工编辑以重置预算或审查。

## 2. 只读受控采集与持久预算

根 Agent 先按 byCLI 生命周期与本 skill 的单一桥接恢复所有者规则确认已有 TAB 可用。截图 helper 不启动、修复、导航或关闭浏览器，也不执行 JS、表单或业务按钮。若桥接最终不可用，保留该 manifest 并标记缺失，不在外层重复恢复。

```bash
node scripts/screenshot-collection.mjs capture \
  --session-root '<可信Session Root>' --session-dir 'collections/project-evidence' \
  --target request-1 --browser-session capture-task --tab '<已有targetId>'
```

helper 以 argv、`shell:false` 先读取同一 TAB URL，执行指定内部路径的 PNG 截图，再读取 URL；两次 URL 必须与目标的授权 URL 一致。`--bycli <可执行文件>` 仅用于已配置的 byCLI 安装位置或离线测试替身。`captures[].file` 是执行器实际写出的文件，记录 SHA-256、大小、采集时间与实际 browser session、TAB、已核对 URL；页面标题来自目标声明并由 Agent 复核。

每次采集在调用 byCLI 前持久化 attempt；失败、进程中断与重复图均会消耗预算。`maxAttempts` 默认 3（最多 10），`noProgressLimit` 默认 2（最多 10），总 `deadlineMs` 默认 10 分钟（最多 1 小时）。重复哈希或失败增加 no-progress，不同图片只代表文件进展，不代表视觉合格。没有进展、尝试次数或截止时间任一耗尽后，持久化 partial 并拒绝该目标的新采集；其他未耗尽目标可继续。

恢复必须携带原目录和 manifest；换进程、TAB、browser session、重复 `init` 或登录恢复均不重置原预算。不得通过新建目录/新聊天根规避限制。脚本只能约束使用同一 manifest 的受控入口，不能识别任意新目录是否代表同一业务任务，也不能阻止 Agent 绕过入口执行任意 shell。

明确 `AUTH_REQUIRED`、MFA、CAPTCHA 或 exit 77 记录 `paused`/`LOGIN_PAUSED`；普通 TIMEOUT 不等于登录。暂停后不检查或重试，保留 TAB 等待用户明确完成验证，再使用：

```bash
node scripts/screenshot-collection.mjs resume --session-root '<可信Session Root>' \
  --session-dir 'collections/project-evidence' --target request-1 --verification-confirmed true
```

确认恢复保留原 deadline 和 attempts。随后仍调用同一目标的 `capture`。

## 3. Agent 逐图审查

Agent 必须实际查看每张图，核对页面身份、父章节/当前章节/分段、清晰度、用途与证据边界。查看原图后，从 `status` 返回的最后一条 capture 复制其 `id` 和 `sha256`；不得仅根据存在性、OCR 或哈希接受。

```bash
node scripts/screenshot-collection.mjs review --session-root '<可信Session Root>' \
  --session-dir 'collections/project-evidence' --target request-1 \
  --review-json '{"decision":"accept","reviewer":"root-agent","captureId":"<最后一次capture.id>","sha256":"<原图sha256>","context":{"pageTitle":"项目一","parent":"项目一","section":"需求说明","segment":"第1屏"},"pageIdentityMatches":true,"sectionContextMatches":true,"legible":true,"containsInternalReasoning":false,"containsError":false,"evidenceSupportsUse":true,"reason":"页面标题与父章节可见，需求文字清晰","evidenceLimits":"仅证明当前可见需求，不证明后续分析或视频已经完成"}'
```

接受要求全部正向核对为 true，`containsInternalReasoning`/`containsError` 为 false。包含内部推理、异常、报错、空白、错误章节或无法辨认文字的图不能作为正式素材。拒绝使用同一结构并设 `decision=reject`，写清原因、限制与真实布尔值。每次新采集清空目标的当前审查，但历史图的接受/拒绝原因与证据限制保留在 `captures[].review`；review 绑定 capture ID、图片哈希、页面身份、目标用途和完整章节上下文，后续漂移会失效。

## 4. 校验、缺失与 ZIP

```bash
node scripts/screenshot-collection.mjs status --session-root '<可信Session Root>' --session-dir 'collections/project-evidence'
node scripts/screenshot-collection.mjs validate --session-root '<可信Session Root>' --session-dir 'collections/project-evidence'
node scripts/screenshot-collection.mjs package --session-root '<可信Session Root>' --session-dir 'collections/project-evidence'
node scripts/screenshot-collection.mjs verify-package --session-root '<可信Session Root>' --session-dir 'collections/project-evidence'
```

validate/package 对接受图执行完整 PNG 解码、PNG CRC 与完整 zlib 流校验，复核文件、哈希、审查与路径，拒绝重复接受哈希、未审查目标、缺失文件、坏图、符号链接或越界。文件完整性不能证明视觉语义。

缺失目标必须显式登记；只有允许部分结果时才能打包，且至少有一张已接受图：

```bash
node scripts/screenshot-collection.mjs missing --session-root '<可信Session Root>' \
  --session-dir 'collections/project-evidence' --target request-2 --reason '该章节不存在，未触发生成'
node scripts/screenshot-collection.mjs package --session-root '<可信Session Root>' \
  --session-dir 'collections/project-evidence' --allow-partial true
```

`allow-partial` 只允许显式 missing，不放行 pending/rejected/unreviewed 图；有任何 missing，状态永远是 partial。完整覆盖并通过验证才返回 complete。

`material.md` 从最终 manifest 自动生成中性的 `web-page` 来源信息、准确接受数量/用途、来源与业务状态、缺失原因、排除数量和证据限制。helper 不探测认证状态，不能仅因页面能读取就声称来源已经认证。展示来源 URL 时去掉查询参数与 fragment；原始授权 URL 仅在内部 manifest 中用于严格核对。ZIP 白名单只有接受的 PNG 和 `material.md`；manifest、日志、失败/未审查/历史截图以及凭据不进包。打包前后对成员集合、CRC、字节数和 SHA-256 做读回验证。

`receipt.archivePath/size/sha256/entries` 与 `materialPath` 只指向内部会话；`proves=file-generation-only` 只证明文件生成。对用户报告“已生成内部 ZIP”并给出经验证路径；只有实际附件渠道成功并取得其回执后才能说“已发送附件”。helper 不调用发送工具或探测外部交付路径。
