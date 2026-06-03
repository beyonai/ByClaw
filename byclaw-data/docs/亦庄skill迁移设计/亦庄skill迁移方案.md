# 亦庄skill迁移方案

## 需求分析

实现亦庄的skills(D:\data\code\study\yizhuang_brain_mcp\skills), 基于dataCloud的框架，改写迁移到,D:\data\code\baiying\byclaw-all\byclaw-data\resource\byclaw\resource\skills 并且实现同样的效果。

1、旧架构是 skill + mcp tool(tool内部写脚本连数据库)

2、新架构是：skill + 本体(通过本体连数据库，进行结构化&非结构化的数据查询、数据操作)



## 现状阐述

### skill机制

**定性：Prompt-as-Skill 模式，自定义实现，非业界标准 skill 架构。**

Skill 的本质是一段任务描述文本，加载后注入给 LLM 作为任务上下文，LLM 自行决定调用哪些 tool。没有独立的执行器，没有输入输出契约。

#### 加载流程

```
request.resource_list (resourceType == "SKILL")
    ↓ _extract_skill_resource_ids()
    resourceId 列表（如 /.openclaw/workspace-baiying-agent-10000289/skills/老鹰-战略全局分析）
    ↓
    MinIO 挂载路径 / byclaw-{user_code} / by / {resourceId} / SKILL.md
    ↓ 读取文件内容（OSError / 文件不存在时跳过，不中断流程）
    ↓ _replace_skill_placeholders() —— 把占位符替换为真实 tool 名
    ↓
    task_prompt 字符串（多个 skill 用 --- 拼接）
    ↓ 注入到 graph_input["prompts_overwrite"]["task_prompt"]
```

核心实现位置：`byclaw-data/src/byclaw_data/worker.py`

| 函数 | 行号 | 职责 |
|------|------|------|
| `_extract_skill_resource_ids()` | 359 | 从 resource_list 过滤 resourceType == "SKILL" 的条目，取 resourceId |
| `_replace_skill_placeholders()` | 378 | 正则替换 `{{query:xxx}}` / `{{compute:xxx}}` / `{{action:obj:act}}` 为真实 tool 名 |
| `_load_skills()` | 417 | 组合以上两步，返回拼接后的 task_prompt |
| 静态路径调用 | 2351 | 非动态 agent 路径，注入 `graph_input["prompts_overwrite"]["task_prompt"]` |
| 动态路径调用 | 1873 | 动态 agent 路径，注入 `extras["task_prompt"]` |

#### 占位符格式

```
{{query:object_code}}          → query_{object_code}
{{compute:object_code}}        → compute_{object_code}
{{action:object_code:act_name}} → 匹配 tools_dict 中含 object_code 和 act_name 的 key
```

动态路径（`_is_dynamic_agent == True`）传入的 `tools_dict` 为空字典，占位符替换会跳过，tool 名原样保留在 prompt 中。

#### skill 激活的控制权问题

**当前实现：skill 由调用方显式指定，agent 没有自主发现和选择 skill 的能力。**

```
调用方（前端 / 外部系统）
    ↓ 组装 request，在 resource_list 中手动填入
      { "resourceType": "SKILL", "resourceId": "/.openclaw/.../skills/老鹰-战略全局分析" }
    ↓
worker.py _load_skills()
    ↓ resource_list 中有 SKILL 条目 → 加载并注入 task_prompt
    ↓ resource_list 中无 SKILL 条目 → skill 完全不激活，agent 对 skill 的存在一无所知
```

这意味着：
- **skill 的选用由人来决定**：前端用户或系统集成方在发起请求时，必须预先知道"这次对话应该用哪个 skill"，并在请求参数里手动列举。
- **agent 对 skill 目录不可见**：若调用方没传 SKILL 条目，agent 无法感知任何 skill 的存在，更无法主动选择。
- **缺乏动态适配能力**：用户的一个问题可能横跨多个 skill 的适用范围，但 agent 无法自主判断并组合，只能依赖调用方事先配置好。

**目标：skill 激活的控制权从调用方转移给 agent。**

```
目标架构（渐进式加载）：

启动时
    ↓ agent 扫描 resource/skills/*/SKILL.md
    ↓ 只解析 frontmatter（name / description / allowed-tools）
    ↓ 注册为 SkillRegistry，注入系统提示：
      "Available Skills:
       - macro-analytics: 全局宏观分析，适用分布统计...
         -> read_file('/.../macro-analytics/SKILL.md') 查看完整指令"

每次对话
    ↓ agent 根据用户意图，自主判断是否匹配某个 skill
    ↓ 需要时主动调用 read_file 读取 skill 正文，获取执行步骤
    ↓ 按 SKILL.md 指令调用对应 tool 完成任务
```

两种模式的本质区别：

| 维度 | 当前模式（外部驱动） | 目标模式（agent 自主） |
|------|------------------|-------------------|
| skill 感知 | 调用方传什么就用什么，其余不可见 | agent 在系统提示中看到全部 skill 摘要 |
| skill 选择 | 调用方在请求参数里指定 | agent 根据用户意图自主匹配 |
| skill 内容加载 | 代码在请求时强制读入并注入 | agent 需要时主动调用 read_file 按需读取 |
| 多 skill 组合 | 调用方必须预先枚举 | agent 可自主识别并组合多个 skill |
| context 消耗 | 无论是否需要，正文都注入 | 只有 agent 判断相关的 skill 才读入正文 |

#### 与业界标准的差距

| 维度 | 当前实现 | 业界标准（Semantic Kernel / LangChain） |
|------|---------|----------------------------------------|
| Skill 定义 | MinIO 上的 `SKILL.md` 纯文本 | 代码模块（函数 + schema）或结构化配置 |
| 发现机制 | 请求参数 resource_list 携带路径 | 注册中心、目录扫描、SDK 装饰器 |
| 执行方式 | LLM 读 prompt 后自行决定 | 显式调用，有明确输入输出契约 |
| 参数化 | 正则占位符替换 | 函数签名 / JSON Schema |
| 版本管理 | 无，直接读文件 | 包版本或 Git |
| 可测试性 | 无法单元测试 | 可独立测试 |

### skill实现样例

--示例1： 其中这个是查询/统计 XX对象/XX视图

``` 示例
调用 {{query:scene_crm_comprehensive_analysis}}
参数：按行业统计客户数量、商机数量、签约金额和回款金额，计算客单价，按签约金额降序

**第 2 步：查产品线赛道表现**
调用 {{compute:scene_crm_comprehensive_analysis}}
参数：按产品线统计商机数量、赢率、签约金额，按签约金额降序排列
```

-- 样例2：skill不带脚本。
D:\data\code\baiying\byclaw-all\byclaw-data\local_minio\byclaw-0027024630\by\.openclaw\workspace-baiying-agent-10000289\skills\老鹰-战略全局分析

-- 样例3：skill带脚本
D:\data\code\baiying\byclaw-all\byclaw-data\local_minio\byclaw-0027024630\by\.openclaw\workspace-baiying-agent-10000289\skills\structured-ontology-manager

### 本体定义结构

-- 黄浦企业综合分析视图
编码: shs_enterprise_analysis_view
视图描述: 以黄浦企业为锚点，关联产业链、AOI、物理网格和管理网格。
关联对象: 关联以下对象
黄埔地区企业综合分析表(shs_enterprise_analysis)
黄埔地区产业链综合分析表(shs_chain_analysis)
黄埔地区企业AOI汇总分析表(shs_aoi_analysis)
黄埔地区物理网格综合分析表(shs_grid_analysis)
黄埔地区管理网格综合分析表(shs_manage_grid_analysis)

-- 亦庄企业综合分析视图
编码: ads_enterprise_analysis_view
视图描述: 以亦庄企业为锚点，关联产业链、AOI、物理网格和管理网格。
关联对象: 关联以下对象
亦庄地区企业综合分析表(ads_enterprise_analysis)
亦庄地区产业链综合分析表(ads_chain_analysis)
亦庄地区企业AOI汇总分析表(ads_aoi_analysis)
亦庄地区物理网格综合分析表(ads_grid_analysis)
亦庄地区管理网格综合分析表(ads_manage_grid_analysis)

-- 视图本体的定义：D:\data\code\baiying\byclaw-all\byclaw-data\resource\byclaw\resource\view

-- 对象本体的定义：D:\data\code\baiying\byclaw-all\byclaw-data\resource\byclaw\resource\object



## 概要设计

### skill架构设计

#### 1. 现有 skill 规范（deepagent_bi 官方规范）

参见 `by-datacloud/examples/deepagent_bi/skills/` 下的两类 skill：

**纯 prompt 型**（`老鹰-战略全局分析`）：
```yaml
---
name: 老鹰战略全局分析
description: "以 CEO 视角，调用 baiying_call 查询全局 CRM 数据，输出战略全景报告和资源押注建议"
allowed-tools: baiying_call
---
```
skill 正文指导 LLM 如何调用 `baiying_call` tool（传 `resource_id` + `query`），LLM 根据 prompt 自主执行。

**脚本执行型**（`structured-ontology-manager`）：
```yaml
---
name: 个人结构化本体管理
description: "对话式结构化个人本体管理：..."
allowed-tools: execute, read_file
---
```
skill 正文描述如何通过 `execute` tool 调用 Python 脚本，`SKILL_DIR` 环境变量由运行时自动注入。

**`allowed-tools` 是 skill 规范的核心字段**，声明 skill 激活时 LLM 可用的工具范围，把 skill 的能力边界显式收敛。

---

#### 2. 业界标准 skill 机制包含什么

| 维度 | 业界标准要求 | 当前 byclaw 缺口 |
|------|------------|----------------|
| **渐进式加载** | metadata（name/description/allowed-tools）轻量先加载；skill 正文（prompt）按需读取，不在启动时全量进内存 | 当前请求时才读文件，无 metadata 预加载，无法在不加载正文的情况下做 skill 路由 |
| **skill 发现机制** | 目录扫描或注册表，通过 `name` 快速定位 skill；支持按 description/tag 做语义路由 | 只能通过 resourceId 路径拼接，没有注册表，skill 列表对 agent 不可见 |
| **skill 执行机制** | `allowed-tools` 约束 LLM 可用工具；`task_prompt` 注入执行上下文；`SKILL_DIR` 提供脚本执行能力 | task_prompt 注入已有；`allowed-tools` 字段目前被忽略，未做工具约束 |

---

#### 3. SkillsMiddleware 包归属与源码真相

##### 3.1 包归属与标准来源

`SkillsMiddleware` 属于 **`deepagents`** 包（`langchain-ai` 官方出品，独立 pip 包），不是 LangChain 也不是 LangGraph。

**但 deepagents 本身也只是一个实现者。** 真正的标准来源是：

> **Agent Skills Specification：https://agentskills.io/specification**

源码注释中多次出现 `# Agent Skills specification constraints (https://agentskills.io/specification)`，说明 `SkillsMiddleware` 是对这个开放规范的实现，规范本身不依附于任何包。

这意味着：**我们要对标的是 agentskills.io 规范，不是 deepagents 包。** 自己实现等价逻辑完全合规。

---

##### 3.2 源码揭示的真实机制

**渐进式加载（Progressive Disclosure）的真正运作方式：**

```
before_agent（每个 session 首次）：
  扫描 sources 目录 → 批量下载所有 SKILL.md
  → 只解析 frontmatter（name/description/allowed_tools/path）
  → 存入 SkillsState.skills_metadata
  → ⚠️ 正文从未被代码读取

modify_request（每次模型调用前）：
  把 skills_metadata 格式化注入系统提示：
    "Available Skills:
     - macro-analytics: 全局宏观分析...
       -> Allowed tools: query_xxx
       -> Read `{skill_path}` for full instructions
         (use read_file with limit=1000)"
  → LLM 看到路径，自主决定是否调用 read_file 读正文
  → ⚠️ 正文由 LLM 按需读取，不是代码注入
```

**这就是"渐进式"的本质：metadata 由代码加载（轻量），正文由 LLM 自主决定是否读取（按需）。**

**`allowed-tools` 的真实约束等级：**

源码中 `allowed_tools` 仅格式化为系统提示文字，规范原文注释：
```python
allowed_tools: list[str]
"""Tool names the skill recommends using.
Warning: this is experimental.
"""
```
这是对 LLM 的**软约束**（提示建议），不是代码层硬过滤。

---

##### 3.3 关键发现：byclaw 已有 read_file，且已支持 skill 路径

`datacloud-analysis/src/datacloud_analysis/tools/file_io.py` 的 `read_file` tool（第 76-96 行）已有 skill 专用分支：

```python
# skill 路径分支：直接读本地磁盘
skill_workspace_dir = _resolve_skill_workspace_dir()  # 从 extras 取 skill_workspace_dir
if skill_workspace_dir:
    skill_dir = Path(skill_workspace_dir).resolve()
    target = Path(path) if Path(path).is_absolute() else (skill_dir / path)
    # 路径安全校验：必须在 skill_workspace_dir 内
    target.relative_to(skill_dir)
    return target.read_text(encoding="utf-8")
```

这说明：**渐进式加载所需的 `read_file` tool 已经存在，且已经打通了 skill 目录的访问权限。**

---

##### 3.4 与当前 byclaw 的本质差异

| 维度 | 当前 byclaw | SkillsMiddleware 真实行为 |
|------|------------|--------------------------|
| **skill 正文加载** | `_load_skills()` 代码直接读入，注入 `task_prompt` | 代码不读正文，只告诉 LLM 路径，LLM 自调 `read_file` |
| **渐进式** | 无 | metadata 代码加载 + 正文 LLM 按需读 |
| **allowed-tools** | 字段被忽略 | 写入系统提示软约束（experimental） |
| **skill 发现** | resourceId 路径拼接 | 目录扫描 + frontmatter 注册表 |
| **read_file tool** | 已有，且已支持 skill_workspace_dir | 依赖 agent 内置此 tool |

---

##### 3.5 路线 B：参考规范自行实现（推荐）

不引入 `deepagents` 依赖，对照 agentskills.io 规范和 `SkillsMiddleware` 源码，在 `byclaw_data` 里实现等价的 `SkillLoader`。

**核心逻辑三件事（参照源码，约 80 行）：**

```python
# skill_loader.py

@dataclass
class SkillMeta:
    name: str
    description: str
    path: Path              # SKILL.md 绝对路径
    allowed_tools: list[str]  # frontmatter allowed-tools

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)

def parse_skill_meta(skill_md: Path) -> SkillMeta | None:
    """只解析 frontmatter，不读正文。对应 _parse_skill_metadata()。"""
    content = skill_md.read_text(encoding="utf-8")
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return None
    data = yaml.safe_load(m.group(1))
    name = str(data.get("name", "")).strip()
    description = str(data.get("description", "")).strip()
    if not name or not description:
        return None
    raw_tools = data.get("allowed-tools", "")
    allowed_tools = [t.strip(",") for t in str(raw_tools).split() if t.strip(",")]
    return SkillMeta(name=name, description=description,
                     path=skill_md, allowed_tools=allowed_tools)

@lru_cache(maxsize=1)
def get_skill_registry() -> dict[str, SkillMeta]:
    """启动时扫描 resource/skills/*/SKILL.md，只加载 frontmatter。"""
    root = Path(__file__).parent / "../../resource/byclaw/resource/skills"
    return {m.name: m for p in root.glob("*/SKILL.md") if (m := parse_skill_meta(p))}
```

**注入方式：系统提示追加 skill 目录摘要（对齐 SkillsMiddleware 的 modify_request）：**

```python
SKILLS_SECTION_TEMPLATE = """
## Skills System

**Available Skills:**
{skills_list}

**How to Use Skills (Progressive Disclosure):**
1. 识别用户请求匹配哪个 skill 的 description
2. 用 read_file 读取该 skill 的完整指令：read_file(path="{skill_dir}/SKILL.md")
3. 按 SKILL.md 的步骤执行任务
"""

def build_skills_section(registry: dict[str, SkillMeta]) -> str:
    lines = []
    for meta in registry.values():
        lines.append(f"- **{meta.name}**: {meta.description}")
        if meta.allowed_tools:
            lines.append(f"  -> Allowed tools: {', '.join(meta.allowed_tools)}")
        lines.append(f"  -> Read `{meta.path}` for full instructions")
    return SKILLS_SECTION_TEMPLATE.format(skills_list="\n".join(lines), ...)
```

**`_load_skills()` 改造（兼容旧逻辑）：**

```python
def _load_skills(resource_list, user_code, tools_dict):
    skill_ids = _extract_skill_resource_ids(resource_list)
    registry = get_skill_registry()
    parts = []
    for skill_id in skill_ids:
        meta = registry.get(skill_id)
        if meta:
            # 新路径：直接读正文注入（或改为仅注入 path，让 LLM 读）
            content = meta.path.read_text(encoding="utf-8")
            body = _FRONTMATTER_RE.sub("", content)
            parts.append(body)
            continue
        # 旧路径：MinIO workspace skill，保持不变
        ...
```

**注入方式选择：**

| 方式 | 对应 | 适用场景 |
|------|------|---------|
| 直接注入正文到 task_prompt | 当前 byclaw 做法 | skill 数量少、正文短 |
| 注入摘要 + 让 LLM 用 read_file 读 | SkillsMiddleware 做法 | skill 多、正文长，避免 context 膨胀 |

当前亦庄 skill 正文较长（每个几百行），**建议采用 SkillsMiddleware 的渐进式方式**：只注入摘要，LLM 通过 `read_file` 按需读取完整正文。`read_file` tool 的 `skill_workspace_dir` 分支已经就绪，直接可用。

---

#### 4. 目标架构与迁移路径

**目录结构**

```
resource/byclaw/resource/skills/
  ├── macro-analytics/
  │   ├── SKILL.md
  │   └── references/
  ├── enterprise-analysis/
  │   └── SKILL.md
  ├── chain-analysis/
  │   └── SKILL.md
  └── ...（其余 skill）
```

**SKILL.md 标准格式**（对齐 deepagent_bi 规范）

```yaml
---
name: macro_analytics
description: >
  全局宏观分析。适用：分布统计、指标聚合、区域对标。
  不适用：生成报告成稿（由 report_annual_briefing 覆盖）。
allowed-tools: query_ads_enterprise_analysis_view, compute_ads_enterprise_analysis_view
---

# 全局宏观分析

（skill 正文，指导 LLM 如何调用 allowed-tools 中的 tool）
```

`allowed-tools` 直接写 datacloud 生成的真实 tool 名，不用 `{{}}` 占位符。旧 MinIO workspace skill 继续兼容（`{{query:xxx}}` 占位符保留）。

**加载流程（改进后）**

```
服务启动
  └─ SkillRegistry.build()：扫描 resource/skills/*/SKILL.md
       └─ 只解析 frontmatter → dict[name, SkillMeta(path, allowed_tools, description)]

请求时
  └─ resource_list 中 resourceType == "SKILL"
       → resourceCode 非空 → 查 SkillRegistry（新 resource skill）
       → resourceCode 为空 → 原有 resourceId 路径拼接（兼容旧 MinIO workspace skill）
       → 读取 SKILL.md 正文，替换占位符，拼接为 task_prompt
       → 按 allowed-tools 过滤当前 session 的 tool list
```

**与亦庄大脑 MCP 的 tool 对应关系**

亦庄 MCP 每个 skill 调用一个 Facade Tool（如 `macro_analytics`，内部按 intent 路由）。byclaw 没有 Facade Tool，每个本体直接生成 `query_xxx` / `compute_xxx`，迁移时按下表替换 `allowed-tools` 和 skill 正文中的 tool 引用：

| 亦庄 MCP Facade Tool | byclaw allowed-tools（本体编码） |
|---------------------|--------------------------------|
| `macro_analytics` | `query_ads_enterprise_analysis_view`, `compute_ads_enterprise_analysis_view` |
| `enterprise_analysis` | `query_ads_enterprise_analysis` |
| `chain_analysis` | `query_ads_chain_analysis` |
| `grid_analysis` | `query_ads_grid_analysis`, `query_ads_manage_grid_analysis` |
| `aoi_analysis` | `query_ads_aoi_analysis` |

具体 tool 名以 `resource/byclaw/resource/object` 和 `resource/byclaw/resource/view` 中的本体编码为准。

**实施步骤**

1. 建立 `resource/byclaw/resource/skills/` 目录，写入首批迁移 skill（SKILL.md 带 allowed-tools）
2. 在 `worker.py` 中新增 `SkillRegistry`（启动时扫描，`@lru_cache`），`_load_skills()` 增加注册表查找分支
3. OntologyAgent 构建 tool list 时，读取当前 skill 的 `allowed-tools`，过滤不在列表中的 tool
4. resource_list 中 skill 条目改为 `resourceCode` 携带 skill name，`resourceId` 退为兜底兼容



## 详细设计

### skill架构改造详设

目标：将 skill 激活的控制权从调用方（resource_list 传参）转移给 agent（自主感知 skill 目录、自主选择）。改造分三个层次：①新增 `SkillRegistry` 扫描注册、②改造 `worker.py` 注入系统提示、③保留旧路径兼容。

---

#### 1. 新增 `skill_registry.py`

**文件路径**：`byclaw-data/src/byclaw_data/skill_registry.py`

功能：扫描 `resource/byclaw/resource/skills/*/SKILL.md`，只解析 frontmatter，构建 name → SkillMeta 注册表。正文从不读入（渐进式加载）。

```python
# byclaw_data/skill_registry.py
from __future__ import annotations
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)


@dataclass
class SkillMeta:
    name: str
    description: str
    path: Path                        # SKILL.md 绝对路径
    allowed_tools: list[str] = field(default_factory=list)
    emoji: str = ""


def _parse_skill_meta(skill_md: Path) -> SkillMeta | None:
    """只解析 frontmatter，不读正文。"""
    try:
        content = skill_md.read_text(encoding="utf-8")
    except OSError:
        return None
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return None
    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        return None
    name = str(data.get("name", "")).strip()
    description = str(data.get("description", "")).strip()
    if not name or not description:
        return None

    # allowed-tools 支持多行 block scalar（YAML > 展开后是空格分隔的字符串）
    raw = data.get("allowed-tools", "")
    allowed_tools = [t.strip(" ,") for t in str(raw).replace("\n", " ").split() if t.strip(" ,")]

    emoji = str(data.get("metadata", {}).get("copaw", {}).get("emoji", ""))
    return SkillMeta(name=name, description=description, path=skill_md,
                     allowed_tools=allowed_tools, emoji=emoji)


@lru_cache(maxsize=1)
def get_skill_registry(skills_root: str | None = None) -> dict[str, SkillMeta]:
    """
    扫描 skills_root 下所有 */SKILL.md，返回 name → SkillMeta 字典。
    skills_root 默认为本文件的上三级目录 resource/byclaw/resource/skills。
    """
    if skills_root:
        root = Path(skills_root)
    else:
        root = Path(__file__).parent.parent.parent / "resource/byclaw/resource/skills"

    registry: dict[str, SkillMeta] = {}
    for skill_md in root.glob("*/SKILL.md"):
        meta = _parse_skill_meta(skill_md)
        if meta:
            registry[meta.name] = meta
    return registry


def build_skills_system_prompt(registry: dict[str, SkillMeta]) -> str:
    """
    将 registry 格式化为注入系统提示的 Skills 摘要段落。
    LLM 看到 skill 路径，按需自主调用 read_file 读取完整正文。
    """
    if not registry:
        return ""
    lines: list[str] = []
    for meta in registry.values():
        prefix = f"{meta.emoji} " if meta.emoji else ""
        lines.append(f"- **{prefix}{meta.name}**: {meta.description}")
        if meta.allowed_tools:
            lines.append(f"  -> Allowed tools: {', '.join(meta.allowed_tools)}")
        lines.append(f"  -> 需要完整指令时调用 read_file(path=\"{meta.path}\")")
    skills_list = "\n".join(lines)
    return f"""
## Skills System

以下是系统内置的可用技能（Skills）。每个 skill 是一段任务规程，指导你如何调用 allowed-tools 完成特定分析任务。

**Available Skills:**
{skills_list}

**使用方式（渐进式加载）：**
1. 根据用户意图，判断是否有匹配的 skill（对照 description）
2. 若匹配，先调用 read_file 读取该 skill 的完整指令：read_file(path="<上方路径>")
3. 按 SKILL.md 的步骤执行任务
4. 若无匹配 skill，按通用问答方式直接回答
"""
```

---

#### 2. 改造 `worker.py`：系统提示注入点

**改造原则**：
- **动态路径**（`_is_dynamic_agent == True`）：在 `_dyn_extras` 构建后、调用 `_ontology_agent.ask()` 前，将 skills 摘要追加到 `extras["system_prompt_suffix"]`（若 OntologyAgent 支持）或保留在 `extras["task_prompt"]` 兜底。
- **静态路径**（`_is_dynamic_agent == False`）：在 `graph_input["prompts_overwrite"]` 构建后、调用 graph 前，将 skills 摘要注入 `graph_input["prompts_overwrite"]["system_prompt_suffix"]`。
- **旧 resource_list 路径保留**：`_load_skills()` 逻辑不删除，仍作为显式指定 skill 的兜底（向后兼容）。新逻辑优先级更高：若 registry 存在且匹配，以 registry 为准。

**改造位置一：动态路径（行 ~1887）**

```python
# 现有代码（保留）
_dyn_extras: dict[str, Any] = {
    "user_code": _dyn_user_code,
    "beyond_token": _dyn_beyond_token,
    "skill_workspace_dir": _dyn_skill_ws,
}
if _dyn_skill_task_prompt:
    _dyn_extras["task_prompt"] = _dyn_skill_task_prompt

# ── 新增：将 SkillRegistry 摘要注入 extras ──
from byclaw_data.skill_registry import get_skill_registry, build_skills_system_prompt
_skill_registry = get_skill_registry()
if _skill_registry:
    _skills_prompt = build_skills_system_prompt(_skill_registry)
    # 若已有 task_prompt（旧路径），追加在后；否则单独设置
    if "task_prompt" in _dyn_extras:
        _dyn_extras["task_prompt"] = _dyn_extras["task_prompt"] + "\n\n" + _skills_prompt
    else:
        _dyn_extras["task_prompt"] = _skills_prompt
```

**改造位置二：静态路径（行 ~2385）**

```python
# 现有代码（保留）
if _skill_task_prompt:
    _task_prompt, _first_skill_dir = _skill_task_prompt
    graph_input["prompts_overwrite"]["task_prompt"] = _task_prompt
    ...

# ── 新增：将 SkillRegistry 摘要注入 prompts_overwrite ──
from byclaw_data.skill_registry import get_skill_registry, build_skills_system_prompt
_skill_registry = get_skill_registry()
if _skill_registry:
    _skills_prompt = build_skills_system_prompt(_skill_registry)
    existing = graph_input["prompts_overwrite"].get("task_prompt", "")
    if existing:
        graph_input["prompts_overwrite"]["task_prompt"] = existing + "\n\n" + _skills_prompt
    else:
        graph_input["prompts_overwrite"]["task_prompt"] = _skills_prompt
```

---

#### 3. 注入效果示意

改造后，agent 每次调用前系统提示末尾会追加如下摘要（以当前已创建的 macro-analytics skill 为例）：

```
## Skills System

以下是系统内置的可用技能（Skills）。...

**Available Skills:**
- 📊 **macro_analytics**: 全局宏观分析。适用场景：数据分布统计...
  -> Allowed tools: query_ads_enterprise_analysis_view, compute_ads_enterprise_analysis_view, ...
  -> 需要完整指令时调用 read_file(path=".../skills/macro-analytics/SKILL.md")

**使用方式（渐进式加载）：**
1. 根据用户意图，判断是否有匹配的 skill
2. 若匹配，先调用 read_file 读取完整指令
3. 按 SKILL.md 的步骤执行任务
```

LLM 看到 path 后**自主决定**是否调用 `read_file` 读取正文，而不是由代码强制注入。

---

#### 4. `_load_skills()` 兼容保留策略

旧路径（`resource_list` 传 SKILL 条目）完全保留，不做任何修改。两条路径并存：

| 场景 | 触发方式 | 优先级 |
|------|---------|--------|
| 新路径（agent 自主）| SkillRegistry 摘要注入系统提示，agent 自行 read_file | 每次请求默认生效 |
| 旧路径（调用方显式）| `resource_list` 传 `resourceType=SKILL` | 若 `_load_skills()` 返回非空，追加在 registry 摘要之后 |

两条路径不冲突：新路径让 agent 感知所有 resource skill；旧路径仍可显式指定 MinIO workspace skill（非 resource 内置的用户自定义 skill）。

---

#### 5. 实施顺序

1. 新建 `byclaw_data/skill_registry.py`（约 70 行）
2. 在 `worker.py` 动态路径注入点（行 ~1887）添加 5 行代码
3. 在 `worker.py` 静态路径注入点（行 ~2385）添加 5 行代码
4. 验证：启动服务后，不传 resource_list 直接问"亦庄企业按行业分布"，观察 agent 是否自主读取 SKILL.md 并按 macro_analytics 规程执行

---

### skill迁移详设计

#### 前提说明：本体依赖与迁移策略

经核查 `resource/byclaw/resource/object` 和 `resource/byclaw/resource/view` 目录，亦庄相关本体已全部创建：

**对象本体（object）**

| 本体编码 | 说明 | 生成 tool |
|---------|------|---------|
| `ads_enterprise_analysis` | 亦庄企业综合分析表 | `query_ads_enterprise_analysis`、`compute_ads_enterprise_analysis` |
| `ads_chain_analysis` | 亦庄产业链综合分析表 | `query_ads_chain_analysis`、`compute_ads_chain_analysis` |
| `ads_grid_analysis` | 亦庄物理网格综合分析表 | `query_ads_grid_analysis`、`compute_ads_grid_analysis` |
| `ads_manage_grid_analysis` | 亦庄管理网格综合分析表 | `query_ads_manage_grid_analysis`、`compute_ads_manage_grid_analysis` |
| `ads_aoi_analysis` | 亦庄AOI汇总分析表 | `query_ads_aoi_analysis`、`compute_ads_aoi_analysis` |
| `ads_od_fly_line` | 亦庄OD飞线 | `query_ads_od_fly_line` |

**视图本体（view）**

| 本体编码 | 说明 | 关联对象 | 生成 tool |
|---------|------|---------|---------|
| `ads_enterprise_analysis_view` | 亦庄企业综合分析视图 | 企业+产业链+AOI+物理网格+管理网格 | `query_ads_enterprise_analysis_view`、`compute_ads_enterprise_analysis_view` |
| `ads_grid_analysis_view` | 亦庄物理网格综合分析视图 | 物理网格+管理网格 | `query_ads_grid_analysis_view`、`compute_ads_grid_analysis_view` |

**迁移状态说明**：

| 状态 | 含义 |
|------|------|
| ✅ 可迁移 | 依赖的本体已全部创建，可直接编写 SKILL.md |
| ❌ 本体待创建 | 所需本体完全不存在 |

---

#### skill-01：macro_analytics（全局宏观分析）

**原 skill 路径**：`yizhuang_brain_mcp/skills/macro-analytics/SKILL.md`

**迁移后路径**：`resource/byclaw/resource/skills/macro-analytics/SKILL.md`

**迁移状态**：✅ 可迁移（所有依赖本体已创建）

> `region_innovation_index` intent 暂无对应本体，当前版本裁掉该 intent，后续补充。

---

##### 原 skill 机制分析

| 维度 | 原实现 |
|------|--------|
| 调用方式 | 单一 Facade Tool：`macro_analytics` |
| 内部路由 | 按 `intent` 分发：`distribution` / `indicators` / `benchmark` / `region_innovation_index` |
| 跨表能力 | 通过 `target_table` 参数在同一 tool 内切换企业/网格/产业链/AOI 四张表 |

**核心差异**：原 skill 用一个 Facade Tool + `target_table` 参数统一访问多表；byclaw 每张表是独立的 tool，LLM 需要根据数据域自行选择对应 tool。

---

##### byclaw 本体映射

| 原 `target_table` / `target_entity` | byclaw 本体编码 | 生成 tool | 状态 |
|-------------------------------------|---------------|----------|------|
| `enterprise` | `ads_enterprise_analysis` | `query_ads_enterprise_analysis`、`compute_ads_enterprise_analysis` | ✅ |
| `enterprise`（综合视图）| `ads_enterprise_analysis_view` | `query_ads_enterprise_analysis_view`、`compute_ads_enterprise_analysis_view` | ✅ |
| `mgr_grid` | `ads_manage_grid_analysis` | `query_ads_manage_grid_analysis`、`compute_ads_manage_grid_analysis` | ✅ |
| `phy_grid` | `ads_grid_analysis` | `query_ads_grid_analysis`、`compute_ads_grid_analysis` | ✅ |
| `phy_grid + mgr_grid`（综合视图）| `ads_grid_analysis_view` | `query_ads_grid_analysis_view`、`compute_ads_grid_analysis_view` | ✅ |
| `chain` | `ads_chain_analysis` | `query_ads_chain_analysis`、`compute_ads_chain_analysis` | ✅ |
| `aoi` | `ads_aoi_analysis` | `query_ads_aoi_analysis`、`compute_ads_aoi_analysis` | ✅ |
| `region_innovation_index` | 无对应本体 | — | ❌ 暂裁，后续补 |

---

##### 迁移后 allowed-tools

```yaml
allowed-tools: >
  query_ads_enterprise_analysis_view, compute_ads_enterprise_analysis_view,
  query_ads_enterprise_analysis, compute_ads_enterprise_analysis,
  query_ads_grid_analysis_view, compute_ads_grid_analysis_view,
  query_ads_manage_grid_analysis, compute_ads_manage_grid_analysis,
  query_ads_grid_analysis, compute_ads_grid_analysis,
  query_ads_chain_analysis, compute_ads_chain_analysis,
  query_ads_aoi_analysis, compute_ads_aoi_analysis
```

---

##### 正文改造要点

原 `macro_analytics(intent=xxx, target_table=yyy, ...)` 的 Facade 调用，改为 LLM 根据数据域直接选对应本体 tool：

| 原调用示例 | 迁移后调用 |
|-----------|----------|
| `macro_analytics(intent="distribution", target_table="enterprise", group_by_dimension="industry_name")` | `query_ads_enterprise_analysis(group_by="industry_name", agg="count")` |
| `macro_analytics(intent="indicators", target_entity="enterprise", metric=["total_revenue","total_tax"], agg_func="SUM")` | `compute_ads_enterprise_analysis(metrics=["total_revenue","total_tax"], agg_func="SUM")` |
| `macro_analytics(intent="indicators", target_entity="mgr_grid", metric="output_per_mu", agg_func="AVG")` | `compute_ads_manage_grid_analysis(metric="output_per_mu", agg_func="AVG")` |
| `macro_analytics(intent="indicators", target_entity="aoi", metric="revenue_per_mu", agg_func="AVG", group_by="mgr_grid_name")` | `compute_ads_aoi_analysis(metric="revenue_per_mu", agg_func="AVG", group_by="mgr_grid_name")` |
| `macro_analytics(intent="region_innovation_index", ...)` | ❌ 暂无对应本体，待创建后补充；当前版本裁掉该 intent |

**路由纪律（原 skill 约束全部保留）**：
- 分布/总量/聚合问题：只调聚合参数，**禁止**用无过滤条件的全量查询（前端会撒点）
- 只有用户明确切换到企业个体层才允许调带排序和 limit 的企业查询

**正文保留项**：租户识别（第零步）、防地图误触发路由纪律、场景描述、表述语气与置信度纪律、出处标注纪律——**全部原样保留**，仅替换 tool 调用示例。

---

##### 待确认事项

1. **`region_innovation_index` intent**：是否需要新建"区域创新指数"本体？还是先裁掉，后续有需求再补？

---

##### 验收测试题

以下 6 道题均有从 `yizhuang_brain` 数据库查出的预期答案，用于对比迁移前后 skill 行为是否一致。测试时**不传 `resource_list`**，验证 agent 能否自主发现并调用 macro_analytics skill。

---

**测试题 1：企业行业分布（distribution 场景）**

> 亦庄企业按行业分布，数量前5是哪些？

预期答案（`ads_enterprise_analysis` 按 `industry_name` 计数，降序）：

| 行业 | 企业数 |
|------|--------|
| 科学研究和技术服务业_科技推广和应用服务业 | 27,227 |
| 租赁和商务服务业_商务服务业 | 13,477 |
| 批发和零售业_批发业 | 8,958 |
| 文化、体育和娱乐业_文化艺术业 | 8,306 |
| 批发和零售业_零售业 | 7,798 |

验证要点：
- ✅ agent 自主调用 `compute_ads_enterprise_analysis_view(group_by="industry_name", agg="count")`
- ❌ 不得用无聚合的 `query_ads_enterprise_analysis` 拉全量列表来数数（会触发前端撒点）

---

**测试题 2：全区总营收和总税收（indicators 多指标场景）**

> 亦庄全区企业总营收和总税收是多少？

预期答案（`ads_enterprise_analysis` SUM）：
- 总营收：约 **15,955 万元**
- 总税收：约 **1,155 万元**

验证要点：
- ✅ 一次调用拿两个指标：`compute_ads_enterprise_analysis(metrics=["total_revenue","total_tax"], agg_func="SUM")`
- ❌ 不得拆成两次分别查

---

**测试题 3：各街道亩均营收排行（network 聚合场景）**

> 亦庄各街道/地区亩均营收排名是怎样的？

预期答案（`ads_manage_grid_analysis` 按 `mgr_grid_name` 的 `output_per_mu` 均值，降序，共10条）：

| 街道 | 平均亩均营收（万元/亩） |
|------|----------------------|
| 荣华街道 | 3,526.61 |
| 博兴街道 | 1,098.96 |
| 台湖镇 | 365.77 |
| 马驹桥镇 | 226.50 |
| 亦庄地区 | 170.23 |
| 旧宫地区 | 88.51 |
| 瀛海地区 | 74.39 |
| 采育镇 | 68.56 |
| 长子营镇 | 12.88 |
| 青云店镇 | 1.85 |

验证要点：
- ✅ 调用 `compute_ads_manage_grid_analysis(metric="output_per_mu", agg_func="AVG", group_by="mgr_grid_name")`
- ✅ 结果共10条，标题写"共10个街道/地区"，**禁止**写"TOP10"（全量返回，非截断）

---

**测试题 4：上市类型分布（枚举分组场景）**

> 亦庄企业按上市类型分布情况？

预期答案（`ads_enterprise_analysis` 按 `listing_type_name` 计数，主要类型）：

| 上市类型 | 企业数 |
|---------|--------|
| 未上市 | 102,689 |
| 退市 | 49 |
| 新三板挂牌 | 35 |
| 已上市 - 港交所主板 | 21 |
| 已上市 - 创业板 | 15 |
| 已上市 - 科创板 | 9 |

验证要点：
- ✅ 使用 `listing_type_name` 字段分组
- ❌ 不得用 `is_listed` / `listing_status` / `listing_type` 等非法字段名

---

**测试题 5：专精特新企业梯度分布（条件过滤场景）**

> 亦庄有多少家专精特新企业？各梯度分别多少？

预期答案（`ads_enterprise_analysis` 按 `sme_gradient_level` 计数，排除"无"）：

| 梯度 | 数量 |
|------|------|
| 省级"专精特新"中小企业 | 976 |
| 省级创新型中小企业 | 577 |
| 国家专精特新"小巨人"企业 | 173 |
| 单项冠军 | 14 |

有资质合计：**1,740 家**

验证要点：
- ✅ 过滤掉 `sme_gradient_level = '无'`，只统计有梯度的企业
- ❌ 不得把"无"的 101,121 家计入结果

---

**测试题 6：荣华街道总营收（带条件聚合场景）**

> 荣华街道的企业总营收和总税收是多少？

预期答案（`ads_enterprise_analysis` 过滤 `mgr_grid_name='荣华街道'` 后 SUM）：
- 企业数：43,811 家
- 总营收：约 **11,319 万元**
- 总税收：约 **833 万元**

验证要点：
- ✅ 调用 `compute_ads_enterprise_analysis_view(metrics=["total_revenue","total_tax"], agg_func="SUM", filters={"mgr_grid_name":"荣华街道"})`
- ❌ 不得用 `macro_analytics` 按 `enterprise_name` 分组模拟（旧写法，已不存在）


---

#### skill-02：enterprise_analysis（企业微观画像分析）

**原 skill 路径**：`yizhuang_brain_mcp/skills/enterprise-analysis/SKILL.md`

**迁移后路径**：`resource/byclaw/resource/skills/enterprise-analysis/SKILL.md`

**迁移状态**：✅ 可迁移

##### 本体映射

| 原 intent | byclaw tool | 说明 |
|----------|------------|------|
| `search` / `grouped_topn` / `profile` / `sti` / `ops` / `risk` / `executive` | `query_ads_enterprise_analysis` | 企业各切面查询 |
| 跨 AOI/产业链/网格 筛选 | `query_ads_enterprise_analysis_view` | 需关联其他表时用视图 |

##### 迁移后 allowed-tools

```yaml
allowed-tools: >
  query_ads_enterprise_analysis, compute_ads_enterprise_analysis,
  query_ads_enterprise_analysis_view, compute_ads_enterprise_analysis_view
```

##### 正文改造要点

- 原 `enterprise_analysis(intent=xxx)` 改为直接调 `query_ads_enterprise_analysis`，通过 `filters` 传筛选条件
- 路由纪律（防撒点）全部保留：宏观/分布类问题禁止调本 skill
- `listing_type_name` 字段名约束保留，`scope_type="region"` 非法值约束保留

##### 验收测试题

1. 亦庄荣华街道有哪些专精特新企业？（预期：国家级89家等）
2. 亦庄有哪些科创板上市企业？（预期：9家）
3. 亦庄有多少瞪羚企业和独角兽企业？（预期：瞪羚408、独角兽27）
4. 查询机器人产业链上的企业清单（验证 `query_ads_enterprise_analysis_view` 按 `chain_name` 筛选）
5. 各街道税收前3的企业分别是哪些？（验证 `grouped_topn` 场景）
6. 亦庄有多少家企业？（路由纪律验证：应转 macro_analytics，不得拉列表计数）

---

#### skill-03：chain_analysis（产业链与环节分析）

**原 skill 路径**：`yizhuang_brain_mcp/skills/chain-analysis/SKILL.md`

**迁移后路径**：`resource/byclaw/resource/skills/chain-analysis/SKILL.md`

**迁移状态**：✅ 可迁移

##### 本体映射

| 原 intent | byclaw tool | 说明 |
|----------|------------|------|
| `align` | `query_ads_chain_analysis` (keyword 模糊) | 术语对齐 |
| `macro` | `query_ads_chain_analysis` / `compute_ads_chain_analysis` | 整链规模汇总 |
| `segment` | `query_ads_chain_analysis` (按 item_type 过滤) | 环节下钻与诊断 |
| `supply` | `query_ads_enterprise_analysis_view` (按 chain_name 筛选) | 链上企业 |
| `space` | `query_ads_enterprise_analysis_view` (chain_name + mgr_grid_name 分组) | 空间分布 |
| `bidding` | — | 暂无招投标专项本体，当前版本裁掉 |

##### 迁移后 allowed-tools

```yaml
allowed-tools: >
  query_ads_chain_analysis, compute_ads_chain_analysis,
  query_ads_enterprise_analysis_view, compute_ads_enterprise_analysis_view
```

##### 验收测试题

1. 亦庄有哪些产业链？（预期：共8条，标题写"产业链分布（共8条）"，禁止写"TOP8"）
2. 亦庄机器人产业链整体规模怎么样？（预期：核心部件761家/3.97亿，整机1370家/3.28亿，场景914家/1.02亿）
3. 机器人产业链各环节指标，按上游→中游→下游展示（验证顺序约束，禁止按数值重排）
4. 新能源汽车产业链上有哪些企业？（验证 supply 场景）
5. 某条产业链主要分布在哪些街道？（验证 space 场景）
6. 用户说"芯片"，应对齐到哪条标准产业链？（验证 align 场景）

---

#### skill-04：grid_analysis（网格中观分析）

**原 skill 路径**：`yizhuang_brain_mcp/skills/grid-analysis/SKILL.md`

**迁移后路径**：`resource/byclaw/resource/skills/grid-analysis/SKILL.md`

**迁移状态**：✅ 可迁移

##### 本体映射

| 原 intent | byclaw tool | 说明 |
|----------|------------|------|
| `search` | `query_ads_grid_analysis_view` | 筛选网格 |
| `profile` | `query_ads_grid_analysis_view` | 单网格定点查询 |
| `nearby` | `query_ads_enterprise_analysis_view` (按网格名近邻) | 周边企业 |

##### 迁移后 allowed-tools

```yaml
allowed-tools: >
  query_ads_grid_analysis_view, compute_ads_grid_analysis_view,
  query_ads_manage_grid_analysis, compute_ads_manage_grid_analysis,
  query_ads_grid_analysis, compute_ads_grid_analysis,
  query_ads_enterprise_analysis_view
```

##### 验收测试题

1. 亦庄荣华街道的经济指标是什么？（预期：营收113亿、亩均3527万、企业4.4万家）
2. 哪些街道亩均营收高于1000万元/亩？（预期：荣华3527、博兴1099，共2条）
3. 亦庄荣华街道共有多少个物理网格？（预期：490个）
4. 亦庄各街道总营收排名前3？（预期：荣华>博兴>马驹桥）
5. 某地块周边企业有哪些？（验证 nearby 场景）

---

#### skill-05：aoi_analysis（楼宇/AOI分析）

**原 skill 路径**：`yizhuang_brain_mcp/skills/aoi-analysis/SKILL.md`

**迁移后路径**：`resource/byclaw/resource/skills/aoi-analysis/SKILL.md`

**迁移状态**：✅ 可迁移

##### 本体映射

| 场景 | byclaw tool |
|------|------------|
| AOI 列表/排行/聚合 | `query_ads_aoi_analysis` / `compute_ads_aoi_analysis` |
| 楼宇内企业清单 | `query_ads_enterprise_analysis_view` (按 aoi_name 筛选) |

##### 迁移后 allowed-tools

```yaml
allowed-tools: >
  query_ads_aoi_analysis, compute_ads_aoi_analysis,
  query_ads_enterprise_analysis_view
```

##### 验收测试题

1. 亦庄共有多少个楼宇？（预期：193个）
2. 亦庄亩均营收最高的楼宇是哪个？（预期：博大大厦，约1236万/亩）
3. 按 AOI 类型统计各类型数量分布（验证 aoi_type_2 分组）
4. 某楼宇里有哪些企业？（验证 aoi_name 筛选企业场景）
5. 用户问"楼宇"的报告，应路由到 report_street_checkup（验证路由约束）

---

#### skill-06：chain_space_penetration（产业链空间穿透）

**原 skill 路径**：`yizhuang_brain_mcp/skills/chain-space-penetration/SKILL.md`

**迁移后路径**：`resource/byclaw/resource/skills/chain-space-penetration/SKILL.md`

**迁移状态**：✅ 可迁移

##### 本体映射

原 Facade Tool `chain_space_penetration` 内部并行调用多源，迁移后 LLM 自行拆解：

| 步骤 | byclaw tool |
|------|------------|
| 查产业链宏观 | `query_ads_chain_analysis` |
| 查链上企业+网格归属 | `query_ads_enterprise_analysis_view` (chain_name + mgr_grid_name 分组) |
| 查环节空间分布 | `query_ads_enterprise_analysis_view` (chain_item_name + mgr_grid_name 分组) |

##### 迁移后 allowed-tools

```yaml
allowed-tools: >
  query_ads_chain_analysis, compute_ads_chain_analysis,
  query_ads_enterprise_analysis_view, compute_ads_enterprise_analysis_view
```

##### 验收测试题

1. 机器人产业链在亦庄各街道的空间分布是怎样的？（按企业数降序，验证集聚度判定）
2. 机器人产业链上游环节（核心部件）主要集中在哪些街道？
3. 新能源汽车产业链企业主要在哪些地块？

---

#### skill-07：enterprise_relocation_warning（企业迁离预警）

**迁移状态**：❌ 本体待创建

**说明**：依赖综合评分模型（地址变更+招聘收缩双信号），byclaw 无对应本体。

##### 验收测试题（待本体创建后）

1. 亦庄全区哪些企业有外迁风险？
2. 荣华街道企业迁离风险扫描
3. 机器人产业链上有哪些高迁离风险企业？

---

#### skill-08：grid_space_optimization（网格空间优化）

**迁移状态**：❌ 本体待创建

**说明**：依赖空间腾退/扩容评分模型。

##### 验收测试题（待本体创建后）

1. 亦庄荣华街道哪些地块亩均营收偏低，适合腾退？
2. 亦庄高效益地块扩容潜力分析

---

#### skill-09：investment_hunt_match（招商猎企匹配）

**迁移状态**：❌ 本体待创建

##### 验收测试题（待本体创建后）

1. 亦庄机器人产业链缺少哪类企业？应引进什么？
2. 帮我找适合落户亦庄的新能源汽车零部件企业

---

#### skill-10：opportunity_radar（机会雷达扫描）

**迁移状态**：❌ 本体待创建

##### 验收测试题（待本体创建后）

1. 亦庄最近有哪些高成长潜力企业？（high_growth intent）
2. 荣华街道有哪些企业最近有融资动态？（active_signal intent）
3. 亦庄哪些企业有政策服务机会？（policy_service intent）

---

#### skill-11：policy_analysis（本地政策规划问答）

**原 skill 路径**：`yizhuang_brain_mcp/skills/policy-analysis/SKILL.md`

**迁移后路径**：`resource/byclaw/resource/skills/policy-analysis/SKILL.md`

**迁移状态**：⚠️ 部分可迁移（`ads_policy_document` 9条已存在；`read_file` tool 已就绪；本地 `.md` 政策文件需确认路径）

##### 迁移后 allowed-tools

```yaml
allowed-tools: >
  query_ads_policy_document,
  query_ads_enterprise_analysis, compute_ads_enterprise_analysis,
  read_file
```

##### 验收测试题

1. 亦庄现有哪些政策文档？（预期：共9条）
2. 亦庄十五五产业发展方向是什么？（P0验证：应先 read_file 读本地 .md，不先调 MCP）
3. 哪些企业符合亦庄高新技术企业认定条件？（企业资质匹配场景）

---

#### skill-12 ～ skill-17：其余报告类/评估类 skill

以下6个 skill 均依赖 Facade Tool 内部聚合逻辑（多源并行 + 固定章节生成），byclaw 无对应本体，**暂缓迁移**：

| # | skill | 待创建本体 |
|---|-------|---------|
| 12 | policy_simulation | 政策模拟本体 |
| 13 | policy_effectiveness_evaluation | 政策效能评估本体 |
| 14 | report_annual_briefing | 年度报告聚合本体 |
| 15 | report_chain_thematic | 产业链报告本体 |
| 16 | report_enterprise_service | 企业报告本体 |
| 17 | report_street_checkup | 街道报告本体 |

##### 验收测试题（各 skill，待本体创建后）

- **policy_simulation**：如果亦庄对机器人产业补贴，产业规模会如何变化？
- **policy_effectiveness_evaluation**：专精特新政策对机器人产业链的实际影响如何？
- **report_annual_briefing**：帮我生成亦庄2025年度运行报告
- **report_chain_thematic**：写一份亦庄机器人产业链专题报告
- **report_enterprise_service**：帮我做某企业的一企一档
- **report_street_checkup**：生成荣华街道体检报告

---

### 迁移状态汇总

| # | skill | 状态 | 依赖本体 |
|---|-------|------|---------|
| 01 | macro_analytics | ✅ 已完成 SKILL.md | ads_enterprise_analysis_view + ads_* |
| 02 | enterprise_analysis | ✅ 待写 SKILL.md | ads_enterprise_analysis(_view) |
| 03 | chain_analysis | ✅ 待写 SKILL.md | ads_chain_analysis, ads_enterprise_analysis_view |
| 04 | grid_analysis | ✅ 待写 SKILL.md | ads_grid_analysis_view, ads_manage_grid_analysis |
| 05 | aoi_analysis | ✅ 待写 SKILL.md | ads_aoi_analysis, ads_enterprise_analysis_view |
| 06 | chain_space_penetration | ✅ 待写 SKILL.md | ads_chain_analysis, ads_enterprise_analysis_view |
| 07 | enterprise_relocation_warning | ❌ 本体待创建 | 迁离预警评分本体 |
| 08 | grid_space_optimization | ❌ 本体待创建 | 空间优化评分本体 |
| 09 | investment_hunt_match | ❌ 本体待创建 | 招商匹配本体 |
| 10 | opportunity_radar | ❌ 本体待创建 | 机会雷达本体 |
| 11 | policy_analysis | ⚠️ 部分可迁移 | ads_policy_document（已有9条）+ read_file |
| 12 | policy_simulation | ❌ 本体待创建 | 政策模拟本体 |
| 13 | policy_effectiveness_evaluation | ❌ 本体待创建 | 政策效能评估本体 |
| 14 | report_annual_briefing | ❌ 本体待创建 | 年度报告聚合本体 |
| 15 | report_chain_thematic | ❌ 本体待创建 | 产业链报告本体 |
| 16 | report_enterprise_service | ❌ 本体待创建 | 企业报告本体 |
| 17 | report_street_checkup | ❌ 本体待创建 | 街道报告本体 |

**可立即迁移（✅）：6个**（skill-01 已完成，skill-02～06 待写 SKILL.md）

**部分可迁移（⚠️）：1个**（skill-11 policy_analysis）

**待本体创建（❌）：10个**
