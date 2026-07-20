#!/usr/bin/env python3
"""实体消解一站式脚本：批内去重 → 双路召回 → RRF融合 → identity比对+属性diff → 输出候选。

合并了 er_dedup_batch.py + er_search_kb.py + er_match.py 的功能。

用法:
    python3 er_resolve.py \
      --doc-dir /by/.sessions/{session_id}/{任务名称}/{object_type} \
      --object-type TechSpec \
      --identity-fields name \
      --output er_resolve_result.json

输出:
    {
      "doc_path": "...",
      "kb_resource_id": "10042822",
      "dedup": {"groups": [...], "singletons": [...]},
      "candidates": [
        {
          "kb_doc_path": "/TechSpec/04_...md",
          "name_match": {...},
          "property_diff": {...},
          "kb_front_matter": {...}
        }
      ]
    }
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import logging
import re
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

_FRONT_MATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)
DEFAULT_K = 60
DEFAULT_TOP_K = 10

# ============================================================
# KB 文件下载
# ============================================================


def download_candidate_files(
    candidates: list[dict[str, Any]],
    kb_resource_id: str,
    local_download_dir: Path,
) -> None:
    """下载 KB 候选文件到本地 session 目录（幂等：已存在则跳过）。

    每个 candidate 增加 "local_path" 字段（成功则为路径字符串，失败则为 None）。
    下载通过 _common.download_kb_file() 走服务发现 API。
    """
    if not candidates or not local_download_dir:
        return

    local_download_dir.mkdir(parents=True, exist_ok=True)

    for c in candidates:
        kb_path = c.get("kb_doc_path", "").strip("/")
        if not kb_path:
            c["local_path"] = None
            continue

        # 本地文件名：将 KB 路径的 / 替换为 _，避免目录嵌套
        kb_filename = kb_path.replace("/", "_")
        local_path = local_download_dir / kb_filename

        # 幂等：已存在则跳过
        if local_path.exists():
            c["local_path"] = str(local_path)
            continue

        try:
            _cm = _get_common()
            ok = _cm.download_kb_file(kb_resource_id, "/" + kb_path, str(local_path))
            if ok:
                c["local_path"] = str(local_path)
                logger.info("下载 KB 文件: %s → %s", kb_path, local_path)
            else:
                c["local_path"] = None
        except Exception as exc:
            logger.warning("下载异常 %s: %s", kb_path, exc)
            c["local_path"] = None

# ============================================================
# 公共工具
# ============================================================


def parse_front_matter(file_path: str) -> dict[str, Any]:
    """解析 Markdown 文件的 YAML front matter。"""
    try:
        text = Path(file_path).read_text(encoding="utf-8")
    except (OSError, FileNotFoundError):
        return {}
    m = _FRONT_MATTER_RE.search(text)
    if not m:
        return {}
    try:
        data = yaml.safe_load(m.group(1))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def levenshtein(a: str, b: str) -> int:
    """Levenshtein 编辑距离。"""
    if len(a) < len(b):
        return levenshtein(b, a)
    if len(b) == 0:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        cur = [i + 1]
        for j, cb in enumerate(b):
            cur.append(min(
                prev[j + 1] + 1,
                cur[j] + 1,
                prev[j] + (0 if ca == cb else 1),
            ))
        prev = cur
    return prev[-1]


def rrf_fuse(rank_lists: list[dict[str, float]], k: int = DEFAULT_K) -> dict[str, float]:
    """RRF 融合多路排名。"""
    all_docs: set[str] = set()
    for rl in rank_lists:
        all_docs.update(rl.keys())
    rrf: dict[str, float] = {}
    for doc_id in all_docs:
        score = 0.0
        for rl in rank_lists:
            if doc_id in rl:
                sorted_items = sorted(rl.items(), key=lambda x: -x[1])
                rank = next(i + 1 for i, (did, _) in enumerate(sorted_items) if did == doc_id)
                score += 1.0 / (k + rank)
        rrf[doc_id] = score
    return dict(sorted(rrf.items(), key=lambda x: -x[1]))


def identity_compare(
    new_identity: dict[str, Any],
    kb_fm: dict[str, Any],
    identity_field: str | None = None,
) -> dict[str, Any]:
    """比对 identity 字段值。"""
    if not identity_field and new_identity:
        identity_field = next(iter(new_identity))
    if not identity_field:
        return {"field": "", "new_value": "", "kb_value": "", "match": False, "match_type": "none"}

    new_str = str(new_identity.get(identity_field, "")).strip()
    kb_str = str(kb_fm.get(identity_field, "")).strip()

    if new_str and kb_str and new_str == kb_str:
        return {"field": identity_field, "new_value": new_str, "kb_value": kb_str, "match": True, "match_type": "exact"}
    if new_str and kb_str and (new_str in kb_str or kb_str in new_str):
        return {"field": identity_field, "new_value": new_str, "kb_value": kb_str, "match": True, "match_type": "substring"}
    if new_str and kb_str:
        dist = levenshtein(new_str, kb_str)
        if dist <= 2:
            return {"field": identity_field, "new_value": new_str, "kb_value": kb_str, "match": True, "match_type": "fuzzy", "edit_distance": dist}
    return {"field": identity_field, "new_value": new_str, "kb_value": kb_str, "match": False, "match_type": "none"}


def property_diff(new_fm: dict[str, Any], kb_fm: dict[str, Any]) -> dict[str, Any]:
    """计算属性差异。"""
    new_props: list[dict[str, Any]] = []
    shared: list[dict[str, Any]] = []
    conflict: list[dict[str, Any]] = []
    all_keys = set(new_fm.keys()) | set(kb_fm.keys())
    for key in sorted(all_keys):
        new_val = new_fm.get(key)
        kb_val = kb_fm.get(key)
        if new_val is not None and kb_val is None:
            new_props.append({"field": key, "value": new_val})
        elif new_val == kb_val:
            shared.append({"field": key, "value": new_val})
        elif new_val is not None and kb_val is not None:
            conflict.append({"field": key, "new_value": new_val, "kb_value": kb_val})
    return {"new": new_props, "shared": shared, "conflict": conflict}


# ============================================================
# Step 1: 批内去重 (原 er_dedup_batch.py)
# ============================================================

def extract_identity(fm: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    return {f: fm[f] for f in fields if f in fm}


def identity_key(values: dict[str, Any]) -> str:
    parts = [f"{k}={values[k]}" for k in sorted(values)]
    return "|".join(parts)


def merge_properties(main: dict[str, Any], patches: list[dict[str, Any]]) -> dict[str, Any]:
    merged: dict[str, Any] = dict(main)
    for fm in patches:
        for key, value in fm.items():
            if key not in merged:
                merged[key] = value
            elif merged[key] != value:
                existing = merged[key]
                if isinstance(existing, list):
                    for v in (value if isinstance(value, list) else [value]):
                        if v not in existing:
                            existing.append(v)
                else:
                    merged[key] = [existing, value]
    return merged


def dedup_batch(doc_dir: Path, identity_fields: list[str]) -> dict[str, Any]:
    """批内去重。"""
    md_files = sorted(doc_dir.rglob("*.md"))
    if not md_files:
        return {"groups": [], "singletons": []}

    docs: list[dict[str, Any]] = []
    for fp in md_files:
        fm = parse_front_matter(fp)
        ident = extract_identity(fm, identity_fields)
        docs.append({"path": str(fp), "front_matter": fm, "identity": ident, "key": identity_key(ident)})

    buckets: dict[str, list[dict[str, Any]]] = {}
    for doc in docs:
        if not doc["key"]:
            continue
        buckets.setdefault(doc["key"], []).append(doc)

    groups: list[dict[str, Any]] = []
    grouped: set[str] = set()
    for _key, members in buckets.items():
        if len(members) < 2:
            continue
        main = max(members, key=lambda d: len(d["front_matter"]))
        patches = [d for d in members if d["path"] != main["path"]]
        merged = merge_properties(main["front_matter"], [p["front_matter"] for p in patches])
        groups.append({"main_doc": main["path"], "patch_docs": [p["path"] for p in patches], "merged_properties": merged})
        grouped.add(main["path"])
        for p in patches:
            grouped.add(p["path"])

    singletons = [d["path"] for d in docs if d["path"] not in grouped]
    return {"groups": groups, "singletons": singletons}


# ============================================================
# Step 2: 双路召回
# ============================================================

_common = None


def _get_common():
    """延迟加载同目录的 _common 模块（单例）。"""
    global _common
    if _common is None:
        spec = importlib.util.spec_from_file_location(
            "_common",
            str(Path(__file__).resolve().parent / "_common.py"),
        )
        _common = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_common)
    return _common


def recall_via_term_search(
    keyword: str,
    term_type: str,
    top_k: int = DEFAULT_TOP_K,
) -> list[dict[str, Any]]:
    """Path-1: term 混合召回（BM25 + jieba + 向量 RRF 融合）——走服务发现。

    每个结果包含 kb_file_path、term_score、term_name，以及从 ext_attrs/labels 提取的
    kb_id 和 kb_resource_id。
    """
    _cm = _get_common()
    raw = _cm.post_rpc("term/search", {
        "params": {
            "keyword": keyword,
            "termType": term_type,
            "queryType": "mixed",
            "topK": top_k,
        }
    })
    items = raw if isinstance(raw, list) else raw.get("items", []) if isinstance(raw, dict) else []
    results: list[dict[str, Any]] = []
    for item in items:
        ext_attrs = item.get("ext_attrs", {}) or {}
        labels = item.get("labels", {}) or {}
        fp = ext_attrs.get("kb_file_path", "") or labels.get("kb_file_path", "")
        if fp:
            results.append({
                "kb_file_path": fp,
                "term_score": float(item.get("score") or 0),
                "term_name": item.get("term_name", ""),
                "kb_id": ext_attrs.get("kb_id") or labels.get("kb_id", ""),
                "kb_resource_id": ext_attrs.get("kb_resource_id") or ext_attrs.get("resource_id") or labels.get("kb_resource_id") or labels.get("resource_id", ""),
            })
    return results


def recall_via_search_file(
    kb_resource_id: str,
    query: str,
    top_k: int = 10,
) -> list[dict[str, Any]]:
    """Path-2: search-file 全文语义召回——走服务发现（BE_DOMAINNAME）。"""
    if not kb_resource_id or not query.strip():
        return []
    _cm = _get_common()
    try:
        raw = _cm.post_json(
            path="/byaiService/datasetController/knowledgeItems/searchFile",
            payload={
                "resourceIdList": [int(kb_resource_id)],
                "query": query[:200],
                "topK": top_k,
                "searchMode": "mixedRecall",
            },
        )
    except Exception as exc:
        logger.warning("search-file failed: %s", exc)
        return []

    # post_json 已解包 data 层，raw = {data: [...]} 或直接是 data 数组
    hits = []
    if isinstance(raw, dict):
        inner = raw.get("data", raw)
        if isinstance(inner, list):
            hits = inner
        elif isinstance(inner, dict):
            hits = inner.get("data", [])
    elif isinstance(raw, list):
        hits = raw
    if not isinstance(hits, list):
        return []

    results: list[dict[str, Any]] = []
    for h in hits:
        if not isinstance(h, dict):
            continue
        fp = h.get("filePath", h.get("file_path", ""))
        score = float(h.get("score", 0))
        if fp and score > 0:
            results.append({"kb_file_path": fp, "semantic_score": score})
    return results


def merge_recalls(
    term_results: list[dict[str, Any]],
    semantic_results: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """合并两路召回，按 kb_file_path 去重。"""
    merged: dict[str, dict[str, Any]] = {}
    for r in term_results:
        fp = r["kb_file_path"]
        merged[fp] = {
            "kb_file_path": fp,
            "term_score": r.get("term_score", 0),
            "semantic_score": 0,
            "kb_id": r.get("kb_id", ""),
            "kb_resource_id": r.get("kb_resource_id", ""),
        }
    for r in semantic_results:
        fp = r["kb_file_path"]
        if fp in merged:
            merged[fp]["semantic_score"] = r.get("semantic_score", 0)
        else:
            merged[fp] = {
                "kb_file_path": fp,
                "term_score": 0,
                "semantic_score": r.get("semantic_score", 0),
                "kb_id": r.get("kb_id", ""),
                "kb_resource_id": r.get("kb_resource_id", ""),
            }
    return list(merged.values())


def _extract_kb_resource_id(term_results: list[dict[str, Any]]) -> str:
    """从 term 召回结果中提取 kb_resource_id（合并去重，取第一个有效值）。

    注意：ext_attrs/labels 中的 kb_id 是本体库 ID（如 78），不是知识库 resourceId（如 10042822），
    二者不同，不能互相替代。优先取 kb_resource_id / resource_id 字段。
    """
    for r in term_results:
        rid = r.get("kb_resource_id", "")
        if rid:
            return str(rid)
    return ""


# ============================================================
# Step 3: RRF 融合 + identity比对 + 属性diff
# ============================================================

def build_candidates(
    recalls: list[dict[str, Any]],
    new_identity: dict[str, Any],
    new_fm: dict[str, Any],
    identity_fields: list[str],
    kb_resource_id: str,
) -> list[dict[str, Any]]:
    """基于双路召回构建候选列表，RRF 融合排序。

    输出候选信息供 Agent 判断，包括：
    - kb_doc_path / kb_resource_id（读文件用）
    - name_match（基于 term_name 的 identity 比对）
    - recall_sources（term / semantic / both，说明从哪路召回的）
    - doc_summary（新文档关键摘要，方便 Agent 快速了解上下文）
    """
    if not recalls:
        return []

    # RRF 融合（内部排序用）
    rank1: dict[str, float] = {}
    rank2: dict[str, float] = {}
    for r in recalls:
        fp = r["kb_file_path"]
        if r.get("term_score", 0) > 0:
            rank1[fp] = r["term_score"]
        if r.get("semantic_score", 0) > 0:
            rank2[fp] = r["semantic_score"]

    rank_lists = [rl for rl in [rank1, rank2] if rl]
    rrf_scores = rrf_fuse(rank_lists) if rank_lists else {}

    # identity 字段
    identity_field = None
    if identity_fields:
        for f in identity_fields:
            if f in new_identity:
                identity_field = f
                break
    if not identity_field and new_identity:
        identity_field = next(iter(new_identity))

    # 提取新文档摘要
    doc_summary = {}
    for def_key in ("tech_spec_definition", "ability_definition", "tech_component_definition",
                    "concept_definition", "definition", "feature_definition"):
        if def_key in new_fm and new_fm[def_key]:
            doc_summary["definition"] = str(new_fm[def_key]).strip()[:200]
            break
    doc_summary["name"] = str(new_identity.get(identity_field or "name", ""))
    doc_summary["object_type"] = new_fm.get("product_code", "")

    candidates: list[dict[str, Any]] = []
    for r in recalls:
        fp = r["kb_file_path"]
        kb_name = r.get("term_name", "")
        kb_fm_sim = {"name": kb_name} if kb_name else {}
        ident_result = identity_compare(new_identity, kb_fm_sim, identity_field) if kb_name else identity_compare(new_identity, {}, identity_field)

        # 召回来源标记
        sources = []
        if r.get("term_score", 0) > 0:
            sources.append("term")
        if r.get("semantic_score", 0) > 0:
            sources.append("semantic")
        source_label = "+".join(sources) if sources else "none"

        # 文件类型（从路径提取目录名，如 /TechSpec/ → TechSpec）
        path_parts = fp.strip("/").split("/")
        kb_object_type = path_parts[0] if len(path_parts) >= 2 else ""

        candidates.append({
            "kb_doc_path": fp,
            "kb_resource_id": kb_resource_id,
            "kb_term_name": kb_name,
            "kb_object_type": kb_object_type,
            "name_match": ident_result,
            "recall_source": source_label,
        })

    candidates.sort(key=lambda x: -rrf_scores.get(x["kb_doc_path"], 0.0))
    return candidates


# ============================================================
# 主流程
# ============================================================

def run(
    doc_dir: Path,
    object_type: str,
    identity_fields: list[str],
) -> dict[str, Any]:
    """一站式实体消解。

    kb_resource_id 从 term 召回结果自动提取。提取不到则仅做 term 召回，跳过 search-file 和下载。
    候选 KB 文件自动下载到 {doc_dir}/_kb_candidates/。
    """
    # Step 1: 批内去重
    dedup = dedup_batch(doc_dir, identity_fields)
    logger.info("Dedup: %d groups, %d singletons", len(dedup["groups"]), len(dedup["singletons"]))

    doc_paths = [g["main_doc"] for g in dedup["groups"]] + dedup["singletons"]

    results: dict[str, Any] = {}
    for doc_path in doc_paths:
        new_fm = parse_front_matter(doc_path)
        identity = extract_identity(new_fm, identity_fields)
        if not identity:
            logger.warning("No identity fields in %s", doc_path)
            results[doc_path] = {"doc_path": doc_path, "candidates": [], "dedup": dedup}
            continue

        keyword = str(list(identity.values())[0])

        # Step 2: 双路召回
        term_results = recall_via_term_search(keyword, object_type)
        logger.info("Path-1 term: %d hits", len(term_results))

        # 从 term 结果中自动提取 kb_resource_id
        kb_resource_id = _extract_kb_resource_id(term_results)
        logger.info("kb_resource_id: %s", kb_resource_id or "(none)")

        # 提取关键摘要做 search-file 检索词
        # 优先用对象的"一句话定义"字段 + 正文前几段
        summary_parts: list[str] = []
        # 定义类字段
        for def_key in ("tech_spec_definition", "ability_definition", "tech_component_definition",
                        "concept_definition", "definition", "feature_definition"):
            if def_key in new_fm and new_fm[def_key]:
                summary_parts.append(str(new_fm[def_key]).strip())
                break
        # 正文前 300 字符（跳过 front matter）
        try:
            text = Path(doc_path).read_text(encoding="utf-8")
            body_match = re.search(r"^---\s*\n.*?\n---\s*\n(.*)", text, re.DOTALL)
            if body_match:
                body = body_match.group(1).strip()
                # 去掉 markdown 标记，取前 300 字
                body_clean = re.sub(r"[#*>`\[\]|]", " ", body)
                body_clean = re.sub(r"\s+", " ", body_clean).strip()
                summary_parts.append(body_clean[:300])
        except Exception:
            pass
        search_query = " ".join(summary_parts)[:500]
        semantic_results = recall_via_search_file(kb_resource_id, search_query)
        logger.info("Path-2 semantic: %d hits (query len=%d)", len(semantic_results), len(search_query))

        # 过滤 search-file 结果：只保留与当前 object_type 同目录的文档
        semantic_results = [
            r for r in semantic_results
            if r["kb_file_path"].strip("/").startswith(object_type + "/")
        ]
        logger.info("Path-2 semantic (filtered by %s): %d hits", object_type, len(semantic_results))

        recalls = merge_recalls(term_results, semantic_results)
        logger.info("Merged recalls: %d unique", len(recalls))

        # Step 3: 构建候选列表
        candidates = build_candidates(recalls, identity, new_fm, identity_fields, kb_resource_id)

        # 下载 KB 候选文件到本地 session 目录
        if candidates and kb_resource_id:
            local_download_dir = doc_dir / "_kb_candidates"
            download_candidate_files(candidates, kb_resource_id, local_download_dir)

        results[doc_path] = {
            "doc_path": doc_path,
            "kb_resource_id": kb_resource_id,
            "object_type": object_type,
            "doc_summary": {
                "name": str(identity.get(identity_fields[0] if identity_fields else "name", "")),
                "definition": new_fm.get(
                    next((k for k in ("tech_spec_definition", "ability_definition", "tech_component_definition",
                                      "concept_definition", "definition", "feature_definition")
                          if new_fm.get(k)), ""), ""
                )[:200],
            },
            "dedup": dedup,
            "candidates": candidates,
        }

    return results


def format_results(results: dict[str, Any]) -> str:
    """将消解结果格式化为 Agent 友好的 Markdown 输出。"""
    lines: list[str] = []
    for doc_path, dr in results.items():
        doc_name = Path(doc_path).name
        ds = dr.get("doc_summary", {})
        dedup = dr.get("dedup", {})
        candidates = dr.get("candidates", [])

        lines.append("## 实例消解结果")
        lines.append("")
        lines.append("### 新文档")
        lines.append("")
        lines.append(f"- **名称**: `{ds.get('name', doc_name)}`")
        lines.append(f"- **路径**: `{doc_path}`")
        lines.append(f"- **对象类型**: `{dr.get('object_type', '')}`")
        lines.append(f"- **知识库**: `resource_id={dr.get('kb_resource_id', '')}`")
        defn = ds.get("definition", "")
        if defn:
            lines.append(f"- **定义摘要**: {defn}")
        lines.append("")

        # 去重信息
        groups = dedup.get("groups", [])
        singletons = dedup.get("singletons", [])
        if groups:
            lines.append("### 批内去重")
            lines.append("")
            for g in groups:
                main_name = Path(g.get("main_doc", "")).name
                patch_names = [Path(p).name for p in g.get("patch_docs", [])]
                lines.append(f"- 🔀 合并: `{main_name}` ← {', '.join(f'`{n}`' for n in patch_names)}")
            lines.append("")

        # 候选列表
        lines.append(f"### KB 候选文档（共 {len(candidates)} 条）")
        lines.append("")
        if not candidates:
            lines.append("*无候选。此文档将作为新建实例入库。*")
        else:
            # 先列出同名候选
            exact_matches = [c for c in candidates if c["name_match"]["match_type"] == "exact"]
            other_matches = [c for c in candidates if c["name_match"]["match_type"] != "exact"]

            if exact_matches:
                lines.append("#### 🔗 同名候选（高优先级）")
                lines.append("")
                for c in exact_matches:
                    nm = c["name_match"]
                    local = c.get("local_path", "")
                    lines.append(f"- **`{c['kb_doc_path']}`**")
                    lines.append(f"  - 名称匹配: `{nm['match_type']}` — new=`{nm.get('new_value','')}` kb=`{nm.get('kb_value','')}`")
                    lines.append(f"  - 召回来源: {c.get('recall_source', '')}")
                    if local:
                        lines.append(f"  - 本地副本: `{local}`")
                    else:
                        lines.append(f"  - 本地副本: ⚠️ 下载未成功，请用 `read-file` 在线读取")
                    lines.append(f"  - Agent 操作: 用 `read-file --resource-id {c['kb_resource_id']} --file-path {c['kb_doc_path']}` 读取内容，确认同义后按融合更新入库")
                    lines.append("")
                lines.append("")

            if other_matches:
                lines.append("#### 📋 语义候选")
                lines.append("")
                for c in other_matches[:10]:  # 最多显示前10条
                    nm = c["name_match"]
                    src = c.get("recall_source", "")
                    src_icon = {"term+semantic": "🟢", "semantic": "🟡", "term": "🔵"}.get(src, "⚪")
                    local = c.get("local_path", "")
                    lines.append(f"- {src_icon} **`{c['kb_doc_path']}`**")
                    lines.append(f"  - 名称匹配: `{nm['match_type']}` — new=`{nm.get('new_value','')[:40]}` kb=`{nm.get('kb_value','') or '(n/a)'}`")
                    lines.append(f"  - 召回来源: {src} | 候选类型: `{c.get('kb_object_type','')}`")
                    if local:
                        lines.append(f"  - 本地副本: `{local}`")
                    else:
                        lines.append(f"  - 本地副本: ⚠️ 下载未成功，请用 `read-file` 在线读取")
                    lines.append(f"  - Agent 操作: 若 {nm['match_type']}，先读内容确认是否同义；不同义则忽略此候选")
                    lines.append("")

                if len(other_matches) > 10:
                    lines.append(f"*...还有 {len(other_matches) - 10} 条候选未展示*")
                    lines.append("")

        lines.append("---")
        lines.append("")
        lines.append("**Agent 消解流程**:")
        lines.append("1. 同名候选 → 读内容确认同义 → 融合更新（Step 7 方式 B）")
        lines.append("2. 不同名但 key 语义候选 → 读内容判断 → 同义则询问用户 → 否则新建")
        lines.append("3. 无匹配 → 新建实例（Step 7 方式 A）")
        lines.append("")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="实体消解一站式脚本")
    parser.add_argument("--doc-dir", required=True, help="新文档目录")
    parser.add_argument("--object-type", required=True, help="本体对象类型")
    parser.add_argument("--identity-fields", required=True, help="identity 字段，逗号分隔")
    parser.add_argument("--output", default="", help="可选：同时输出 JSON 路径")
    parser.add_argument("--rich", action="store_true", default=True, help="输出 Agent 友好的 Markdown 格式（默认）")
    parser.add_argument("--json", action="store_true", help="仅输出 JSON")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    doc_dir = Path(args.doc_dir)
    if not doc_dir.is_dir():
        logger.error("doc-dir not found: %s", doc_dir)
        raise SystemExit(1)

    fields = [f.strip() for f in args.identity_fields.split(",") if f.strip()]
    if not fields:
        logger.error("identity-fields cannot be empty")
        raise SystemExit(1)

    result = run(doc_dir, args.object_type, fields)

    # JSON 输出
    if args.json or not args.rich:
        if not args.output:
            args.output = str(Path(args.doc_dir).parent / "er_resolve_result.json")
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("JSON → %s", out)

    # Rich 输出
    if args.rich and not args.json:
        rich_text = format_results(result)
        if args.output:
            rich_path = Path(args.output).with_suffix(".md")
            rich_path.write_text(rich_text, encoding="utf-8")
            logger.info("Rich → %s", rich_path)
        print(rich_text)

    # 同时输出 JSON + Rich
    if args.output and args.rich and args.json:
        rich_path = Path(args.output).with_suffix(".md")
        rich_path.write_text(rich_text, encoding="utf-8")
        logger.info("Rich → %s", rich_path)


if __name__ == "__main__":
    main()
