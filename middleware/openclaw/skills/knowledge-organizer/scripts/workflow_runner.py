#!/usr/bin/env python3
"""Stateful, progressively-disclosed workflow for knowledge organization.

This runner deliberately does not invoke other skills.  It owns only task state,
directory setup, artifact validation, and the next-step instructions an agent sees.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


WORKFLOW_DIR_NAME = "knowledge-organizer"
STATE_FILE_NAME = "state.json"
STEP_COUNT = 8


class WorkflowError(Exception):
    """An invalid command or workflow state."""


def emit(payload: dict[str, Any], code: int = 0) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    raise SystemExit(code)


def task_path(session_root: Path, session_id: str, task_name: str) -> Path:
    if not session_id.strip() or not task_name.strip():
        raise WorkflowError("session-id 和 task-name 不能为空")
    return session_root / session_id / task_name


def workflow_dir(task_dir: Path) -> Path:
    return task_dir / WORKFLOW_DIR_NAME


def state_path(task_dir: Path) -> Path:
    return workflow_dir(task_dir) / STATE_FILE_NAME


def load_state(task_dir: Path) -> dict[str, Any]:
    path = state_path(task_dir)
    if not path.is_file():
        raise WorkflowError(f"未找到工作流状态文件: {path}")
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkflowError(f"工作流状态文件不是合法 JSON: {exc}") from exc
    if not isinstance(state, dict):
        raise WorkflowError("工作流状态文件必须是 JSON 对象")
    return state


def save_state(task_dir: Path, state: dict[str, Any]) -> None:
    state_path(task_dir).write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def resolved(path: str | Path) -> Path:
    return Path(path).expanduser().resolve()


def is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def controlled_file(value: str | None, task_dir: Path, label: str, *, required: bool = True) -> Path | None:
    if not value:
        if required:
            raise WorkflowError(f"缺少 {label}")
        return None
    path = resolved(value)
    if not is_within(path, task_dir.resolve()):
        raise WorkflowError(f"{label} 必须位于任务目录内: {task_dir}")
    if not path.is_file():
        raise WorkflowError(f"{label} 不存在或不是文件: {path}")
    return path


def read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkflowError(f"{label} 不是合法 JSON: {exc}") from exc


def nonempty_file(path: Path, label: str) -> list[str]:
    return [] if path.read_text(encoding="utf-8").strip() else [f"{label} 不能为空: {path}"]


def markdown_has_front_matter_and_body(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\s*\n.*?\n---\s*\n(.*)$", text, re.DOTALL)
    return bool(match and match.group(1).strip())


def prompt(step: int) -> str:
    prompts = {
        1: """Step 1：阅读已锁定的本地素材

只读取 state.json 中 sources 指定的本体文件系统路径；不得搜索、下载、采集或引入其他渠道素材。阅读全部素材，归纳主题、事实、来源依据和可能的对象实例。此时不要自行决定对象范围，也不要生成对象文档；对象详情和范围选择在 Step 2 完成。

完成后在 knowledge-organizer/step-01/read-summary.md 写入阅读摘要，再调用 complete --step 1 --report <文件>。""",
        2: """Step 2：获取对象详情并自主选择整理范围

先确认 <knowledge-organizer>/scripts/add_related_docs.py 的 PyYAML 依赖可用：`python3 -c "import yaml"`；不可用且无法修复时调用 failed。然后执行：

```bash
python3 <unstructured-ontology-manager>/scripts/list_mounted_resources.py \
  '{"resource_id":"<数字员工 resource_id>"}'
```

将完整标准输出原样保存为 `knowledge-organizer/step-02/mounted-resources.json`。仅处理其中 `resourceBizType="OBJECT"` 的资源。对每个对象资源的 `resourceCode` 逐一执行：

```bash
python3 <unstructured-ontology-manager>/scripts/get_object.py \
  '{"object_code":"<object_code>"}'
```

将每次完整标准输出原样保存为 `knowledge-organizer/step-02/object-details/{对象名称}.json`。该命令返回字段属性、正文模板和对象关系规则。

**禁止使用 baiying_call 查询、补全或推断对象定义。** Step 2 的对象列表与对象详情只能来自上述 `list_mounted_resources.py` 和 `get_object.py`；不要由 workflow_runner 调用这些脚本。

将 list_mounted_resources 的原始返回保存为 knowledge-organizer/step-02/mounted-resources.json。将每个 get_object 原始 JSON 分别保存到 knowledge-organizer/step-02/object-details/{对象名称}.json，并维护 index.json（object_name、object_code、resource_id、resource_code、detail_file）；resource ID/编码取自挂载列表，不得伪造。

若用户初始输入明确指定对象名称或编码，必须写 scope_mode=user_specified 与 requested_scope，并且 selected 只能是该范围内的匹配对象；任一指定对象未匹配时调用 failed，绝不回退全量或扩展范围。未指定时才写 scope_mode=agent_selected、requested_scope=[]，并基于 Step 1、对象详情自主选择。selection.json 还必须写 selected（object_name、object_code、reason）与 excluded（object_name、reason）。不确定对象标记为候选但必须纳入 selected。所有对象都不适用时调用 failed。完成时用 --object-details-dir 和 --selection-file 提交。""",
        3: """Step 3：按所选对象生成对象级文档

只使用初始化锁定的 sources。三类目录严格隔离：本步骤只能写 新建对象/{对象名称}/；知识库候选仅供 Step 5.5 下载；融合结果仅放实际发生变更的融合文档。正文和 YAML 都由本 skill 自己生成：front matter 只能使用对象详情定义的字段；枚举值必须按 <unstructured-ontology-manager>/scripts/get_term_type_values.py 查询，空结果要在字段后备注；正文严格遵循详情中的正文模板。不得把正文或打标委派给其他 skill。

在正文中使用 `[[../类型/文档名.md]]` wiki-link，并写入归属、包含、实现、对应、佐证、支撑、依赖于等关系线索；这为 Step 4 提供关系类型依据。

完成后调用 complete --step 3。Runner 只检查每个所选对象目录至少有一个 Markdown，且每篇同时具有 YAML front matter 和非空正文；内容正确性由你负责。""",
        4: """Step 4：梳理本地对象文档关系

仅在 新建对象 内提取文档间关系。根据对象关系规则和正文线索生成 `knowledge-organizer/step-04/relations_batch.json`；格式必须是数组，例如：

```json
[
  {
    "doc_path": "{任务目录}/新建对象/{对象名称}/{文档名}.md",
    "relations": [
      {
        "target_doc_id": "{任务目录}/新建对象/{对象名称}/{关联文档名}.md",
        "relation": "reference",
        "kb_resource_id": null
      }
    ]
  }
]
```

Step 4 的每个关系必须有 target_doc_id、relation、kb_resource_id，且 `kb_resource_id` 必须为 JSON `null`：本地对象文档尚未入库，禁止填充或编造知识库 ID。归属/包含→part-of，实现→realizes，对应/对位→maps-to，佐证→evidenced-by，支撑→supports，依赖于→depends-on，其余才用 reference。Step 5 的知识库关联才写入真实 kb_resource_id。没有关系时写 `[]`。然后执行：

```bash
python3 <knowledge-organizer>/scripts/add_related_docs.py -b \
  "{任务目录}/knowledge-organizer/step-04/relations_batch.json"
```

不得跳过脚本调用。

完成后调用 complete --step 4 --relations-batch <batch>。""",
        5: """Step 5：梳理知识库外部关联

对每篇新建对象文档，严格按 <add-related-docs> 的三步流程：提取 wiki-link/关系线索，使用 <by-knowledge-manager> 搜索并 read-file 核对命中，最后去重写入 related_docs。检索只用于关联元数据，不得将命中结果作为新增整理素材；无命中时不建边。将逐篇查询线索、命中数与实际写入关系保存为 knowledge-organizer/step-05/kb-relations.json。

完成时调用 complete --step 5 --kb-relations-report <文件>。""",
        6: """Step 5.5：按对象隔离执行实例消解与融合

主 Agent 必须按对象名称每批并发 3–5 个启动隔离子 Agent；不得自己执行 entity-resolution 或 doc-fusion，也不得跳过派发。等待本批结束再启动下一批。派发后立即在 knowledge-organizer/step-05.5/subagent-dispatch.json 记录每个对象的 object_name、agent_id、result_status；没有每个所选对象的真实 agent_id 不得 complete。每个子 Agent 只处理本对象的 新建对象、知识库候选、融合结果 三个目录。子 Agent 先加载 <knowledge-organizer>/skills/entity-resolution；凡判断可以融合的文档对都必须立即加载 <knowledge-organizer>/skills/doc-fusion 并生成融合结果，不等待用户确认。候选只能下载到知识库候选，只能用于融合，不能新增对象或扩大范围；冲突与最终用户确认由 Step 7 的入库工具处理。不得入库、调用 baiying_call 或启动嵌套子 Agent。

派发时提供任务目录、对象名称/类型、identity 字段、KB ID、resource ID 与三个目录路径。主 Agent 将子 Agent 的唯一 Markdown 结果表原样汇总到 knowledge-organizer/step-05.5/entity-resolution-results.md。表头必须是 `object_name | result_status | result_type | current_source_path | candidate_source_path | output_path | detail`；result_status 只能是 completed/partial/failed，result_type 只能是 new/fusion。fusion 行必须给出三条来源/输出路径；new 行不得把候选文件作为输出。再调用 complete --step 5.5 --entity-resolution-results <文件>。""",
        7: """Step 6：预览并等待用户明确确认

生成并保存预览报告（完整三层目录树与地址、各对象代表性摘要、阶段 1/2 关系、所选对象与未使用原因、批内去重、实例消解、融合路径与冲突）到 knowledge-organizer/step-06/preview.md。属性冲突必须以 ⚠️ 展示并要求用户决定；明确告知用户：新建实例会独立入库，融合更新会以融合结果更新，并可指定文件和修改意见。

展示预览后，先调用 complete --step 6 --preview-report <文件>。Runner 会记录预览已展示并返回 awaiting_confirmation，绝不进入 Step 7。随后等待用户在本次预览后明确回复“确认入库”或“可以”；只有这时才能再次调用 complete --step 6 --confirmation <用户原话>。未确认不得推进；用户要求修改时继续在本步骤返工，无法继续时调用 failed。""",
        8: """Step 7：按消解结果分流入库

只入库新建对象文件和融合结果文件，绝不入库知识库候选。主 Agent 直接逐文件调用 baiying_call（不得用子 Agent），每次使用 resource_id=对象 resourceId、resource_type="OBJECT"。新建文件的 query 必须包含：`请对以下文档进行结构化打标录入：文档路径：{完整路径}；文档内容：{完整正文}；请提取关键信息完成字段录入。` fusion 行的 query 必须包含：`请执行融合更新`、`original_source_path: {candidate_source_path}`、`current_source_path: {current_source_path}`、`source_path: {output_path}`、`content: {融合后完整正文}`；三条路径不得替换。按 YAML product_code 和对象目录确定对象。可按对象 ID 分组、每批并发 3–5 个调用，但每个文件必须单独调用。允许单文件重试与部分失败，继续处理其余文件；所有调用结束前不得宣称成功。

将每个预期文件的 source_path、result（success/failed）、attempts、detail 保存为 knowledge-organizer/step-07/ingestion-results.json，完成时调用 complete --step 7 --ingestion-results <文件>。complete 表示工作均已执行可审计，不表示全部成功。""",
        9: """Step 8：汇总结果

汇总整理文档数量、对象分布、批内去重组数、实例消解的新建/融合/冲突数、融合/待确认候选数、两阶段关系数量、入库成功/失败和失败原因与知识库存储路径，保存到 knowledge-organizer/step-08/final-summary.md。完成时调用 complete --step 8 --final-summary <文件>。""",
    }
    return prompts[step]


def selected_objects(state: dict[str, Any]) -> list[dict[str, str]]:
    selection = state.get("selection", {})
    selected = selection.get("selected", []) if isinstance(selection, dict) else []
    return selected if isinstance(selected, list) else []


def validate_step_one(args: argparse.Namespace, task_dir: Path, _state: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    report = controlled_file(args.report, task_dir, "Step 1 阅读摘要")
    assert report is not None
    return nonempty_file(report, "Step 1 阅读摘要"), {"report": str(report)}


def validate_step_two(args: argparse.Namespace, task_dir: Path, _state: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    reasons: list[str] = []
    details_dir_value = getattr(args, "object_details_dir", None)
    selection_value = getattr(args, "selection_file", None)
    if not details_dir_value:
        return ["缺少对象详情目录"], {}
    details_dir = resolved(details_dir_value)
    if not is_within(details_dir, task_dir.resolve()) or not details_dir.is_dir():
        return ["对象详情目录必须位于任务目录内且存在"], {}
    details: dict[str, Path] = {}
    for file_path in sorted(details_dir.glob("*.json")):
        if file_path.name == "index.json":
            continue
        data = read_json(file_path, f"对象详情文件 {file_path.name}")
        payload = data.get("data", data) if isinstance(data, dict) else {}
        object_name = payload.get("objectName") or payload.get("object_name") if isinstance(payload, dict) else None
        if not isinstance(object_name, str) or not object_name.strip():
            reasons.append(f"对象详情缺少对象名称: {file_path.name}")
        elif file_path.stem != object_name:
            reasons.append(f"对象详情必须以对象名称命名: {file_path.name}")
        else:
            details[object_name] = file_path
    if not details:
        reasons.append("至少需要一个按对象名称命名的对象详情 JSON")
    index_file = details_dir / "index.json"
    if not index_file.is_file():
        reasons.append("缺少对象详情索引: index.json")
    else:
        index = read_json(index_file, "对象详情索引")
        index_items = index.get("objects") if isinstance(index, dict) else None
        if not isinstance(index_items, list):
            reasons.append("index.json 必须包含 objects 数组")
        else:
            expected_index_files = {name: f"{name}.json" for name in details}
            indexed_names = {
                item.get("object_name")
                for item in index_items
                if isinstance(item, dict)
                and isinstance(item.get("object_name"), str)
                and isinstance(item.get("object_code"), str)
                and isinstance(item.get("resource_id"), (str, int))
                and isinstance(item.get("resource_code"), str)
                and isinstance(item.get("detail_file"), str)
            }
            if indexed_names != set(details):
                reasons.append("index.json 必须完整映射对象名称、编码、资源 ID/编码和详情文件")
            for item in index_items:
                if isinstance(item, dict) and item.get("object_name") in expected_index_files:
                    if item.get("detail_file") != expected_index_files[item["object_name"]]:
                        reasons.append("index.json 的 detail_file 必须与按对象名称命名的详情文件一致")
    mounted_file = details_dir.parent / "mounted-resources.json"
    if not mounted_file.is_file():
        reasons.append("缺少 list_mounted_resources 的原始返回: mounted-resources.json")
    else:
        mounted = read_json(mounted_file, "挂载对象列表")
        mounted_items = mounted.get("data") if isinstance(mounted, dict) else None
        if not isinstance(mounted_items, list):
            reasons.append("mounted-resources.json 必须包含 data 数组")
        else:
            for item in mounted_items:
                if not isinstance(item, dict):
                    reasons.append("mounted-resources.json 的 data 每项必须是对象")
                    continue
                if item.get("resourceBizType") not in {None, "OBJECT"}:
                    continue
                name = item.get("resourceName")
                if not isinstance(name, str) or not name.strip():
                    reasons.append("挂载对象缺少 resourceName")
                elif name not in details:
                    reasons.append(f"挂载对象缺少按名称保存的原始详情: {name}")
    selection_file = controlled_file(selection_value, task_dir, "对象范围选择文件") if selection_value else None
    if selection_file is None:
        return reasons + ["缺少对象范围选择文件"], {}
    selection = read_json(selection_file, "对象范围选择文件")
    if not isinstance(selection, dict) or not isinstance(selection.get("selected"), list):
        return reasons + ["selection.json 必须包含 selected 数组"], {}
    selected = selection["selected"]
    scope_mode = selection.get("scope_mode")
    requested_scope = selection.get("requested_scope")
    if scope_mode not in {"user_specified", "agent_selected"}:
        reasons.append("selection.json 的 scope_mode 必须是 user_specified 或 agent_selected")
    if not isinstance(requested_scope, list) or not all(isinstance(value, str) and value.strip() for value in requested_scope):
        reasons.append("selection.json 的 requested_scope 必须是字符串数组")
        requested_scope = []
    if scope_mode == "user_specified" and not requested_scope:
        reasons.append("用户指定范围时 requested_scope 不能为空")
    if scope_mode == "agent_selected" and requested_scope:
        reasons.append("自主选择范围时 requested_scope 必须为空")
    details_by_code = {
        str((read_json(path, f"对象详情文件 {path.name}").get("data", {}) or {}).get("objectCode", "")): name
        for name, path in details.items()
    }
    if scope_mode == "user_specified":
        unmatched = [value for value in requested_scope if value not in details and value not in details_by_code]
        if unmatched:
            reasons.append(f"用户指定范围未匹配对象，应调用 failed: {', '.join(unmatched)}")
    if not selected:
        reasons.append("未选择任何适用对象；确实无法整理时应调用 failed")
    for item in selected:
        if not isinstance(item, dict):
            reasons.append("selected 中每项必须是对象")
            continue
        name = item.get("object_name")
        if not isinstance(name, str) or name not in details:
            reasons.append(f"所选对象不存在对应详情文件: {name}")
        elif scope_mode == "user_specified" and name not in requested_scope and item.get("object_code") not in requested_scope:
            reasons.append(f"所选对象超出用户指定范围: {name}")
        if not isinstance(item.get("reason"), str) or not item["reason"].strip():
            reasons.append(f"所选对象缺少选择依据: {name}")
    return reasons, {"details_dir": str(details_dir), "selection": selection}


def validate_step_three(_args: argparse.Namespace, task_dir: Path, state: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    reasons: list[str] = []
    for item in selected_objects(state):
        name = item.get("object_name", "")
        object_dir = task_dir / "新建对象" / name
        files = list(object_dir.rglob("*")) if object_dir.is_dir() else []
        if not files:
            reasons.append(f"所选对象 {name} 至少需要一个 Markdown 文件")
            continue
        non_markdown = [path for path in files if path.is_file() and path.suffix.lower() != ".md"]
        if non_markdown:
            reasons.append(f"所选对象 {name} 含非 Markdown 文件: {non_markdown[0]}")
        markdown_files = [path for path in files if path.is_file() and path.suffix.lower() == ".md"]
        if not markdown_files:
            reasons.append(f"所选对象 {name} 至少需要一个 Markdown 文件")
        for file_path in markdown_files:
            if not markdown_has_front_matter_and_body(file_path):
                reasons.append(f"文档必须包含 YAML front matter 和非空正文: {file_path}")
    return reasons, {}


def validate_step_four(args: argparse.Namespace, task_dir: Path, _state: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    batch = controlled_file(getattr(args, "relations_batch", None), task_dir, "本地关系批次文件")
    assert batch is not None
    data = read_json(batch, "本地关系批次文件")
    reasons: list[str] = []
    new_root = (task_dir / "新建对象").resolve()
    if not isinstance(data, list):
        return ["relations_batch.json 必须是数组"], {}
    for item in data:
        if not isinstance(item, dict) or not isinstance(item.get("doc_path"), str) or not isinstance(item.get("relations"), list):
            reasons.append("关系批次每项必须包含 doc_path 和 relations")
            continue
        doc_path = resolved(item["doc_path"])
        if not is_within(doc_path, new_root) or not doc_path.is_file():
            reasons.append(f"关系源文档必须位于新建对象目录: {doc_path}")
        for relation in item["relations"]:
            if not isinstance(relation, dict):
                reasons.append("每条本地关系必须是对象")
                continue
            target = relation.get("target_doc_id")
            relation_type = relation.get("relation")
            resource_id = relation.get("kb_resource_id")
            if not isinstance(target, str) or not is_within(resolved(target), new_root) or not resolved(target).is_file():
                reasons.append("关系目标文档必须位于新建对象目录且存在")
            if relation_type not in {"part-of", "realizes", "maps-to", "evidenced-by", "supports", "depends-on", "reference"}:
                reasons.append("本地关系必须使用受支持的 relation 类型")
            if resource_id is not None:
                reasons.append("Step 4 本地关系的 kb_resource_id 必须为 null；真实 ID 仅由 Step 5 写入")
    return reasons, {"relations_batch": str(batch)}


def all_new_markdown(task_dir: Path) -> set[str]:
    root = task_dir / "新建对象"
    return {str(path.resolve()) for path in root.rglob("*.md")} if root.is_dir() else set()


def validate_step_five(args: argparse.Namespace, task_dir: Path, _state: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    report = controlled_file(getattr(args, "kb_relations_report", None), task_dir, "知识库关系报告")
    assert report is not None
    data = read_json(report, "知识库关系报告")
    if not isinstance(data, list):
        return ["kb-relations.json 必须是数组"], {}
    new_root = (task_dir / "新建对象").resolve()
    covered = {str(resolved(item.get("doc_path", ""))) for item in data if isinstance(item, dict) and item.get("doc_path")}
    missing = all_new_markdown(task_dir) - covered
    reasons = [f"知识库关系报告未覆盖文档: {path}" for path in sorted(missing)]
    for item in data:
        if not isinstance(item, dict) or not isinstance(item.get("clues"), list) or not isinstance(item.get("relations"), list):
            reasons.append("知识库关系报告每项必须包含 doc_path、clues、relations")
            continue
        doc_path = item.get("doc_path")
        if not isinstance(doc_path, str) or not is_within(resolved(doc_path), new_root):
            reasons.append("知识库关系报告中的 doc_path 必须位于新建对象目录")
            continue
        content = resolved(doc_path).read_text(encoding="utf-8")
        for relation in item["relations"]:
            target = relation.get("target_doc_id") if isinstance(relation, dict) else None
            if not isinstance(target, str) or target not in content:
                reasons.append(f"知识库关系未写入文档 related_docs: {doc_path}")
    return reasons, {"kb_relations_report": str(report)}


def parse_resolution_table(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    rows = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip().startswith("|")]
    if len(rows) < 2:
        return ["实体消解结果必须包含 Markdown 表格"], []
    headers = [part.strip() for part in rows[0].strip("|").split("|")]
    required = ["object_name", "result_status", "result_type", "current_source_path", "candidate_source_path", "output_path", "detail"]
    if headers != required:
        return ["实体消解结果表头必须与主流程规定的七列完全一致"], []
    parsed: list[dict[str, str]] = []
    for line in rows[2:]:
        values = [part.strip() for part in line.strip("|").split("|")]
        if len(values) == len(headers):
            parsed.append(dict(zip(headers, values)))
    return [], parsed


def validate_step_five_point_five(args: argparse.Namespace, task_dir: Path, state: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    result_file = controlled_file(getattr(args, "entity_resolution_results", None), task_dir, "实体消解结果表")
    assert result_file is not None
    reasons, rows = parse_resolution_table(result_file)
    selected_names = {item.get("object_name") for item in selected_objects(state)}
    roots = {key: (task_dir / value).resolve() for key, value in {"current_source_path": "新建对象", "candidate_source_path": "知识库候选", "output_path": "融合结果"}.items()}
    for row in rows:
        if row["object_name"] not in selected_names:
            reasons.append(f"实体消解结果包含范围外对象: {row['object_name']}")
        if row["result_status"] not in {"completed", "partial", "failed"} or row["result_type"] not in {"new", "fusion"}:
            reasons.append("实体消解结果包含不支持的状态或类型")
        current = resolved(row["current_source_path"])
        if not is_within(current, roots["current_source_path"]):
            reasons.append("current_source_path 必须位于新建对象目录")
        if row["result_type"] == "fusion":
            for key in ("candidate_source_path", "output_path"):
                value = row[key]
                if value in {"", "-"} or not is_within(resolved(value), roots[key]):
                    reasons.append(f"fusion 行的 {key} 必须位于指定目录")
            output = resolved(row["output_path"])
            if not output.is_file() or output.suffix.lower() != ".md":
                reasons.append(f"融合输出必须存在且为 Markdown: {output}")
            candidate = resolved(row["candidate_source_path"])
            if output.name != candidate.name:
                reasons.append("融合输出必须与知识库候选文档保持同名")
        elif row["candidate_source_path"] not in {"", "-"} or row["output_path"] not in {"", "-"}:
            reasons.append("new 行不得把知识库候选或融合结果作为入库输出")
    returned_names = {row["object_name"] for row in rows}
    for name in selected_names - returned_names:
        reasons.append(f"实体消解结果缺少所选对象: {name}")
    dispatch_file = result_file.parent / "subagent-dispatch.json"
    if not dispatch_file.is_file():
        reasons.append("缺少 Step 5.5 子 Agent 派发记录: subagent-dispatch.json")
    else:
        dispatch = read_json(dispatch_file, "子 Agent 派发记录")
        if not isinstance(dispatch, list):
            reasons.append("subagent-dispatch.json 必须是数组")
        else:
            dispatched_names = {
                item.get("object_name")
                for item in dispatch
                if isinstance(item, dict)
                and isinstance(item.get("object_name"), str)
                and isinstance(item.get("agent_id"), str)
                and item["agent_id"].strip()
                and item.get("result_status") in {"completed", "partial", "failed"}
            }
            for name in selected_names - dispatched_names:
                reasons.append(f"缺少所选对象的子 Agent 派发记录: {name}")
    return reasons, {"entity_resolution_results": str(result_file), "resolution_rows": rows}


def validate_step_six(args: argparse.Namespace, task_dir: Path, state: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    report_value = getattr(args, "preview_report", None) or state.get("preview_presented")
    report = controlled_file(report_value, task_dir, "预览报告")
    assert report is not None
    confirmation = (getattr(args, "confirmation", None) or "").strip()
    reasons = nonempty_file(report, "预览报告")
    if confirmation not in {"确认入库", "可以"}:
        reasons.append("Step 6 需要用户明确回复“确认入库”或“可以”")
    return reasons, {"preview_report": str(report), "confirmation": confirmation}


def expected_ingestions(state: dict[str, Any]) -> set[str]:
    expected: set[str] = set()
    for row in state.get("resolution_rows", []):
        if row.get("result_type") == "new":
            expected.add(str(resolved(row["current_source_path"])))
        elif row.get("result_type") == "fusion":
            expected.add(str(resolved(row["output_path"])))
    return expected


def validate_step_seven(args: argparse.Namespace, task_dir: Path, state: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    results_file = controlled_file(getattr(args, "ingestion_results", None), task_dir, "入库结果")
    assert results_file is not None
    data = read_json(results_file, "入库结果")
    if not isinstance(data, list):
        return ["ingestion-results.json 必须是数组"], {}
    actual = {str(resolved(item.get("source_path", ""))) for item in data if isinstance(item, dict) and item.get("source_path")}
    expected = expected_ingestions(state)
    reasons = [f"入库结果缺少预期文件: {path}" for path in sorted(expected - actual)]
    reasons.extend(f"入库结果包含非预期文件（知识库候选不得入库）: {path}" for path in sorted(actual - expected))
    for item in data:
        if (
            not isinstance(item, dict)
            or item.get("result") not in {"success", "failed"}
            or not isinstance(item.get("attempts"), int)
            or item["attempts"] < 1
            or not isinstance(item.get("detail"), str)
        ):
            reasons.append("每个入库结果必须包含 source_path、success/failed、正整数 attempts 和 detail")
    return reasons, {"ingestion_results": str(results_file), "ingestion_result_data": data}


def validate_step_eight(args: argparse.Namespace, task_dir: Path, _state: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    summary = controlled_file(getattr(args, "final_summary", None), task_dir, "最终汇总")
    assert summary is not None
    return nonempty_file(summary, "最终汇总"), {"final_summary": str(summary)}


VALIDATORS = {1: validate_step_one, 2: validate_step_two, 3: validate_step_three, 4: validate_step_four, 5: validate_step_five, 6: validate_step_five_point_five, 7: validate_step_six, 8: validate_step_seven, 9: validate_step_eight}
STEP_LABELS = {1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 5.5, 7: 6, 8: 7, 9: 8}


def command_init(args: argparse.Namespace) -> None:
    sources = [str(resolved(source)) for source in args.source]
    for source in sources:
        if not Path(source).exists():
            raise WorkflowError(f"source 不存在: {source}")
    task_dir = task_path(resolved(args.session_root), args.session_id, args.task_name)
    runner_dir = workflow_dir(task_dir)
    if state_path(task_dir).exists():
        raise WorkflowError(f"任务已初始化: {task_dir}")
    runner_dir.mkdir(parents=True, exist_ok=False)
    for directory in ("新建对象", "知识库候选", "融合结果"):
        (task_dir / directory).mkdir()
    state = {"version": 1, "session_id": args.session_id, "task_name": args.task_name, "sources": sources, "current_step": 1, "completed": {}, "terminal": None}
    save_state(task_dir, state)
    emit({"status": "ready", "task_dir": str(task_dir), "next_step": 1, "prompt": prompt(1)})


def command_current(args: argparse.Namespace) -> None:
    task_dir = resolved(args.task_dir)
    state = load_state(task_dir)
    if state.get("terminal"):
        emit({"status": state["terminal"]["status"], "reason": state["terminal"].get("reason", "任务已终止")}, 1)
    internal_step = int(state["current_step"])
    emit({"status": "ready", "task_dir": str(task_dir), "step": STEP_LABELS[internal_step], "prompt": prompt(internal_step)})


def command_complete(args: argparse.Namespace) -> None:
    task_dir = resolved(args.task_dir)
    state = load_state(task_dir)
    if state.get("terminal"):
        raise WorkflowError("任务已终止，不能继续 complete")
    internal_step = int(state["current_step"])
    if str(STEP_LABELS[internal_step]) != str(args.step):
        raise WorkflowError(f"当前步骤是 Step {STEP_LABELS[internal_step]}，不能完成 Step {args.step}")
    if internal_step == 7 and not state.get("preview_presented"):
        preview = controlled_file(getattr(args, "preview_report", None), task_dir, "预览报告")
        assert preview is not None
        reasons = nonempty_file(preview, "预览报告")
        if reasons:
            emit({"status": "incomplete", "step": 6, "reasons": reasons, "prompt": prompt(internal_step)}, 2)
        state["preview_presented"] = str(preview)
        save_state(task_dir, state)
        emit(
            {
                "status": "awaiting_confirmation",
                "step": 6,
                "message": "预览已记录，必须等待用户明确确认后才能推进。",
                "prompt": prompt(internal_step),
            }
        )
    reasons, evidence = VALIDATORS[internal_step](args, task_dir, state)
    if reasons:
        emit({"status": "incomplete", "step": STEP_LABELS[internal_step], "reasons": reasons, "prompt": prompt(internal_step)}, 2)
    state["completed"][str(STEP_LABELS[internal_step])] = evidence
    state.update(evidence)
    if internal_step == STEP_COUNT + 1:
        state["terminal"] = {"status": "complete"}
        save_state(task_dir, state)
        emit({"status": "complete", "step": 8, "message": "知识整理流程已完成。"})
    state["current_step"] = internal_step + 1
    save_state(task_dir, state)
    emit({"status": "complete", "step": STEP_LABELS[internal_step], "next_step": STEP_LABELS[internal_step + 1], "prompt": prompt(internal_step + 1)})


def command_failed(args: argparse.Namespace) -> None:
    task_dir = resolved(args.task_dir)
    state = load_state(task_dir)
    if state.get("terminal"):
        raise WorkflowError("任务已终止")
    internal_step = int(state["current_step"])
    if str(STEP_LABELS[internal_step]) != str(args.step):
        raise WorkflowError(f"当前步骤是 Step {STEP_LABELS[internal_step]}，不能标记 Step {args.step} 失败")
    reason = args.reason.strip()
    if not reason:
        raise WorkflowError("failed 必须提供失败原因")
    state["terminal"] = {"status": "failed", "step": STEP_LABELS[internal_step], "reason": reason}
    save_state(task_dir, state)
    emit({"status": "failed", "step": STEP_LABELS[internal_step], "reason": reason})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init")
    init.add_argument("--session-root", default="/by/.sessions")
    init.add_argument("--session-id", required=True)
    init.add_argument("--task-name", required=True)
    init.add_argument("--source", action="append", required=True)
    current = commands.add_parser("current")
    current.add_argument("--task-dir", required=True)
    complete = commands.add_parser("complete")
    complete.add_argument("--task-dir", required=True)
    complete.add_argument("--step", required=True)
    complete.add_argument("--report")
    complete.add_argument("--object-details-dir")
    complete.add_argument("--selection-file")
    complete.add_argument("--relations-batch")
    complete.add_argument("--kb-relations-report")
    complete.add_argument("--entity-resolution-results")
    complete.add_argument("--preview-report")
    complete.add_argument("--confirmation")
    complete.add_argument("--ingestion-results")
    complete.add_argument("--final-summary")
    failed = commands.add_parser("failed")
    failed.add_argument("--task-dir", required=True)
    failed.add_argument("--step", required=True)
    failed.add_argument("--reason", required=True)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    try:
        if args.command == "init":
            command_init(args)
        elif args.command == "current":
            command_current(args)
        elif args.command == "complete":
            command_complete(args)
        else:
            command_failed(args)
    except WorkflowError as exc:
        emit({"status": "error", "reason": str(exc)}, 1)


if __name__ == "__main__":
    main()
