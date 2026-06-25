"""code_api 配置：从 DATACLOUD_ONTOLOGY_PATH 派生索引路径。"""
from __future__ import annotations

import os
from pathlib import Path

ONTOLOGY_PATH = Path(os.environ["DATACLOUD_ONTOLOGY_PATH"])

# 服务模块名（固定，无需外部配置）
SERVICE_MODULE = "byclaw-data"

# 索引类型（默认 graphs）
INDEX_TYPE = os.getenv("CODE_INDEX_TYPE", "graphs")

# 最终索引路径：{DATACLOUD_ONTOLOGY_PATH}/code_indexes/byclaw-data/graphs/
INDEX_PATH = ONTOLOGY_PATH / "code_indexes" / SERVICE_MODULE / INDEX_TYPE
