"""会议纪要生成器 — 从内置 Mock 数据池返回 DataCloud 项目会议纪要。

Agent 只需调用 `python generate_meeting_minutes.py` 即可获得一篇会议纪要文本，
内部逻辑 Agent 无感。

Usage:
    python generate_meeting_minutes.py                    # 随机一篇（text 模式）
    python generate_meeting_minutes.py --index 0          # 指定第N篇（0-based）
    python generate_meeting_minutes.py --output json      # JSON 格式（含结构化字段）
    python generate_meeting_minutes.py --seed 42          # 指定随机种子
"""

from __future__ import annotations

import json
import random
import sys
from dataclasses import dataclass
from typing import Any

# ============================================================
# Mock 数据 — 三篇 DataCloud 项目会议纪要
# ============================================================


@dataclass
class MeetingNote:
    meeting_theme: str
    meeting_date: str
    participants: list[str]
    summary: str
    todos: list[str]
    content: str


_MEETING_NOTES: list[MeetingNote] = [
    MeetingNote(
        meeting_theme="DataCloud平台需求确认会",
        meeting_date="2026-05-25",
        participants=["黄药师", "欧阳锋", "韦小宝"],
        summary="本次会议围绕DataCloud数据分析平台的功能需求进行确认，"
        "明确了数据采集、清洗、分析、可视化四大核心模块的业务需求优先级。",
        todos=[
            "产品团队输出详细需求文档（负责人：黄药师，截止：2026-06-08）",
            "架构师完成技术方案设计（负责人：欧阳锋，截止：2026-06-18）",
            "研发团队评估开发周期（负责人：韦小宝，截止：2026-06-25）",
        ],
        content="""# 会议纪要

## 基本信息

| 属性 | 值 |
|------|-----|
| **会议主题** | DataCloud平台需求确认会 |
| **会议日期** | 2026-05-25 |
| **参会人员** | 黄药师、欧阳锋、韦小宝 |
| **会议摘要** | 本次会议围绕DataCloud数据分析平台的功能需求进行确认，明确了数据采集、清洗、分析、可视化四大核心模块的业务需求优先级。 |
| **待办事项** | 1. 产品团队输出详细需求文档（负责人：黄药师，截止：2026-06-08）<br>2. 架构师完成技术方案设计（负责人：欧阳锋，截止：2026-06-18）<br>3. 研发团队评估开发周期（负责人：韦小宝，截止：2026-06-25） |

## 会议详情

### 议题一：DataCloud平台整体规划

DataCloud平台定位为企业的统一数据分析平台，目标是：

- 实现多数据源一键接入（MySQL、PostgreSQL、MongoDB、API等）
- 可视化数据清洗流程，降低使用门槛
- 自助式报表搭建，满足业务部门日常数据分析需求
- 实时大屏展示，支持数据驾驶舱

### 议题二：功能模块优先级排序

| 优先级 | 模块名称 | 业务价值 |
|--------|---------|---------|
| P0 | 数据采集与同步 | 核心基础能力 |
| P0 | 数据清洗与转换 | 核心基础能力 |
| P1 | 可视化报表 | 业务刚需 |
| P1 | 实时大屏 | 展示需求 |
| P2 | 自助数据挖掘 | 高级功能 |

### 议题三：上线计划

**第一阶段（MVP）**：6月25日

- 数据采集、清洗、基础报表

**第二阶段**：7月15日
- 实时大屏、自助分析

---""",
    ),
    MeetingNote(
        meeting_theme="DataCloud研发技术方案评审会",
        meeting_date="2026-05-26",
        participants=["欧阳锋", "韦小宝", "周伯通"],
        summary="本次会议对DataCloud平台的技术方案进行评审，"
        "确定了数据存储选型、流处理架构、前端技术栈等核心技术决策。",
        todos=[
            "研发团队完成详细技术设计文档（负责人：欧阳锋，截止：2026-06-19）",
            "DBA完成数据库集群部署方案（负责人：周伯通，截止：2026-06-19）",
            "测试团队输出测试计划（负责人：周伯通，截止：2026-06-19）",
        ],
        content="""# 会议纪要

## 基本信息

| 属性 | 值 |
|------|-----|
| **会议主题** | DataCloud研发技术方案评审会 |
| **会议日期** | 2026-05-26 |
| **参会人员** | 欧阳锋、韦小宝、周伯通 |
| **会议摘要** | 本次会议对DataCloud平台的技术方案进行评审，确定了数据存储选型、流处理架构、前端技术栈等核心技术决策。 |
| **待办事项** | 1. 研发团队完成详细技术设计文档（负责人：欧阳锋，截止：2026-06-19）<br>2. DBA完成数据库集群部署方案（负责人：周伯通，截止：2026-06-19）<br>3. 测试团队输出测试计划（负责人：周伯通，截止：2026-06-19） |

## 会议详情

### 议题一：数据存储方案

| 数据场景 | 选型方案 | 说明 |
|---------|---------|------|
| 原始数据存储 | Apache Iceberg | 支持事务、高并发读取 |
| 清洗后数据 | ClickHouse | 列式存储，分析性能优 |
| 业务元数据 | PostgreSQL | 关系型，事务支持 |
| 缓存层 | Redis | 热数据加速 |

### 议题二：流处理架构

采用Flink作为实时计算引擎：
- 支持 Exactly-Once 语义
- 毫秒级延迟
- 社区成熟，生态完善

### 议题三：前端技术选型

- **框架**：Vue3 + TypeScript
- **可视化库**：ECharts + DataV
- **构建工具**：Vite

### 议题四：研发里程碑

| 阶段 | 内容 | 计划时间 |
|------|------|---------|
| Sprint 1 | 数据采集模块开发 | 3周 |
| Sprint 2 | 数据清洗模块开发 | 3周 |
| Sprint 3 | 报表功能开发 | 2周 |
| Sprint 4 | 联调测试与优化 | 2周 |""",
    ),
    MeetingNote(
        meeting_theme="DataCloud项目进度同步会",
        meeting_date="2026-05-27",
        participants=["黄药师", "欧阳锋", "韦小宝", "周伯通"],
        summary="本次会议同步了DataCloud平台当前研发进度，"
        "讨论了Sprint 1阶段的完成情况及Sprint 2阶段的准备工作，确认了测试上线计划。",
        todos=[
            "研发团队修复Sprint 1遗留问题（负责人：欧阳锋，截止：2026-07-01）",
            "产品经理完成Sprint 2需求评审（负责人：黄药师，截止：2026-07-05）",
            "质量团队开始编写自动化测试用例（负责人：周伯通，截止：2026-07-10）",
        ],
        content="""# 会议纪要

## 基本信息

| 属性 | 值 |
|------|-----|
| **会议主题** | DataCloud项目进度同步会 |
| **会议日期** | 2026-05-27 |
| **参会人员** | 黄药师、欧阳锋、韦小宝、周伯通 |
| **会议摘要** | 本次会议同步了DataCloud平台当前研发进度，讨论了Sprint 1阶段的完成情况及Sprint 2阶段的准备工作，确认了测试上线计划。 |
| **待办事项** | 1. 研发团队修复Sprint 1遗留问题（负责人：欧阳锋，截止：2026-07-01）<br>2. 产品经理完成Sprint 2需求评审（负责人：黄药师，截止：2026-07-05）<br>3. 质量团队开始编写自动化测试用例（负责人：周伯通，截止：2026-07-10） |

## 会议详情

### Sprint 1完成情况

| 模块 | 功能点 | 完成状态 |
|------|--------|---------|
| 数据采集 | MySQL数据同步 | ✅ 已完成 |
| 数据采集 | PostgreSQL数据同步 | ✅ 已完成 |
| 数据采集 | API数据接入 | ⚠️ 部分完成 |
| 数据采集 | 增量同步机制 | ✅ 已完成 |

### 遗留问题

1. MongoDB数据源接入偶现连接超时问题（研发负责人跟进中）
2. 任务调度系统在高并发场景下存在资源竞争（优化方案已确定，计划Sprint 2修复）

### Sprint 2计划

**主题**：数据清洗模块开发

- 数据质量规则配置
- 清洗任务可视化编排
- 数据异常检测与告警
- 清洗任务调度与监控

### 上线准备

- 计划7月15日完成Sprint 2开发
- 7月15日-20日进行集成测试
- 7月25日预发布
- 7月30日正式上线

---""",
    ),
]

# ============================================================
# 生成逻辑
# ============================================================


def pick_meeting_note(index: int | None = None, seed: int | None = None) -> MeetingNote:
    """返回一篇会议纪要。

    Args:
        index: 指定索引（0-2），None 时随机选取。
        seed: 随机种子。
    """
    if seed is not None:
        random.seed(seed)

    if index is not None:
        if not (0 <= index < len(_MEETING_NOTES)):
            raise ValueError(f"index 超出范围 [0, {len(_MEETING_NOTES) - 1}]")
        return _MEETING_NOTES[index]

    return random.choice(_MEETING_NOTES)


def to_dict(note: MeetingNote) -> dict[str, Any]:
    return {
        "meeting_theme": note.meeting_theme,
        "meeting_date": note.meeting_date,
        "participants": note.participants,
        "summary": note.summary,
        "todos": note.todos,
        "content": note.content,
    }


def main() -> None:
    output_format = "text"
    index: int | None = None
    seed: int | None = None

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--output" and i + 1 < len(args):
            output_format = args[i + 1]
            i += 2
        elif args[i] == "--index" and i + 1 < len(args):
            index = int(args[i + 1])
            i += 2
        elif args[i] == "--seed" and i + 1 < len(args):
            seed = int(args[i + 1])
            i += 2
        else:
            i += 1

    note = pick_meeting_note(index=index, seed=seed)

    if output_format == "json":
        print(json.dumps(to_dict(note), ensure_ascii=False, indent=2))
    else:
        print(note.content)


if __name__ == "__main__":
    main()
