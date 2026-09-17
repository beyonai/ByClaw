# T8 有界独立验证报告 —《消息回显乱序》审查修复后的新提交（不变量 / 纯度 / 契约）

| 项 | 值 |
|---|---|
| 任务 | t8 — 对审查修复后的新提交做有界独立验证（不变量/纯度/契约，≤1 轮） |
| 责任人 | 质量哨兵-REDACTED-VERIFIER·收官（资源 REDACTED-EMPLOYEE-ID） |
| attempt_id | `311c64c6-8879-4e62-8880-b24bf4b7efcc` |
| 仓库 / 分支 | `REDACTED-REPO-ROOT` · `fix/message-order-echo-234` |
| **被测 commit** | **`e4b2292aa0b1477299ddcce8ea918ea2a5dbb1f6`**（T7 交付；本地 = 远端） |
| 基线 commit | `d835a02514007b9384d7dfa941d746e33885ded3`（T2 修复） |
| 验证窗口 | 2026-09-17 16:2x CST（jest 单轮 + 聚焦 UI 轮 ≤10 分钟） |
| **结论** | ✅ **通过 —— 放行 T9**（不变量 4/4、纯度 3/3、契约 3/3、反证 2/2 有效；UI 轮 PASS） |

---

## 1. T7 输入核对（本卡的前置材料）

| 项 | 核对结果 |
|---|---|
| T7 commit | `e4b2292aa0b1477299ddcce8ea918ea2a5dbb1f6` `fix(fe): address code review findings (#234)`，HEAD 一致、`git status --porcelain` 空 |
| 代码改动 | `byclaw-fe/src/models/useMessageStore.ts` **+15 / -4** |
| 测试改动 | `byclaw-fe/src/models/__tests__/useMessageStore.test.ts` **+157** |
| 文档改动 | 本提交不含文档；`docs/reports/…-test-report.html` 由前一提交 `9d308c33`（T5/T6 脱敏）引入，T7 未改 |
| 逐条 Review 处置 | A1（性能实测可接受·不改代码）、A2（不成立·加 2 条回归防护）、A3（补契约注释 + 3 条测试）、B1（`listOf` 加固 + 1 条）、B2（补 `childRun`/`total` 断言）、边界（非数组兜底 + 1 条）、其他①不成立/②非问题 —— **共 7 条新增/加固测试** |
| A1 benchmark | n=50 **0.099ms** / n=200 **0.232ms** / n=1000 **1.018ms** / n=5000 **6.187ms**（21 次中位数） |

**T7 对 `useMessageStore.ts` 的实际改动（逐字）**：

```diff
+/** 时间线升序 —— 消息列表的唯一排序契约。 …（返回新数组 / 同刻按 messageId 升序 /
+ *  createTime 接受 number·数字字符串·YYYY-MM-DD HH:mm:ss·ISO / 缺失或空串 = MAX_SAFE_INTEGER /
+ *  排序稳定）… */
 export const sortMessagesByTimeline = …orderBy(list, [getMessageCreateTimeValue, getMessageIdValue], ['asc','asc']);

-      const messageList = sortMessagesByTimeline(rawMessageList);
+      // 防御：updater 的契约是返回数组；若返回非数组（undefined/null 等异常值），保留旧列表，
+      // 而不是让 orderBy 把列表静默清空。
+      const messageList = sortMessagesByTimeline(Array.isArray(rawMessageList) ? rawMessageList : oldMessageList);
```

> **判定**：T7 **修改了 reducer 逻辑**（`updateSessionMessageList` 新增非数组兜底分支，属行为变更），因此按本卡第 5 条走 **UI 轮**分支（见 §6）。排序算法本身未改（仍为 lodash `orderBy` 双键升序）。

---

## 2. 执行命令与原始输出

所有命令在 `REDACTED-REPO-ROOT` 下执行。

### 2.1 独立不变量测试（本卡第 1 条）

> 自研脚本，**不使用开发者的测试文件作为唯一证据**：断言与键函数由本报告独立实现（`expectedCreateTimeKey` / `expectedMessageIdKey`，不 import 被测私有工具），输入样本独立构造。
> 文件 sha256：`088bfdd6e10f55f1e4535e424642aaa5f31800b1f0f1cabb7e9fb29666a34f0a`（归档于 `REDACTED-TEST-WORKDIR`，验证后已从仓库删除）

```bash
$ npx jest src/models/__tests__/t8-independent-invariant.test.ts
PASS src/models/__tests__/t8-independent-invariant.test.ts
  T8 独立验证：消息列表排序不变量 / 纯度 / 契约
    一、四类不变量场景（到达序 ≠ 时间线序）
      ✓ T8-1 迟到旧消息重排：到达最晚但 createTime 最早的消息必须插回时间线位置
      ✓ T8-2 连续两次增量：arrivals=[12,10,13,11]，每一步都保持不变量
      ✓ T8-3 多 lane 并发：同刻按 messageId 升序、跨刻按 createTime 升序（到达序被打乱）
      ✓ T8-4 迟到子会话投影：applyScopedChildProjection 必须落到时间线位置而非追加末尾
    二、纯度 / 不可变性
      ✓ T8-5a sortMessagesByTimeline 返回新数组、不就地修改入参、不替换入参引用
      ✓ T8-5b updateSessionMessageList 不就地修改旧 state / 旧数组，且返回新 state 与新数组
      ✓ T8-5c applyScopedChildProjection 不就地修改入参 list
    三、排序契约交叉核对（独立实现 vs 被测实现）
      ✓ T8-6a createTime 字符串/数字/缺失三态：顺序确定且与独立契约实现一致
      ✓ T8-6b 同刻按 messageId 升序 + 排序稳定 + 幂等
      ✓ T8-6c 契约声明与实现一致（返回新数组 / 不就地修改 / 同刻 messageId 升序 / 缺失视为 MAX_SAFE_INTEGER）
    四、T7 新增边界（非数组兜底）
      ✓ T8-7 updater 返回 undefined / null 时保留旧列表，不得静默清空
Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
```

### 2.2 开发者用例复跑（交叉，非同源证据）

```bash
$ npx jest src/models/__tests__/useMessageStore.test.ts
Tests:       24 passed, 24 total          # 与 T7 自检声称的 24/24 一致（原 17 + 新增 7）

$ npx jest src/models/__tests__/useMessageStore.test.ts src/models/__tests__/t8-independent-invariant.test.ts
Tests:       35 passed, 35 total          # 注入-恢复现场后复跑，全绿
```

### 2.3 静态检查（非变更类）

```bash
$ npx prettier --check src/models/useMessageStore.ts src/models/__tests__/useMessageStore.test.ts
All matched files use Prettier code style!
$ npx eslint src/models/useMessageStore.ts
exit=0
```

> 说明：未重跑 `tsc --noEmit` 全量（T7 已给出 1352 = 基线、本次文件零新增）；本轮不重复该证据，见 §9 未覆盖项。

---

## 3. 不变量结果（四类，全部 PASS）

统一判定：同一 `sessionId` 下 `createTime` 升序、同值按 `messageId` 升序；对比由**独立实现**的键函数逐步校验（`invariantViolations`），非仅比对最终数组。

| # | 类别 | 构造（到达序 ≠ 时间线序） | 期望 | 实际 | 结论 |
|---|---|---|---|---|---|
| T8-1 | 迟到旧消息重排 | 列表 `[10,11,12,13]` 后到达 `9`（createTime 最早） | `9,10,11,12,13` | `9,10,11,12,13`（且 ≠ 旧行为的 `10,11,12,13,9`） | ✅ PASS |
| T8-2 | 连续两次增量 | arrivals `[12,10,13,11]` 逐条 append | 每一步都单调 | 步进 `[12]→[10,12]→[10,12,13]→[10,11,12,13]`，每步 0 violation | ✅ PASS |
| T8-3 | 多 lane 并发 | 同刻 `[22,20,21]`；跨刻交错 `[11(t2),21(t1),22(t1),12(t2)]` | `20,21,22` / `21,22,11,12` | 与期望逐项一致 | ✅ PASS |
| T8-4 | 迟到子会话投影 | 列表 `[20,22]`，`applyScopedChildProjection` 注入 `21`（中间时刻） | `20,21,22`、`total=3`、入参未被改写 | 与期望逐项一致 | ✅ PASS |

---

## 4. 纯度 / 不可变性结果（3/3 PASS）

| # | 断言 | 结果 |
|---|---|---|
| T8-5a | `sortMessagesByTimeline`：入参 `JSON` 快照前后**完全一致**；入参数组**引用未被替换**（`input === inputRef`）；返回**新数组**（`output !== inputRef`）；`[]`/`undefined`/`null` 输入 → `[]` | ✅ |
| T8-5b | `updateSessionMessageList`：旧 `state` 与其 `sessionListMap` / 条目对象 / `list` 数组**逐级引用不变**，`list` 内容快照不变；新 state 为新对象、新 `Map`、新数组 | ✅ |
| T8-5c | `applyScopedChildProjection`：入参 `list` 内容与引用均未被就地修改；返回的 list 是新数组 | ✅ |
| — | **lodash `orderBy` 纯度确认**：实现仍是 `orderBy(list, […], ['asc','asc'])`（静态正则断言 + 上述运行期断言），`orderBy` 内部 `baseOrderBy` 构造新数组，不改写入参 | ✅ |

---

## 5. 排序契约核对（与 T7 说明交叉核对 → 一致）

T7 在源码 JSDoc 中声明 4 条契约；本卡用**独立实现的契约键**对被测实现做逐条交叉核对：

| T7 声明 | 独立核对方式 | 结果 |
|---|---|---|
| ① 返回新数组、不就地修改入参 | T8-5a/5b/5c 运行期断言 | ✅ 一致 |
| ② 先 `createTime`（归一化为毫秒）升序，**同刻按 `messageId` 升序** | T8-3/T8-6a/T8-6b：同刻样本 `[13,10,12,11]` → `10,11,12,13` | ✅ 一致 |
| ③ 接受 number 毫秒 / 数字字符串 / `YYYY-MM-DD HH:mm:ss` / ISO；缺失或空串 = `MAX_SAFE_INTEGER` 排最后 | T8-6a 三态样本：`'2026-09-17 15:00:00'`(1789628400000) < `1789628430000`(number) = `'1789628430000'`(数字字符串) < 缺失 < 空串 → `31,12,21,55,61` | ✅ 一致 |
| ④ 排序稳定且幂等 | T8-6b：两次排序结果相同；键完全相同保持入参相对顺序（`first/second`）；反转输入结果不变 | ✅ 一致 |
| 契约注释可检索性 | T8-6c 静态断言：源码含「返回新数组，不就地修改入参」「同刻再按 \`messageId\` 升序」「`Number.MAX_SAFE_INTEGER`」，且实现仍为 `orderBy` + `Array.isArray(rawMessageList)` 兜底 | ✅ 一致 |

> **独立实现 vs 被测实现不产生任何分歧** → 未触发"实现与说明不符 → 不通过"的条件。
> 备注：T8-6a 首次运行时我自己的期望值写错（把 09-16 的日期字符串与 09-17 的毫秒数放同一组样本），与被测实现无关；已修正样本时间基准后通过（该过程如实保留在 `REDACTED-TEST-WORKDIR` 历史输出中，属"用例问题"而非产品缺陷）。

---

## 6. 反证有效性抽查（2 组，均证明对应测试非空转）

方法：临时注入缺陷 → 运行 **我自己的用例 + 开发者的用例** → 记录失败项 → **从备份恢复并做字节级校验**。

### 6.1 C1：回退 T7 的"非数组兜底"

注入：`sortMessagesByTimeline(Array.isArray(rawMessageList) ? rawMessageList : oldMessageList)` → `sortMessagesByTimeline(rawMessageList as any)`

```
Test Suites: 2 failed, 2 total
Tests:       3 failed, 32 passed, 35 total
✗ T8-7 updater 返回 undefined / null 时保留旧列表，不得静默清空            （我的用例）
✗ T8-6c 契约声明与实现一致（静态断言兜底分支存在）                          （我的用例）
✗ keeps the previous list when the updater returns a non-array value      （T7 新增用例）
```

> 结论：T7 的边界用例**具备判别力**，不是"永远为绿"的空转测试。

### 6.2 C2：把 `orderBy` 换成就地 `Array.prototype.sort`

```
Test Suites: 2 failed, 2 total
Tests:       4 failed, 31 passed, 35 total
✗ T8-5a sortMessagesByTimeline 返回新数组、不就地修改入参、不替换入参引用    （我的用例）
✗ T8-6c 契约声明与实现一致（静态断言 orderBy 存在）                        （我的用例）
✗ never mutates the input array in place (orderBy must keep returning a new array)   （T7 新增用例 A2）
✗ is idempotent and stable for identical createTime (A3)                            （T7 新增用例 A3）
```

> 结论：T7 的 A2 纯度防护用例**具备判别力**；A2「不成立」的判定（`orderBy` 非就地）得到反向验证。

### 6.3 现场恢复（字节级）

```
$ sha256sum -c REDACTED-TEST-WORKDIR
byclaw-fe/src/models/useMessageStore.ts: OK      # 19cbdd37ad10dc7f5d7dcf6ef08fa7556046a2859350b0c0e83b2e456f25ec48
$ git diff --stat -- byclaw-fe/src/models/useMessageStore.ts
（空）
$ npx jest <两文件>   →   Tests: 35 passed, 35 total
```

---

## 7. UI 轮（依据 + 结果）

### 7.1 走 UI 分支的依据

T7 修改了 `useMessageStore.ts` 的 **reducer 逻辑**（`updateSessionMessageList` 的新增兜底分支属行为变更），因此按本卡第 5 条**不适用"免 UI"分支**；执行 **至多一轮、≤20 分钟**的聚焦验证。

### 7.2 启动（复用 T2/T3 已记录方式）

```bash
# 后端 :8086 / WS :8082（env 在仓库外，仅经 -Denv.file 引用）
cd REDACTED-REPO-ROOT
mvn -B -f pom.xml spring-boot:run \
  -Dspring-boot.run.jvmArguments="-Denv.file=REDACTED-SESSION-ROOT -DBYCLAW_WORKER_ENABLED=false -DFILE_STORAGE_LOCAL_PATH=REDACTED-TEST-WORKDIR" \
  -Dspring-boot.run.arguments="--spring.profiles.active=local"

# 前端 :8000
cd REDACTED-REPO-ROOT && pnpm run dev
```

启动证据（原始日志）：

```
16:26:37.116 [main] INFO com.iwhalecloud.byai.ByaiServerApplication -- Loading env file from: REDACTED-SESSION-ROOT
2026-09-17 16:26:59.622 [main] INFO TomcatWebServer - Tomcat started on port 8086 (http) with context path '/byaiService'
2026-09-17 16:26:59.662 [main] INFO ByaiServerApplication - Started ByaiServerApplication in 22.32 seconds
前端：Umi v4.4.2 → Local: http://localhost:8000（Compiled in 9389 ms）
```

### 7.3 用例（单轮，2 次注入，未新增场景/未新建会话）

| 步骤 | 操作 | 结果 |
|---|---|---|
| 0 | 网络层：对 `**/byaiService/**` 中的会话/消息接口注入 **1.2s 延迟**（`route.continue` 前 delay），使"到达时刻"与 `createTime` 解耦 | 本轮累计命中 **10** 次延迟（`delayedCalls=10`） |
| 1 | 登录后打开**既有会话** `20081278`（T3 的 T3TC08，含 2 条真实消息，`beforeInject=[20081280,20081282]`） | 未新建任何会话 |
| 2 | 向真实运行时 store 分派 **1 条迟到旧消息**（`createTime = t-600s`，到达最晚） | `999000000001 → 位置 0`（插入时间线位置，**非追加末尾**）；`problems=[]`；可视序 == store 序 ✅ |
| 3 | 再按到达序 **lane-3 → lane-1 → lane-2** 分派 3 条（`createTime = t+3s / t+1s / t+2s`） | store 序 `…005(lane-1,t+1s), …007(lane-2,t+2s), …003(lane-3,t+3s)`；**可视序与 store 序完全一致**；`problems=[]` ✅ |

原始结果（`REDACTED-TEST-WORKDIR`）：

```json
{
  "sessionId": "20081278",
  "delayedCalls": 10,
  "beforeInject": ["20081280", "20081282"],
  "afterLateOlder": ["999000000001|1789628777000", "20081280|2026-09-17 15:16:15", "20081282|2026-09-17 15:16:17"],
  "afterOutOfOrderLanes": ["999000000001", "20081280", "20081282",
                           "999000000005|1789629378000", "999000000007|1789629379000", "999000000003|1789629380000"],
  "problemsAfterLate": [], "problemsAfterLanes": [],
  "visMatchAfterLate": true, "visMatchAfterLanes": true,
  "storeMsgIdOrder":  ["999000000001","20081280","20081282","999000000005","999000000007","999000000003"],
  "visualMsgIdOrder": ["999000000001","20081280","20081282","999000000005","999000000007","999000000003"],
  "verdict": "PASS"
}
```

### 7.4 截图（真实页面 1440×900，均在 `验证记录附件（未随本 PR 入库）`）

| 文件 | 内容 |
|---|---|
| `验证记录附件（未随本 PR 入库）` | 打开既有会话（T3TC08 请输出）注入前状态，2 条真实消息 |
| `验证记录附件（未随本 PR 入库）` | 迟到旧消息已按时间线插入首位（非追加末尾） |
| `验证记录附件（未随本 PR 入库）` | 三条乱序到达的 lane 按 createTime 渲染：lane-1（最后到达·最早）→ lane-2 → lane-3（最先到达·最晚） |
| `验证记录附件（未随本 PR 入库）` | 首轮脚本调试中的页面快照（**脚本级失败**：侧边栏会话未展开导致选会话失败；页面本身正常，未计入结论） |
> 截图存于验证记录附件，未随本 PR 入库。


### 7.5 关停

```
BE：pattern[spring-boot:run] killed；FE：pattern[max dev]/[forkedDev] killed
复查：REDACTED-LOOPBACK:8000 → unreachable；:8086 → unreachable；:8082 → unreachable
```

---

## 8. 结论

**通过 —— 放行 T9。**

- 排序不变量：四类场景（迟到旧消息重排 / 连续两次增量 / 多 lane 并发 / 迟到子会话投影）**4/4 通过**，且每一步都用独立实现的键函数校验，无逆序。
- 纯度：**3/3 通过**，含入参内容与引用的双重比较；`orderBy` 非就地修改得到运行期 + 静态双重确认。
- 契约：与 T7 声明的 4 条契约**逐条一致**，无分歧；`createTime` 字符串/数字/缺失三态顺序确定。
- 反证：抽查 2 组注入（C1 非数组兜底、C2 就地排序），**T7 对应的关键测试均如期变红**，恢复后字节级一致、35/35 全绿 → 测试非空转。
- UI 轮：依据成立（T7 动了 reducer 逻辑），**单轮 PASS**，修复后乱序到达仍按时间线归位，store 序 == 可视序。
- 仓库：`git status --porcelain` 空，被测文件 sha256 与验证前一致（`19cbdd37…ec48`），未修改任何被测业务代码。

---

## 9. 未覆盖项与剩余风险

| # | 项 | 等级 | 说明 |
|---|---|---|---|
| U1 | 真实 AgentTeams 多 lane SSE 流未被"网络层真实乱序"触发 | 🟡 中 | UI 轮对增量写入口的乱序是通过 **应用层分派 `updateSessionMessageList`** 注入的（配合 1.2s 网络延迟）；真实多子会话并发流本身的到达交错未复现。注入点与缺陷点同作用域，但不等价于真实链路。建议后续用真实多代理任务抽检。 |
| U2 | 未新建会话、未走"新会话 + 真实流式" | 🟢 低 | 本卡红线要求不刷共享库，故刻意复用既有会话 `20081278`；新建会话路径的 UI 表现未在本轮再验证（T3 已覆盖）。 |
| U3 | 未重跑全量 jest / `tsc` / `lint` 全量 | 🟢 低 | 仅跑目标两文件（35/35）+ 目标文件 prettier/eslint。T7 已给全量回归（1775 passed、1 个既有失败）与 tsc 基线对照；本轮不重复。 |
| U4 | A1 性能结论仍为合成 benchmark | 🟢 低 | 承接 T7 R1：典型会话 0.1–0.24ms 远低于 30ms flush 间隔；真实长会话高频 SSE 未压测。 |
| U5 | 秒级时间戳假设未加防御 | 🟢 低 | 承接 T7 R2：当前数据为毫秒；若后端将来下发秒级时间戳会整体前移。本轮实测样本与契约一致，未新增防御。 |
| U6 | `FilePicker.test.tsx` 基线失败仍在 | 🟡 中 | 承接 T7 R3：与本次无关但会阻断 pre-commit 钩子。本轮未复跑全量，未改变该结论。 |
| U7 | PR 的 CI 测试矩阵未覆盖（base=develop） | 🟢 低 | 承接 T7 R4：`ci.yml` 仅对 main/master 触发；本轮证据全部为本地执行。 |
| — | 共享环境副作用 | — | 本轮 **未新建会话、未向共享库写入消息**；仅打开既有会话 `20081278` 并做前端内存注入；BE 全程 `BYCLAW_WORKER_ENABLED=false`。 |

---

## 10. 红线自查

| 红线 | 结果 |
|---|---|
| 不修改被测业务代码 | ✅ 反证注入已恢复，`sha256` 校验 OK、`git diff` 空；仓库 `git status --porcelain` 空（自研测试文件已删除） |
| 不复跑 T3 全量 12 条用例 | ✅ 仅 11 条自研不变量用例 + 1 个目标测试文件 + 单轮 UI（2 次注入） |
| 不新建会话刷共享库 | ✅ 复用既有 `20081278`；无 DB 写入 |
| 不伪造证据 | ✅ 全部原始输出留档 `REDACTED-TEST-WORKDIR`；首轮脚本失败与我自己写错的期望值均如实登记 |
| 命令不回显 token/密钥 | ✅ 命令中仅引用 `.env` 路径，未展开任何密钥；截图与报告中无凭据明文 |
| UI 轮 ≤1 轮、≤20 分钟，结束关停 be/fe | ✅ 16:26–16:29；:8000/:8086/:8082 复查不可达 |

---

## 11. 证据文件索引

| 路径 | 内容 |
|---|---|
| `REDACTED-TEST-WORKDIR` | 自研独立用例（sha256 `088bfdd6…4f0a`，验证后已从仓库移除） |
| `REDACTED-TEST-WORKDIR` · `store.sha256` | 被测文件备份与哈希（`19cbdd37…ec48`） |
| `REDACTED-TEST-WORKDIR` · `run-dev-tests.txt` · `run-restored.txt` | 11/11、24/24、35/35 原始输出 |
| `REDACTED-TEST-WORKDIR` · `counterproof-C2.txt` | 反证注入的完整原始输出 |
| `REDACTED-TEST-WORKDIR` · `ui-verify-result.json` | UI 轮脚本与结果 |
| `REDACTED-TEST-WORKDIR` · `fe.log` | 本轮 BE/FE 启动日志 |
| `验证记录附件（未随本 PR 入库）` | UI 轮 4 张截图 |
| `REDACTED-SESSION-ROOT` | T7 交付报告（输入材料） |
| 本报告 | `REDACTED-SESSION-ROOT` |

— 质量哨兵-REDACTED-VERIFIER·收官（资源 REDACTED-EMPLOYEE-ID）
