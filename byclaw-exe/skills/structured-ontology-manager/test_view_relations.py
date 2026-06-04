#!/usr/bin/env python3
"""服务器端测试脚本：验证视图 OWL 生成包含 _relations.owl 并上传成功。

运行方式：
    /tmp/ont_env/bin/python /by/.openclaw/workspace-baiying-agent-10002029/skills/structured-ontology-manager/test_view_relations.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, "/tmp/ont_env/lib/python3.12/site-packages")

from datacloud_knowledge.ingestion.owl_generate.generator import generate_from_definition
from datacloud_knowledge.ingestion.ontology_build import _pack_zip  # noqa: PLC2701

state = {
    "view_code": "pv_v_order_product_view_0027024630_f65fd2",
    "view_name": "订单产品视图",
    "view_desc": "通过产品编码关联订单与产品",
    "object_codes": ["p_order_0027024630_d73e14", "p_product_0027024630_55bb47"],
    "object_relations": [
        {
            "source_object_code": "p_order_0027024630_d73e14",
            "source_object_field_code": "product_code",
            "target_object_code": "p_product_0027024630_55bb47",
            "target_object_field_code": "product_code",
            "relation_name": "订单_关联_产品",
        }
    ],
    "fields": [
        {"property_code": "product_code", "property_name": "产品编码", "data_type": "STRING",
         "ext_property": {"property_role_rule": {"property_role": "DIMENSION", "rule_type": "name"}}},
        {"property_code": "order_code", "property_name": "订单编码", "data_type": "STRING",
         "ext_property": {"property_role_rule": {"property_role": "DIMENSION", "rule_type": "name"}}},
        {"property_code": "total_amount", "property_name": "总金额", "data_type": "DOUBLE",
         "ext_property": {"property_role_rule": {"property_role": "MEASURE", "rule_type": "amount"}}},
    ],
    "library_code": "PERSONAL_LIB",
    "domain_code": "PERSONAL_DOMAIN",
}

out = Path(tempfile.mkdtemp(prefix="test_view_rel_"))
print(f"\n[1] 生成 OWL -> {out}")
generate_from_definition(state, out)

print("\n[2] 生成的文件:")
for f in sorted(out.rglob("*.owl")):
    print(f"    {f.relative_to(out)}")

# 检查 _relations.owl 是否生成
rel_file = out / "view" / state["view_code"] / f"{state['view_code']}_relations.owl"
if rel_file.exists():
    print(f"\n[OK] _relations.owl 已生成 ({rel_file.stat().st_size} bytes)")
else:
    print("\n[FAIL] _relations.owl 未生成！")
    sys.exit(1)

# 打包
zip_path = out / f"{state['view_code']}.zip"
_pack_zip(out, zip_path)

print(f"\n[3] zip 内容 ({zip_path.stat().st_size} bytes):")
with zipfile.ZipFile(zip_path) as zf:
    for n in zf.namelist():
        print(f"    {n}")

if not any(n.endswith("_relations.owl") for n in zipfile.ZipFile(zip_path).namelist()):
    print("\n[FAIL] zip 里没有 _relations.owl！")
    sys.exit(1)

print("\n[OK] zip 包含 _relations.owl")

# 上传
token = os.environ.get("BEYOND_TOKEN", "")
if not token:
    print("\n[SKIP] BEYOND_TOKEN 未设置，跳过上传")
    sys.exit(0)

print("\n[4] 上传...")
import httpx  # noqa: E402
from datacloud_knowledge.ingestion.ontology_build import _import_view_zip  # noqa: PLC2701, E402

result = _import_view_zip(zip_path, token)
print(f"    结果: {result}")
if result.get("ok"):
    print("\n[OK] 上传成功！")
else:
    print(f"\n[FAIL] 上传失败: {result.get('error')}")
    sys.exit(1)
