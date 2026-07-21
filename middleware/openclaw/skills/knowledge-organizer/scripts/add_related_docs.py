#!/usr/bin/env python3
"""
向Markdown文档添加 related_docs 关系的脚本
确保写入格式和数据可靠性

用法:
    # 批量文档批量关系（推荐）
    python3 add_related_docs.py -b <batch_json_file>

    # 单个文档批量关系
    python3 add_related_docs.py <doc_path> -a <json_file>

    # 单个文档单个关系
    python3 add_related_docs.py <doc_path> <target_doc_id> <relation> <kb_resource_id>
"""

import sys
import os
import re
import json
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml module not installed. Run: pip install pyyaml")
    sys.exit(1)


RELATED_DOCS_START = "--- related_docs ---"
RELATED_DOCS_END = "--- related_docs ---"


def body_start_offset(content: str) -> int | None:
    """Return the first body offset, rejecting malformed YAML front matter.

    A related_docs block is a document footer, never front-matter metadata.  The
    explicit split also prevents a malformed front matter block from being
    silently rewritten as though it were a footer.
    """
    if not content.startswith("---\n"):
        return 0
    closing = re.search(r"^---\s*$", content[4:], re.MULTILINE)
    if closing is None:
        return None
    return 4 + closing.end()


def build_related_docs_block(doc_id: str, related_docs: list) -> str:
    """构建符合格式的 related_docs 块"""
    block_lines = [
        RELATED_DOCS_START,
        "",
        f"doc_id: {doc_id}",
        "related_docs:"
    ]
    
    for item in related_docs:
        block_lines.append(f"  - target_doc_id: {item['target_doc_id']}")
        block_lines.append(f"    relation: {item['relation']}")
        kb_resource_id = item.get('kb_resource_id')
        if kb_resource_id is None:
            block_lines.append("    kb_resource_id: null")
        else:
            block_lines.append(f"    kb_resource_id: \"{kb_resource_id}\"")
    
    block_lines.append("")
    block_lines.append(RELATED_DOCS_END)
    
    return "\n".join(block_lines)


def add_relations_to_doc(doc_path: str, relations: list) -> bool:
    """向单个文档添加多个关系"""
    if not os.path.exists(doc_path):
        print(f"ERROR: File not found: {doc_path}")
        return False
    
    with open(doc_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    body_start = body_start_offset(content)
    if body_start is None:
        print(f"ERROR: Unclosed YAML front matter in {doc_path}")
        return False

    # 只在正文中检查 related_docs 块，绝不触碰 YAML front matter。
    pattern = rf'{re.escape(RELATED_DOCS_START)}\n(.*?)\n{re.escape(RELATED_DOCS_END)}'
    match = re.search(pattern, content[body_start:], re.DOTALL)
    
    if match:
        # 已有块，解析并合并
        block_content = match.group(1).strip()
        if block_content:
            try:
                data = yaml.safe_load(block_content) or {}
            except yaml.YAMLError as e:
                print(f"ERROR: Failed to parse existing related_docs in {doc_path}: {e}")
                return False
        else:
            data = {}
        
        if 'related_docs' not in data:
            data['related_docs'] = []
        
        # 添加新关系（去重）
        existing_ids = {item.get('target_doc_id') for item in data['related_docs']}
        for item in relations:
            if item['target_doc_id'] not in existing_ids:
                data['related_docs'].append(item)
                existing_ids.add(item['target_doc_id'])
        
        # 重新构建块
        new_block = build_related_docs_block(data.get('doc_id', doc_path), data['related_docs'])
        absolute_start = body_start + match.start()
        absolute_end = body_start + match.end()
        new_content = content[:absolute_start] + new_block + content[absolute_end:]
    else:
        # 没有已有块，创建新块
        new_block = build_related_docs_block(doc_path, relations)
        new_content = content.rstrip() + "\n\n" + new_block
    
    # 写入文件
    with open(doc_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    return True


def batch_process(batch_file: str) -> bool:
    """批量处理多个文档"""
    if not os.path.exists(batch_file):
        print(f"ERROR: Batch file not found: {batch_file}")
        return False
    
    with open(batch_file, 'r', encoding='utf-8') as f:
        try:
            batch_data = json.load(f)
        except json.JSONDecodeError as e:
            print(f"ERROR: Invalid JSON: {e}")
            return False
    
    if not isinstance(batch_data, list):
        print("ERROR: JSON file must contain a list of document-relations pairs")
        return False
    
    success_count = 0
    error_count = 0
    
    for item in batch_data:
        if 'doc_path' not in item or 'relations' not in item:
            print(f"ERROR: Missing 'doc_path' or 'relations' in: {item}")
            error_count += 1
            continue
        
        if add_relations_to_doc(item['doc_path'], item['relations']):
            print(f"SUCCESS: {item['doc_path']} ({len(item['relations'])} relations)")
            success_count += 1
        else:
            error_count += 1
    
    print(f"\n=== Summary ===")
    print(f"Success: {success_count}")
    print(f"Errors: {error_count}")
    
    return error_count == 0


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    if sys.argv[1] == '-b' and len(sys.argv) == 3:
        # 批量处理模式
        success = batch_process(sys.argv[2])
        sys.exit(0 if success else 1)
    
    doc_path = sys.argv[1]
    
    if len(sys.argv) == 5:
        # 单个关系模式
        target_doc_id = sys.argv[2]
        relation = sys.argv[3]
        kb_resource_id = sys.argv[4]
        
        success = add_relations_to_doc(doc_path, [{
            'target_doc_id': target_doc_id,
            'relation': relation,
            'kb_resource_id': kb_resource_id
        }])
        if success:
            print(f"SUCCESS: Added relation to {doc_path}")
        sys.exit(0 if success else 1)
    
    elif len(sys.argv) == 4 and sys.argv[2] == '-a':
        # 批量添加模式
        relations_file = sys.argv[3]
        if not os.path.exists(relations_file):
            print(f"ERROR: Relations file not found: {relations_file}")
            sys.exit(1)
        
        with open(relations_file, 'r', encoding='utf-8') as f:
            try:
                relations = json.load(f)
            except json.JSONDecodeError as e:
                print(f"ERROR: Invalid JSON: {e}")
                sys.exit(1)
        
        if not isinstance(relations, list):
            print("ERROR: JSON file must contain a list of relations")
            sys.exit(1)
        
        success = add_relations_to_doc(doc_path, relations)
        if success:
            print(f"SUCCESS: Added {len(relations)} relations to {doc_path}")
        sys.exit(0 if success else 1)
    
    else:
        print("ERROR: Invalid arguments")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
