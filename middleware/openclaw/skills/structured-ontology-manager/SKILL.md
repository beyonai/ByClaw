---
name: structured-ontology-manager
description: "开发结构化业务本体模块：选择或新建本体开发工作区，通过多轮对话定义多个结构化本体对象字段，编写跨对象 Action 脚本（脚本通过自动生成的 Mapper SDK 操作服务端数据），定义视图，本地调试验证后统一提交，发布挂载。适用于从零开发新业务对象和业务 Action，也可续接已有本体开发工作区继续开发。"
---

# 本体开发助手

通过多轮对话完成本体对象、Action 和视图的全流程开发，从选择/初始化工作区到发布挂载。

## ⚠️ 执行规则（最高优先级）

1. 所有写入操作通过 Bash 调用脚本，禁止自行模拟脚本逻辑
2. 每次操作前读取 `references/field-rules.md`
3. 脚本返回 `ok:false` 时，原文告知用户，不猜测原因
4. `missing` 非空时根据字段列表追问，不填充默认值
5. **字段 collect 完成（missing 为空）后不 submit**，继续开发其他对象/Action/视图
6. **`batch_submit.py` 只在用户明确说"提交"时才执行，禁止主动或自动触发提交**
7. **提交前必须确认所有 Action 均已向用户交付完整说明、获得用户审阅确认并业务验收通过**；有未展示脚本、用户未确认、未测试、仅技术执行通过或业务验收失败的 Action，必须先补齐，不得跳过直接提交
8. Action 脚本只通过注入的 mapper 实例操作数据，禁止在脚本内拼接 HTTP 请求
9. 工作区数量可能很多，**每次会话开始前必须先列出工作区，让用户明确选择目标**
10. **对象编码和视图编码必须以用户编码结尾**：格式为 `<business_name>_<user_code>`，其中 `user_code` 从环境变量 `USER_CODE` 读取。例如用户编码为 `u001`，对象业务名为 `travel_application`，则 `entity_code` 为 `travel_application_u001`；视图编码为 `v_travel_full_u001`。**工作区名称（`workspace_name`）不需要拼接用户编码。** 生成编码前必须先获取 `USER_CODE`，不得使用占位符。
11. **Action 参数的术语绑定必须与对应对象字段保持一致**：若参数对应某字段，该字段有 `term_type_code` 则参数也必须绑定相同的 `term_type_code`，字段有 `term_values` 则参数也必须引用相同的枚举（`term_type_code: "<entity_code>_<property_code>"`），不得遗漏或另起一套。
12. **先定义业务契约，再创建对象和 Action**：无论需求来自上传的设计文档、表格、DDL，还是用户自然语言描述，都必须先整理出需求来源、业务对象、字段语义、对象关系、业务规则、状态机和验收示例；不得直接根据零散关键词生成脚本。
13. **需求明确时主动推进，需求不明确时精准追问**：可从上下文可靠推断的内容应给出建议并请用户确认；会影响数据模型、计算结果、状态流转、权限或数据安全的歧义必须逐项追问，禁止自行补默认业务规则。
14. **区分技术执行成功与业务验收通过**：`run_action.py` 返回 `ok:true` 仅表示脚本没有运行时异常，不代表业务正确。只有返回契约、业务计算、数据库副作用、禁止副作用、异常路径均满足测试契约，Action 才能标记为“业务验收通过”。
15. **调试参数默认由模型自动生成**：模型根据需求规则、Action 参数定义、字段约束和调试数据自动构造有业务意义的测试参数，不要求用户逐项提供。只有测试前置条件或期望结果无法从需求确定时才询问用户。
16. **测试预期必须独立于实现**：测试用例及预期结果必须在运行 Action 前根据需求生成并锁定，禁止读取实际运行结果后修改预期来使测试通过，也禁止根据当前脚本实现反推预期。
17. **写 Action 必须验证数据库前后状态**：OPERATION Action 除验证返回值外，还必须验证相关对象的新增、更新、删除和不应变化的数据；QUERY Action 必须验证记录范围、字段值、过滤条件、权限和数据隔离。
18. **复杂业务必须做场景闭环测试**：涉及状态机、审批、余额、库存、金额、额度、撤销/回退等跨 Action 逻辑时，必须从初始数据开始执行完整业务流程并验证最终状态，不能只逐个验证动作不报错。
19. **需求冲突不得静默选择**：文档内部、文档与用户口述、不同轮次对话之间出现冲突时，列出冲突来源、影响和推荐口径，请用户确认后再继续；用户最新明确确认的口径优先，并记录为当前业务契约。
20. **没有验收证据不得提交**：提交前每个保留的 Action 必须有测试用例、实际结果和断言结论；“已运行”“返回 success”“没有 traceback”均不能作为已调试通过的证据。
21. **Action 保存后必须向用户交付脚本说明和完整代码**：每次 `collect_action.py` 返回成功后，必须立即在对话中展示该 Action 的入参、出参、处理逻辑、涉及对象及读写操作、异常分支和本次实际保存的完整脚本源码，并请用户确认。完成展示和确认前，禁止开始调试、禁止开发下一个 Action、禁止只回复“Action 已保存”或“开发成功”。

---

## 开发流程

### Step 0：选择或新建工作区（每次会话必须先执行）

**会话开始时，先列出当前用户的所有工作区：**

```bash
python3 scripts/list_workspaces.py
```

根据返回结果，向用户展示工作区列表，并说明每个工作区的待提交状态：

**情况 A — 有已有工作区：**

展示格式：
```
您当前有以下工作区：
1. travel_reimbursement（差旅报销）— 4 个对象，1 个视图，⚠️ 2 个待提交
2. hr_onboarding（入职流程）— 3 个对象，全部已提交
3. expense_approval（费用审批）— 2 个对象，1 个视图，⚠️ 3 个待提交

请问您要：
A) 续接某个工作区（输入编号）
B) 新建工作区
```

用户选择 A 后，直接跳转到对应工作区的开发步骤（根据工作区状态判断下一步）；用户选择 B 则进入 Step 1。

**情况 B — 无工作区（首次使用）：**

直接引导用户进入 Step 1 新建工作区。

**续接工作区时的状态判断：**

调用 `get_workspace.py` 获取工作区详细状态，根据 `pending_objects` / `pending_views` 判断下一步：

- 有待提交的对象字段未完善（`missing` 非空）→ 提示用户补全字段
- 有 Action 未达到业务验收通过 → 继续生成/执行验收用例，不得以“脚本能运行”为由跳过
- 有未提交的对象/视图 → 提示可执行 `batch_submit.py`
- 全部已提交 → 询问是否要添加新对象/Action/视图，或挂载到数字员工

---

### Step 1：初始化工作区（新建时）

**首先获取当前用户编码（后续所有对象编码都需要用到）：**

```bash
echo $USER_CODE
```

收集 `workspace_name`（英文 snake_case，不拼接用户编码）、描述、初始对象列表。**对象编码和视图编码在业务名后拼接用户编码**：`<business_name>_<user_code>`。

例如用户编码为 `u001`：
- 工作区名：`travel_reimbursement`（不拼接）
- 对象编码：`travel_application_u001`、`travel_expense_u001`
- 视图编码：`v_travel_full_u001`

```bash
python3 scripts/init_workspace.py '{"workspace_name":"<n>","workspace_desc":"<d>","objects":["<code1>_<user_code>","<code2>_<user_code>"]}'
```

将返回的内容写入 `workspace/<name>/workspace.json`，创建对应目录骨架。

---

### Step 1.5：需求理解与业务建模确认（创建对象前必须完成）

需求可能来自以下一种或多种来源：

- 用户上传的设计说明书、Word/PDF/HTML/Markdown、表格、DDL、CSV 模板
- 用户在对话中的自然语言描述
- 已存在工作区中的对象、字段、Action 和视图
- 用户对已有需求的补充或修订

#### 1. 读取并登记需求来源

对每个来源记录：

- 来源名称：文件名、章节或“用户第 N 轮确认”
- 适用范围：全局、某对象、某字段、某 Action 或某测试场景
- 明确规则：可以直接转为模型或测试断言的内容
- 待确认项：缺失、矛盾或存在多种解释的内容

上传文件时必须先读取实际内容，不能只根据文件名推断。自然语言需求应把分散在多轮对话中的信息合并，不能只使用最近一句。

#### 2. 生成《业务建模草案》

在调用 `init_workspace.py` 后、创建对象字段前，向用户展示：

```text
一、业务目标
  该工作区要解决什么问题，主要使用者是谁。

二、建议对象
  1. employee — 员工
     用途：员工主数据
     主标识：employee_id（工号）
     是否被其他对象引用：是

  2. leave_record — 请假记录
     用途：保存一次请假申请及当前状态
     归属字段：applicant → employee.employee_id

三、对象关系
  leave_record.applicant → employee.employee_id
  approval_record.leave_record_id → leave_record.id

四、核心业务规则
  R-01 请假天数按自然日和上午/下午计算
  R-02 提交时校验可用余额
  R-03 审批通过后才正式扣减余额

五、状态机
  草稿 → 一级审批中 → 二级审批中 → 已通过
                     ↘ 已退回

六、待确认项
  Q-01 关联员工时存 employee.id 还是 employee_id？
  Q-02 supervisor 为空时拒绝提交还是跳过审批？
```

#### 3. 追问策略

只追问会改变业务结果的问题，优先一次提出同一主题下的少量问题：

- 标识与关联：存对象自增 id、业务编码还是名称
- 时间与计算：自然日/工作日、首尾是否包含、半天/舍入规则
- 状态与流程：允许哪些状态流转、谁可以执行、失败后是否回滚
- 数据边界：是否允许空值、重复值、负数、跨年、跨部门
- 权限与隔离：谁能看、谁能改、是否只能访问本人/本部门数据
- 删除与撤销：物理删除、逻辑删除、余额/库存是否回退

用户没有给出某项信息时，模型可以提供“推荐方案 + 影响”，但必须获得确认后才能把它作为业务规则。

#### 4. 建立需求追踪表

为后续对象、Action 和测试维护以下映射：

| 规则 ID | 需求来源 | 业务规则 | 对象/字段 | Action | 验收用例 |
|--------|----------|----------|-----------|--------|----------|
| R-01 | 设计文档 4.5.3 | 上午到次日下午计 2 天 | leave_record.leave_days | submit_leave | TC-R01-01 |
| R-02 | 用户确认 | 员工关联统一存工号 | applicant/approver/employee | 所有关联 Action | TC-R02-01 |

每条核心规则必须至少落实到一个字段、Action 或明确标记为“仅展示/非本体范围”；每个有业务逻辑的 Action 必须能追溯到规则和验收用例。

用户确认《业务建模草案》后再进入 Step 2。后续用户修改需求时，先更新草案和追踪关系，再修改对象或 Action。

---

### Step 2：逐对象字段定义（全部对象完成后再进入下一步）

**⚠️ 全量覆盖原则：`collect_object.py` 每次调用都是全量覆盖，不支持增量合并。每次调用必须传入该对象的完整字段列表（含历史字段 + 新增字段），否则已有字段会被清空。**

**进入某个对象的字段定义前，必须先调 `get_object_fields.py` 读取服务端已有字段，作为本次提交的基础：**

```bash
python3 scripts/get_object_fields.py '{"workspace_name": "<name>", "entity_code": "<code>"}'
```

将返回的字段列表在内存中维护，每收集一个新字段时追加进去，最终一并提交。

每个对象循环执行：

1. 根据已确认的业务建模草案生成对象字段建议，标明每个字段来自哪条规则；用户直接用自然语言描述时，先把描述转换为字段建议再确认
2. 对每个对象先展示《对象定义卡》，确认对象职责、业务主键、字段、关联、状态和数据约束
3. 按 `field-rules.md` 推断 `data_type` / `property_role` / `rule_type`
4. **字段语义识别 → 主动引导术语绑定**（见下方规则，每个字段推断后必须执行）
5. 枚举值用 `term_values` 内联；确认绑定系统术语后调 `list_term_types.py` 验证类型存在
6. 将新字段追加到内存字段列表，调 `collect_object.py` 传入**完整字段列表**（已有字段 + 新增字段）；`missing` 非空时追问，直到 `missing` 为空
7. 收集与其他对象的关联关系，明确记录 `source_field_code`、目标对象、目标字段、实际存储值和展示值，禁止笼统写成“关联员工/关联申请”
8. **外键 → 术语同步联动**：发现某对象有外键字段指向另一个对象（父表）时，主动判断父表是否已配置 `term_sync`；若未配置，提示用户为父表启用 `term_sync`，并协助确定 `term_name_field`（通常是父表的名称/标题字段）。父表配置 `term_sync` 后，子表的外键字段可用 `term_type_code: "<parent_entity_code>_<term_name_field>"` 绑定，实现下拉选择父表记录。
9. **字段收集完成后（`missing` 为空），主动询问是否需要为该对象启用术语同步**（见下方「对象术语同步引导」）
10. 对照需求追踪表执行对象完整性检查，确认无遗漏后切换下一个对象

**对象定义卡格式：**

```text
对象：leave_record（请假记录）
职责：保存一笔请假申请的输入、计算结果和审批状态
业务主键/唯一键：flow_id
归属主体：applicant，实际存 employee.employee_id，界面展示员工姓名

字段：
  applicant      STRING  必填  申请人工号  来源 R-02
  start_date     DATE    必填  开始日期    来源 R-01
  start_period   STRING  必填  上午/下午   来源 R-01
  leave_days     FLOAT   必填  系统计算，不接受调用方直接指定
  status         STRING  必填  状态枚举

关联：
  applicant → employee.employee_id
  存储值：工号；展示值：员工姓名

状态：
  一级审批中 / 二级审批中 / 已通过 / 已退回 / 已撤销

约束：
  end_date 不早于 start_date
  同一天不允许“下午开始、上午结束”

待确认：
  无
```

对象定义中必须区分：

- **系统主键**：平台自增 `id`
- **业务主键**：如工号、申请编号、流程号
- **存储值**：数据库真正保存的值
- **展示值**：用户界面展示的名称
- **输入值**：Action 或导入文件接收的原始值
- **转换规则**：例如“CSV 姓名 → 查询 employee → 存 employee_id”

上述内容任一不明确且会影响关联查询时，不得开始编写相关 Action。

**字段语义识别规则（每个字段推断后必须执行）：**

字段推断完成后，对照下表检查字段的语义特征，**发现匹配就主动询问用户**，不要沉默跳过：

| 触发特征（字段名含以下关键词或语义匹配） | 主动询问 | 推荐配置 |
|----------------------------------------|---------|---------|
| 人 / 员工 / 用户 / 申请人 / 审批人 / 负责人 / 处理人 / 创建人 / 经办人 / 操作人 | **"该字段存的是工号还是姓名？"** | 存工号：`term_type_code: "user_name"` + `rel_term_codeorname: "code"` <br>存姓名：`term_type_code: "user_name"` + `rel_term_codeorname: "name"` |
| 部门 / 机构 / 组织 / 归属部门 / 所属部门 | **"该字段存的是部门编码还是部门名称？"** | 存编码：`term_type_code: "dept_name"` + `rel_term_codeorname: "code"` <br>存名称：`term_type_code: "dept_name"` + `rel_term_codeorname: "name"` |
| 状态 / 阶段 / 类型 / 分类 / 标签（取值有限固定） | **"请列出该字段所有可能的取值（如：草稿、已提交、已审批）"** | 使用 `term_values: [...]` 内联枚举 |
| 取值来自另一个业务对象（外键，如"关联申请单"、"所属项目"） | 见下方「外键字段处理流程」 | 父表启用 `term_sync`，子表字段绑定父表术语类型 |

> 引导话术示例：
> - "您定义了「申请人」字段，这个字段存的是工号还是员工姓名？我建议绑定系统用户术语（`user_name`），这样界面上可以通过下拉搜索选择员工。"
> - "您定义了「所属部门」字段，是否需要绑定部门术语（`dept_name`）？请告诉我字段存的是部门编码还是名称。"
> - "「申请状态」字段的取值是否固定？请列出所有可能的状态值，我来配置枚举列表。"

确认绑定系统术语（`user_name` / `dept_name` 等）时，先调脚本验证该类型存在：

```bash
python3 scripts/list_term_types.py '{"keyword": "user"}'
```

若返回结果中确认 `user_name` 类型存在，则在字段中配置 `term_type_code: "user_name"`；若不存在，告知用户该环境暂无此术语类型，改用 `term_values` 内联或跳过绑定。

**外键字段处理流程（字段值来自另一个对象的 id）：**

发现外键字段时，必须按以下步骤处理，不能跳过：

1. **确认父表是否已启用 `term_sync`**：检查工作区中父表对象的 `definition.json`，或直接询问用户

2. **父表未启用 `term_sync` → 主动引导启用**：
   - 询问用户："「{父表名}」的记录需要在下拉框中展示吗？如果需要，我来为它配置术语同步（`term_sync`），这样在填写「{子表字段名}」时可以通过搜索选择对应的{父表名}记录。"
   - 确认后询问："`term_name_field` 用哪个字段作为展示名称？"（通常是名称/标题字段）
   - 调用 `collect_object.py` 为父表写入 `term_sync` 配置：
     ```bash
     python3 scripts/collect_object.py '{
       "workspace_name": "<name>",
       "entity_code": "<parent_entity_code>",
       "term_sync": {
         "enabled": true,
         "term_name_field": "<父表名称字段>",
         "term_code_field": "id",
         "sync_on": ["insert", "update", "delete"]
       }
     }'
     ```

3. **父表已启用 `term_sync` → 子表外键字段直接绑定**：
   - 自动推导 `term_type_code = <parent_entity_code>_<term_name_field>`
   - 子表外键字段配置：
     ```json
     {
       "property_code": "<fk_field>",
       "property_name": "<字段名>",
       "data_type": "INTEGER",
       "ext_property": {"property_role_rule": {"property_role": "DIMENSION", "rule_type": "link"}},
       "term_type_code": "<parent_entity_code>_<term_name_field>",
       "rel_term_codeorname": "code"
     }
     ```

> 外键场景固定用 `rel_term_codeorname: "code"`（字段存 `id`，按编码匹配）。

```bash
python3 scripts/collect_object.py '{
  "workspace_name": "<name>",
  "entity_code": "<code>",
  "entity_name": "<中文名>",
  "entity_desc": "<描述>",
  "fields": [...所有已有字段 + 新增外键字段...],
  "term_sync": {
    "enabled": true,
    "term_name_field": "<作为术语名称的字段名>",
    "term_code_field": "id",
    "sync_on": ["insert", "update", "delete"]
  }
}'
```

> `term_sync` 仅适用于 DYNAMIC_TABLE 类型的对象。启用后，脚本执行 insert / update / delete 时会自动将记录同步到术语库，`term_name_field` 对应的字段值将作为术语名称写入，`term_code_field`（默认 `id`）作为术语编码。

**对象术语同步引导（字段收集完成后必须执行）：**

每个对象的 `missing` 为空后，主动向用户展示以下引导，帮助决策是否需要启用 `term_sync`：

```
「{对象名}」的字段已定义完成。

是否需要为该对象启用「术语同步」？

术语同步有以下两种常见用途，请根据您的场景选择：

【场景 A：作为其他对象的下拉选项来源（被外键关联）】
  适用：该对象是"主数据"，其他对象有字段需要选择它的记录
  效果：其他对象的外键字段可以通过下拉搜索选择本对象的记录
  示例：「项目」对象启用术语同步后，「报销单」中的「所属项目」字段可下拉选择项目列表
  配置：term_name_field = 用于展示的名称字段（如 project_name）

【场景 B：让本对象字段的枚举值动态来自自身记录】
  适用：该对象本身就是枚举字典表（如城市、供应商、物料类型等）
  效果：同场景 A，主要用于让其他地方复用本对象的术语列表
  配置：与场景 A 相同

【不需要启用术语同步的情况】
  - 该对象是纯业务流程表（如申请单、审批记录），不需要被其他字段选择
  - 该对象的字段枚举已用 term_values 内联，无需动态同步

请问「{对象名}」是否需要启用术语同步？（是/否，或说明具体场景）
```

用户确认需要后，询问：
- `term_name_field`：哪个字段作为下拉展示名称？（通常是名称或标题字段）
- `sync_on`：默认 `["insert", "update", "delete"]`，一般无需修改

然后调用 `collect_object.py` 写入 `term_sync` 配置（字段不重复提交，仅补充 `term_sync`）：

```bash
python3 scripts/collect_object.py '{
  "workspace_name": "<name>",
  "entity_code": "<entity_code>",
  "term_sync": {
    "enabled": true,
    "term_name_field": "<展示名称字段>",
    "term_code_field": "id",
    "sync_on": ["insert", "update", "delete"]
  }
}'
```

枚举值字段示例：

```json
{
  "property_code": "status",
  "property_name": "申请状态",
  "data_type": "STRING",
  "ext_property": {"property_role_rule": {"property_role": "DIMENSION", "rule_type": "status"}},
  "term_values": ["草稿", "已提交", "审批中", "已批准", "已拒绝"]
}
```

度量字段示例：

```json
{
  "property_code": "total_amount",
  "property_name": "总金额",
  "data_type": "FLOAT",
  "ext_property": {"property_role_rule": {"property_role": "MEASURE", "rule_type": "amount"}}
}
```

---

### Step 3：逐对象 Action 开发（可选，全部对象完成后再进入下一步）

**进入 Action 开发前，先加载以下文档：**

- `references/SDK_REFERENCE.md`：Mapper 方法速查手册，了解可用的 API
- 当前工作区已生成的 SDK 文件（如有，batch-submit 后才存在）：读取 `workspace/<name>/sdk/<entity_code>_sdk.py`，获取实际类名、字段名和 F 内部类常量

> **无需等待 batch-submit**：Action 脚本在调试和正式执行时均由平台从本体元数据动态构建 mapper 和实体类，不依赖 SDK 文件。SDK 文件是辅助开发的参考文档；尚未提交时，直接参考 `fields.json` 中的 `property_code` 字段名即可，无需先提交再开发 Action。

**Action 开发前：主动推导业务动作清单（每个对象必须执行）**

进入某个对象的 Action 开发时，根据对象的字段特征**推导推荐 Action 清单**，展示给用户确认，而不是等用户主动描述：

| 对象特征 | 推荐 Action |
|---------|------------|
| 包含**状态字段**（`rule_type: "status"`）| 每个状态流转节点对应一个 Action（如：提交、审批通过、审批拒绝、撤回） |
| 包含**创建人/申请人字段**（`user_name` 绑定）| 「查询我的记录」Action（按当前用户过滤） |
| 被其他对象**外键关联**（有子表）| 「查询关联明细」Action（传入主单 id，返回子表列表）|
| 包含**度量字段**（`property_role: "MEASURE"`）| 「统计汇总」Action（按条件汇总金额/数量）|
| 主数据类对象（员工、供应商、项目等）| 创建 / 编辑 / 删除 / 查询详情（完整 CRUD） |
| 任意对象 | 「查询详情」Action（按 id 返回完整信息） |

推导完成后，向用户展示推荐清单并请其确认：

```
根据「{对象名}」的字段特征，我推荐以下 Action，请确认哪些需要开发：

✅ 已选（建议）：
  1. create_{entity_code}   — 新建{对象名}（主数据类必备）
  2. submit_{entity_code}   — 提交申请（状态流转：草稿 → 已提交）
  3. approve_{entity_code}  — 审批通过（状态流转：审批中 → 已批准）
  4. reject_{entity_code}   — 审批拒绝（状态流转：审批中 → 已拒绝）
  5. get_my_{entity_code}   — 查询我提交的记录
  6. get_{entity_code}_detail — 查询详情（按 id）

⬜ 可选：
  7. revoke_{entity_code}   — 撤回申请（已提交 → 草稿）
  8. sum_{entity_code}_amount — 统计金额汇总

请告诉我哪些要开发、哪些不需要，或者补充其他 Action。
```

> 推导的 Action code 使用 `snake_case`，命名规范：`<verb>_<entity_code>` 或 `<verb>_<business_term>`。状态流转 Action 的名称要明确体现操作语义，不要用模糊的 `update_status`。

**Action 开发完整性检查（每个对象 Action 开发结束时执行）：**

每个对象的 Action 开发完成后，对照以下清单做完整性检查：

- [ ] 是否有「创建」入口（主数据类对象必须有）
- [ ] 是否覆盖了所有状态流转节点（有状态字段时，每个状态变更路径都有对应 Action）
- [ ] 是否有「查询」入口（查详情 或 查列表，至少一个）
- [ ] 有子表关联时，是否有关联查询 Action
- [ ] 所有参数的术语绑定是否正确（见下方术语绑定规则）

如有缺口，提示用户："「{对象名}」目前缺少 XXX Action，是否需要补充？"

每个 Action 循环执行：

1. 根据需求追踪表和对象定义卡生成《Action 业务契约》，不要直接编写脚本
2. 确认 `action_type`：**QUERY**（只读查询，不修改数据）或 **OPERATION**（写入/修改数据）
3. 从业务契约先生成验收用例草案，锁定正常路径、边界和失败路径的预期
4. 向用户展示业务契约和验收用例；需求明确时请用户一次确认，存在歧义时只追问影响业务结果的项目
5. 用户确认后生成 `execute(params)` Python 脚本，规则：
   - 访问当前对象：使用**完整对象编码**生成的 `<entity_code>_mapper`（如对象为 `travel_application_0027029322`，则必须使用 `travel_application_0027029322_mapper`）
   - 访问其他对象：使用完整 `<other_entity_code>_mapper`，不得去掉用户编码后缀
   - 构造新实体：使用完整对象编码转换的实体类（如 `TravelApplication0027029322(...)`）
   - 字段名用 `EntityClass.F.field_name` 常量，不写裸字符串
   - 条件查询用 `Q.eq(...).gte(...)...`，聚合用 `A.sum(...).group_by(...)...`
   - 所有方法参考 `SDK_REFERENCE.md`
6. 对照业务契约逐项审查脚本：前置校验、计算、查询、全部写操作、错误返回、权限和原子性不得遗漏
7. 展示待保存脚本给用户确认，确认后调 `collect_action.py`
8. **跨对象依赖声明**：脚本中若访问了当前对象以外的 mapper（如 `travel_expense_0027029322_mapper`），必须在 `collect_action.py` 调用时传入 `object_references`，列出所有被访问对象的**完整编码**（如 `travel_expense_0027029322`）。**后缀缺失或不声明 = 调试和生产均会报 NameError。**
9. Action 参数（入参 + 出参）同步定义，**定义参数时必须检查术语绑定**（见下方规则）
10. `collect_action.py` 成功后，按 Step 3.5 输出《Action 交付说明》，再次展示服务端实际保存的处理逻辑和完整脚本；等待用户确认后才能调试

**Action 业务契约格式：**

```text
Action：submit_leave（提交请假）
需求来源：R-01、R-03、设计文档 4.5.3/4.5.4/4.5.6
执行角色：当前登录员工
Action 类型：OPERATION

输入：
  leave_type    必填，假期类型
  start_date    必填，开始日期
  start_period  必填，上午/下午
  end_date      必填，结束日期
  end_period    必填，上午/下午
  reason        必填，请假原因

系统上下文：
  applicant 从当前登录用户获取，不由调用方传入

前置条件：
  员工存在；审批人配置完整；日期合法；余额充足

计算规则：
  按 R-01 计算 leave_days；不得信任调用方传入的天数

成功写操作：
  INSERT leave_record
  INSERT 一级 approval_record
  UPDATE/INSERT leave_balance.locked_days

失败与零写入：
  审批人缺失、日期非法或余额不足时返回业务错误，所有对象均不得产生部分写入

返回：
  success、leave_record_id、leave_days、status、message

权限与隔离：
  申请人只能是当前登录用户

事务要求：
  leave_record、approval_record、leave_balance 的写入必须原子完成
```

业务契约必须描述“失败时哪些数据不得变化”。只描述成功步骤的 Action 不能进入调试。

**Action 参数术语绑定规则（定义 params 时必须执行，不得遗漏）：**

参数的术语绑定必须与对应对象字段的定义保持完全一致。定义每个参数时，先查找该参数对应的对象字段，按以下规则确定绑定：

| 参数对应字段的情况 | 参数必须配置 |
|-------------------|------------|
| 字段有 `term_type_code`（如绑定 `user_name`、`dept_name` 或父表术语） | 参数加 `"term_type_code": "<同字段的 term_type_code>"` + `"term_data_type": "LIST_TERM"` |
| 字段有 `term_values`（内联枚举） | 参数加 `"term_type_code": "<entity_code>_<property_code>"` + `"term_data_type": "DICT_TERM"` |
| 参数不对应任何字段，但取值有限固定 | 参数直接加 `"term_values": [...]`，系统自动推导 `term_type_code = <action_code>_<param_code>` |
| 参数不对应任何字段，且无固定枚举 | 无需绑定，不加 `term_type_code` |

> **核心原则：字段绑定了什么，对应的 Action 参数就绑定什么，不得另起一套，也不得遗漏。**
> `DICT_TERM` = 有限固定枚举（状态、分类等）；`LIST_TERM` = 动态增长列表（用户、关联记录等）。

```bash
python3 scripts/collect_action.py '{
  "workspace_name": "<name>",
  "entity_code": "<entity_code>",
  "action_code": "<action_code>",
  "action_name": "<中文名>",
  "action_type": "OPERATION",
  "action_desc": "<描述>",
  "object_references": ["<other_entity_code>"],
  "script": "async def execute(params: dict) -> dict:\n    ...",
  "params": [
    {
      "paramCode": "status",
      "paramName": "申请状态",
      "type": "string",
      "isRequired": true,
      "direction": "input",
      "term_type_code": "travel_application_status",
      "term_data_type": "DICT_TERM"
    },
    {
      "paramCode": "app_id",
      "paramName": "关联申请单",
      "type": "integer",
      "isRequired": true,
      "direction": "input",
      "term_type_code": "travel_application_app_title",
      "term_data_type": "LIST_TERM"
    },
    {
      "paramCode": "decision",
      "paramName": "审批意见",
      "type": "string",
      "isRequired": true,
      "direction": "input",
      "term_values": ["同意", "拒绝", "退回"]
    },
    {"paramCode": "success", "paramName": "是否成功", "type": "boolean", "isRequired": false, "direction": "output"}
  ],
  "permission_roles": ["employee"]
}'
```

> `object_references`：脚本中访问了哪些其他对象的 mapper，就在这里列出对应的**完整 `entity_code`**。例如 `travel_application_0027029322` 的 Action 脚本里使用了 `travel_expense_0027029322_mapper` 和 `travel_itinerary_0027029322_mapper`，则填写 `["travel_expense_0027029322", "travel_itinerary_0027029322"]`。**不得删除工号后缀；未声明或编码不完整的对象在调试和生产执行时均不可用。**

> - `status` 字段有 `term_values: ["草稿","已提交",...]`，固定枚举 → 引用字段已生成的 `term_type_code`
> - `app_id` 是外键字段，绑定父表动态列表 → `LIST_TERM`
> - `decision` 不对应任何字段，但审批意见有限枚举 → 参数上直接写 `term_values`，自动推导 `term_type_code = <action_code>_decision`
> - `success` 是布尔型无术语绑定，不加 `term_type_code`

Action 脚本模板：

```python
async def execute(params: dict) -> dict:
    # Q、A、mapper 实例、实体类均由 ScriptExecutor 注入，无需 import
    # 所有 mapper 方法均为 async，必须用 await 调用
    # 访问其他对象的 mapper 时，必须在 collect_action.py 的 object_references 中声明对应 entity_code

    # ── 新增记录（insert 返回含自增 id 的实体对象，用 .id 取主键）─────────────
    new_record = await <entity_code>_mapper.insert(
        <EntityClass>(field1=params["field1"], field2=params.get("field2"))
    )
    # ✅ 正确：new_record.id
    # ❌ 错误：new_record 本身不是 id，不能直接当数字用

    # ── 按主键查询 ────────────────────────────────────────────────────────────
    record = await <entity_code>_mapper.select_by_id(int(params["id"]))
    if record is None:
        return {"records": [{"success": False, "error": "记录不存在"}],
                "total": 1, "meta": {"columns": [{"name": "success"}, {"name": "error"}], "total": 1}}

    # ── 条件查询 ──────────────────────────────────────────────────────────────
    related = await <other_entity_code>_mapper.select(
        Q.eq(<OtherEntityClass>.F.<fk_field>, record.id).limit(200)
    )
    rows = related.get("records", [])  # select 返回 dict，用 .get("records") 取列表

    # ── 更新（传入含 id 的实体对象）─────────────────────────────────────────
    await <entity_code>_mapper.update_by_id(
        <EntityClass>(id=record.id, status="xxx")
    )

    return {"records": [{"success": True, "id": new_record.id}],
            "total": 1, "meta": {"columns": [{"name": "success"}, {"name": "id"}], "total": 1}}
```

**读取会话空间文件（Action 脚本中需要获取文件内容时使用）：**

当 Action 需要读取用户上传到会话空间的文件（如 CSV、文本等）时，参考 `references/SESSION_FILE_READ.md` 中的完整模板实现。

> 参数 `file_path` 需在 `collect_action.py` 的 `params` 中声明为 `input` 类型；路径支持 `/.session/<id>/...` 完整格式，session_id 会自动提取。

---

### Step 3.5：每个 Action 保存后先交付说明，再执行需求驱动调试

#### 3.5.0 Action 交付门禁（必须先完成）

**每个 Action 的 `collect_action.py` 调用成功后，必须立即向用户展示完整的《Action 交付说明》。这是开始调试前的强制门禁。**

````text
Action「{action_name}」已保存。

─── 基本信息 ─────────────────────────────────────
  Action 编码：{action_code}
  所属对象：{完整 entity_code}
  Action 类型：{QUERY/OPERATION}
  允许角色：{permission_roles}
  依赖对象：{object_references 的完整编码；没有则写“无”}

─── 入参 ─────────────────────────────────────────
  {param1_name}（{type}，必填）— {说明，如：申请单 ID}
  {param2_name}（{type}，可选）— {说明，如：审批意见}

─── 出参 ─────────────────────────────────────────
  {out1_name}（{type}）— {说明，如：是否成功}
  {out2_name}（{type}）— {说明，如：更新后的状态}

─── 处理逻辑 ────────────────────────────────────
  1. 获取并校验入参
     - app_id 必须为正整数
     - decision 必须属于允许枚举
  2. 查询数据
     - 从 {entity_code} 按 id 查询申请
     - 不存在时返回“记录不存在”，不写入任何数据
  3. 校验业务状态和权限
     - 当前状态必须为「审批中」
     - 当前用户必须是该节点审批人
  4. 执行业务计算
     - 明确列出公式、舍入、优先级和边界规则；没有计算则写“无”
  5. 执行数据写入
     - UPDATE {object.field}：旧值 → 新值
     - INSERT/DELETE 的对象和关键字段
     - 多对象写入是否要求原子完成
  6. 异常与回滚
     - 列出每个业务拒绝条件、返回信息和必须保持不变的数据
  7. 组装返回
     - 返回 success、id、status 等字段的含义

─── 数据影响 ────────────────────────────────────
  读取：
    {object_a}: {查询条件和用途}
  新增：
    {object_b}: {新增记录及关键字段；没有则写“无”}
  更新：
    {object_c}: {更新条件及字段；没有则写“无”}
  删除：
    {object_d}: {删除条件；没有则写“无”}
  不应变化：
    {失败场景或本 Action 不应修改的关键数据}

─── 完整脚本 ────────────────────────────────────
```python
{本次传给 collect_action.py 并已保存的完整 script 原文}
```

─── 关联需求与验收 ──────────────────────────────
  需求规则：{R-xx, R-yy}
  验收用例：{TC-xx 共 N 个}

请确认以上处理逻辑和脚本是否符合预期。确认后我再开始生成测试参数并调试。
````

> **展示要求**：
> - 入参/出参必须来自 `collect_action.py` 实际传入的 `params` 列表，逐条列出，不能省略
> - 处理逻辑必须覆盖入参校验、查询、业务条件、计算、每个对象的读写、异常分支、回滚/零写入和返回值；不适用的项目明确写“无”
> - 复杂 Action 可以超过 6 步，禁止为了简短而合并或遗漏关键分支
> - 数据影响必须按读取/新增/更新/删除/不应变化分类列出
> - 完整脚本必须与本次 `collect_action.py` 的 `script` 参数完全一致，原文展示，不做简化，不使用 `...`、伪代码或“同上”
> - 有术语绑定的参数，在说明中注明（如：下拉选择用户、下拉选择关联申请单）
> - 必须列出关联的需求规则和验收用例，不得只展示脚本
> - 即使开发了多个 Action，也必须逐个展示；禁止把多个 Action 合并成一句“均已创建”

**用户确认门禁：**

- 用户明确确认后，将该 Action 标记为“用户已审阅”，再进入 3.5.1
- 用户指出问题时，修改脚本、重新调用 `collect_action.py`，并重新展示完整《Action 交付说明》
- 用户尚未回复确认时停止推进，不得自动运行 `run_action.py`
- 续接工作区时，发现 Action 已保存但没有“用户已审阅”记录，必须先补展示，不得直接调试或提交

#### 3.5.1 模型自动生成验收用例

模型根据以下信息自动生成调试参数，不要求用户逐项提供：

1. 《Action 业务契约》
2. 需求追踪表中的规则和正式示例
3. `collect_action.py` 的 input 参数定义、类型、必填、枚举和术语绑定
4. 对象定义卡中的字段约束、关联和存储值
5. `debug.db` 中可用的前置数据

不得使用 `test`、`string1`、随意的 `123`、无约束随机日期等无业务意义的值。每组参数都必须说明它验证哪条业务规则。

每个 Action 至少生成：

- **正常主路径**：合法输入和标准业务流程
- **边界用例**：日期边界、0/空值、最大最小值、半天、跨年等与该 Action 相关的边界
- **业务拒绝用例**：余额不足、审批人缺失、记录不存在、非法日期等
- **非法状态/重复调用**：重复提交、重复审批、已撤销后再次撤销等
- **权限与隔离用例**：Action 涉及用户身份、角色或数据归属时必须生成

简单 CRUD 可合并无意义的类别，但必须说明为何不适用；计算、状态机、余额/库存/金额和跨对象写入不得减少上述覆盖。

#### 3.5.2 运行前锁定测试契约

每个用例在调用 `run_action.py` 前必须展示并固定：

```text
用例 ID：TC-R01-01
用例名称：上午到次日下午请假两天
验证规则：R-01

前置数据：
  employee E001 存在，可用年假 5 天
  supervisor=E002，hrbp=E003
  当前无审批中的请假

Action 入参：
  {
    "leave_type": "年假",
    "start_date": "2026-07-10",
    "start_period": "上午",
    "end_date": "2026-07-11",
    "end_period": "下午",
    "reason": "家庭事务"
  }

期望返回：
  success=true
  leave_days=2
  status="一级审批中"
  leave_record_id 为正整数

期望数据库变化：
  leave_record 新增1条，leave_days=2，status="一级审批中"
  approval_record 新增1个一级待处理节点
  leave_balance.locked_days 增加2

期望数据库不变化：
  leave_balance.used_days 不变
  leave_balance.remaining 不变
  不创建二级审批节点

通过条件：
  所有断言同时满足
```

**测试 Oracle（预期结果）来源优先级：**

1. 用户在当前对话中最新明确确认的业务规则
2. 用户指定的正式需求文档
3. 需求文档中的验收用例和示例
4. 已确认的对象定义卡与 Action 业务契约

不得以当前 Action 脚本、实际运行输出或行业常识作为最终预期。来源之间冲突时暂停该用例，按规则 19 请用户确认。

测试契约一旦进入执行阶段不得为适配实际结果而修改。发现预期本身错误时，记录原因，回到需求确认阶段更新规则和所有受影响用例，然后重新开始测试，不能只改当前断言。

#### 3.5.3 准备可重复的调试数据

调试环境使用工作区专用的 `debug.db`，数据跨调用持久保留。模型应主动准备满足测试契约的最小数据集：

- 优先使用已经业务验收通过的创建/导入 Action
- 测试数据必须使用明确的唯一标识，避免和旧数据混淆
- 运行用例前查询并记录相关数据的基线值
- 多个用例相互影响时，重建前置数据或使用不同唯一标识
- 不得依赖“当前库里可能刚好有一条可用数据”

没有创建 Action 但核心 Action 需要前置数据时，不得直接跳过调试或等提交后去真实环境验证。应告知用户缺少可控的测试数据入口，并优先补充测试数据准备能力或业务需要的创建/导入 Action。

#### 3.5.4 执行并验证

对每个用例按固定顺序执行：

1. 查询并记录执行前相关对象状态
2. 调用 `run_action.py`
3. 检查技术执行是否成功
4. 检查返回字段、类型和值
5. 查询执行后相关对象状态
6. 计算执行前后差异
7. 逐条验证“期望数据库变化”
8. 逐条验证“期望数据库不变化”
9. 输出断言清单和结论

查询数据库前后状态时：

- 优先复用已经业务验收通过的 QUERY Action
- 没有合适查询入口时，可以创建仅用于调试的只读验证 Action，按明确 id/业务键返回待断言字段
- 验证 Action 自身不得修改数据，不得复用待测试 Action 的计算函数来生成“实际值”
- 临时验证 Action 使用明显的 `_debug_verify_` 前缀，完成全部验收后调用 `delete_action.py` 删除，不得随工作区提交
- 仅通过待测试 Action 自己返回的内容，不能替代独立的数据库状态查询

调用格式：

```bash
python3 scripts/run_action.py '{
  "workspace_name": "<name>",
  "entity_code": "<entity_code>",
  "action_code": "<action_code>",
  "params": {<模型根据测试契约生成的入参>}
}'
```

**验收结果分级：**

| 结果 | 处理 |
|------|------|
| `ok: false`，有 `traceback` | **技术执行失败**：读取 traceback，修复脚本后重跑全部受影响用例 |
| `ok: true`，返回契约不符 | **接口验收失败**：按已锁定契约修复脚本，禁止修改预期迁就输出 |
| `ok: true`，计算或数据副作用不符 | **业务验收失败**：展示期望/实际差异，定位遗漏规则或错误写操作 |
| 正常用例通过，但失败/边界/权限用例未执行 | **验收未完成**：不得标记通过 |
| 全部用例、全部断言通过 | **业务验收通过**：记录证据后才可进入下一个 Action |
| 多次失败（同一问题）| 说明根本原因，给出修改方案，不要反复微调同一处 |

对用户展示结果时使用以下状态，禁止统称“调试成功”：

- `⚪ 未测试`
- `🟡 技术执行通过，业务验收未完成`
- `🔴 业务验收失败`
- `🟢 业务验收通过`

验收报告至少包含：

```text
用例 TC-R01-01：🟢
  技术执行：PASS
  返回契约：PASS
  业务计算：PASS（期望2天，实际2天）
  数据变化：PASS（leave_record +1，locked_days +2）
  禁止副作用：PASS（used_days/remaining未变化）
```

修改脚本后的重试流程：

```bash
# 1. 更新服务端脚本
python3 scripts/collect_action.py '{..., "script": "<修改后的脚本>"}'
# 2. 重新调试
python3 scripts/run_action.py '{...}'
```

修复脚本后必须重跑该 Action 的全部用例，以及依赖该 Action 的流程用例，不能只重跑刚才失败的一组参数。

#### 3.5.5 跨 Action 场景闭环

涉及同一状态机或共享余额/库存/金额的 Action，在单个 Action 验收后还必须执行完整场景，例如：

```text
导入/创建员工和余额
→ 提交请假（计算天数、冻结余额）
→ 一级审批
→ 二级审批（释放冻结、正式扣减）
→ 查询状态与余额
→ 撤销已通过申请（按 deduct_detail 回退）
→ 再次查询并验证恢复值
```

场景测试必须验证每一步状态、关联记录和余额变化，并包含至少一个失败分支。所有单 Action 用例通过但闭环失败时，相关 Action 均不得标记为最终可用。

**完整性：一个对象的所有 Action 达到“业务验收通过”，且相关跨 Action 场景闭环通过后，再进入下一个对象。**

---

### Step 4：全部 Action 开发完成后的汇总确认（提交前必须通过）

所有对象的 Action 全部开发后，做一次业务验收汇总，**有未达到“业务验收通过”的 Action 必须先处理，不允许跳过直接进入提交**：

```
以下 Action 业务验收情况汇总：

{对象名1}：
  🟢 create_xxx — 已展示完整脚本，用户已审阅；4/4 用例通过，12/12 断言通过
  🟢 submit_xxx — 已展示完整脚本，用户已审阅；9/9 用例通过，37/37 断言通过
  🔴 approve_xxx — 业务验收失败：退回后 locked_days 未释放

{对象名2}：
  🟡 get_my_xxx — 完整脚本尚未向用户展示，禁止调试或提交

跨 Action 场景：
  🔴 请假完整流程 — 终审扣减断言失败

⚠️ 存在未完成或失败的业务验收，请修复并复测后再提交。
```

- 所有 Action 均已展示完整脚本、获得用户审阅确认，且所有 Action 和跨 Action 场景均为 🟢 后，提示用户：“所有 Action 已完成用户审阅和业务验收，可以进行视图定义或提交。请告诉我下一步。”
- 有 ⚪/🟡/🔴 时，**不推进到提交**：
  - ⚪：生成测试契约并执行
  - 🟡：补全业务、副作用、边界、权限或流程用例
  - 🔴：展示期望/实际差异，修复脚本后回归全部受影响用例

> 只有当用户明确表示"跳过某个 Action 不需要"时，才可以将其从清单移除。不能因为「可选」就自动跳过。

---

### Step 5：视图定义（可选，在统一提交前完成）

引导用户描述视图：包含哪些对象、对象间的关联关系。可从各对象的关联关系自动推导关联路径。

```bash
python3 scripts/collect_view.py '{
  "workspace_name": "<name>",
  "view_code": "<code>",
  "view_name": "<中文名>",
  "view_desc": "<描述>",
  "object_codes": ["<code1>", "<code2>"],
  "object_relations": [
    {
      "source_object_code": "<from_object>",
      "source_object_field_code": "<fk_field>",
      "target_object_code": "<to_object>",
      "target_object_field_code": "id",
      "relation_type": "MANY_TO_ONE"
    }
  ]
}'
```

`missing` 为空后，视图定义自动写入服务端 `workspace/<name>/views/<view_code>.json`。

---

### Step 6：统一提交（只有用户明确说"提交"才执行）

**触发条件：用户明确说出"提交"、"提交工作区"、"batch submit"等明确提交意图。** 开发完成、业务验收通过、视图定义完成等情况均不自动触发提交。

**提交前最终检查（执行 batch_submit.py 前必须确认）：**

1. 所有保留的 Action 均已展示处理逻辑和完整脚本并获得用户确认；相关 Action 和跨 Action 场景均已业务验收通过（参考 Step 4 汇总，有未审阅或 ⚪/🟡/🔴 则拒绝提交并引导补全）
2. 询问用户是否还有视图需要定义
3. 明确说明 `batch_submit.py` 会提交对象及其已收集的 Action，并列出即将提交的对象、Action 和视图，请用户二次确认：

```
准备提交以下内容：
对象：travel_application_u001、travel_expense_u001（共 2 个）
Action：
  travel_application_u001：
    create_application、submit_application、approve_application
  travel_expense_u001：
    create_expense、list_expenses
  共 5 个，均已业务验收通过
视图：v_travel_full_u001（共 1 个）

确认提交？
```

用户确认后执行：

```bash
python3 scripts/batch_submit.py '{"workspace_name": "<name>"}'
```

只提交部分（失败重试）：

```bash
python3 scripts/batch_submit.py '{"workspace_name": "<name>", "only": ["<entity_code>", "<view_code>"]}'
```

**处理删列确认（`need_confirm: true`）：**

当某个 `dirty` 状态的对象存在字段删除变更时，batch-submit 会返回：

```json
{
  "ok": false,
  "need_confirm": true,
  "drop_columns": [
    {"entity_code": "travel_expense", "columns": ["old_remark"]}
  ]
}
```

收到此响应后：
1. 告知用户哪些字段将被永久删除，**删除后该列所有数据不可恢复**
2. 同时提示用户检查是否有 Action 脚本引用了这些字段名
3. 用户确认后，带 `confirm_drop_columns: true` 重新提交：

```bash
python3 scripts/batch_submit.py '{"workspace_name": "<name>", "only": ["travel_expense"], "confirm_drop_columns": true}'
```

提交成功后，SDK 参考文件自动写入 `workspace/<name>/sdk/<entity_code>_sdk.py`，可用于查阅字段名和方法签名，但不影响 Action 的运行——平台在执行时从本体元数据动态构建 mapper 和实体类。

---

### Step 7：发布挂载

每个对象和视图逐一挂载到目标数字员工：

```bash
python3 scripts/mount_resource.py '{"agent_id": <id>, "resource_code": "<actual_code_or_entity_code>"}'
```

---

## 意图路由

| 用户表达 | 操作 |
|----------|------|
| 列出所有工作区 / 我有哪些工作区 | `list_workspaces.py` |
| 初始化/新建工作区 | `init_workspace.py` |
| 查看某个工作区状态 | `get_workspace.py` |
| 删除工作区（⚠️ 二次确认） | `delete_workspace.py` |
| 新增/定义对象字段 | `collect_object.py`（多轮） |
| 为对象配置术语自动同步（term_sync） | `collect_object.py`（传入 `term_sync` 块） |
| 查询对象详情 | `get_object.py` |
| 查询对象字段 | `get_object_fields.py` |
| 查看对象列表 | `list_objects.py` |
| 删除对象（⚠️ 二次确认） | `delete_object.py` |
| 新增/定义 Action | 生成脚本 → `collect_action.py` |
| 查询 Action 列表 | `get_object_actions.py` |
| 查询 Action 脚本详情 | `get_action.py` |
| 删除 Action（⚠️ 二次确认） | `delete_action.py` |
| 调试 Action | `run_action.py` |
| 新增/定义视图 | `collect_view.py`（多轮） |
| 查询视图列表 | `list_views.py` |
| 查询视图详情 | `get_view.py` |
| 删除视图（⚠️ 二次确认） | `delete_view.py` |
| 统一提交 | `batch_submit.py` |
| 重新获取 SDK 文件 | `get_sdk.py` |
| 挂载 | `mount_resource.py` |
| 查询可绑定术语类型 | `list_term_types.py` |
| 查询术语枚举值 | `get_term_type_values.py` |

---

## 参考文档

- [field-rules.md](references/field-rules.md)：字段类型、property_role、rule_type 规范
- [SDK_REFERENCE.md](references/SDK_REFERENCE.md)：Action 开发必读，Mapper 方法速查
- [SESSION_FILE_READ.md](references/SESSION_FILE_READ.md)：Action 中读取会话空间文件的完整模板
