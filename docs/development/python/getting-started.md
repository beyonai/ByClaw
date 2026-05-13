# Python 开发入门

本文档介绍 ByClaw Python 模块（byclaw-data / byclaw-qa / byclaw-exe）的开发规范。

## 模块概览

| 模块 | 用途 | 包管理 |
|------|------|--------|
| byclaw-data | 数据云服务（Agent 编排、数据查询） | uv |
| byclaw-qa | QA 管理服务（Agent 管理、知识库） | uv |
| byclaw-exe | 扩展插件和技能脚本 | pip（可选） |

## 环境准备

### 前置要求

- Python >= 3.12（byclaw-data / byclaw-qa）
- Python >= 3.10（byclaw-exe）
- [uv](https://docs.astral.sh/uv/)（推荐，用于 byclaw-data 和 byclaw-qa）

### 安装 uv

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# 或通过 pip
pip install uv
```

### 安装依赖

#### byclaw-data

```bash
cd byclaw-data
uv sync --frozen --dev
```

#### byclaw-qa

```bash
cd byclaw-qa
uv sync --group dev
```

#### byclaw-exe（如需本地开发）

```bash
cd byclaw-exe
pip install -e ".[dev]"  # 仅在 pyproject.toml 存在时
```

## 项目结构

### byclaw-data

```
byclaw-data/
├── src/
│   └── byclaw_data/
│       ├── __init__.py
│       ├── main.py           # 服务入口
│       ├── ...
├── tests/
├── pyproject.toml
├── uv.lock
└── README.md
```

### byclaw-qa

```
byclaw-qa/
├── src/
│   └── byclaw_qa/
│       ├── __init__.py
│       ├── ...
├── tests/
├── pyproject.toml
├── uv.lock
└── README.md
```

### byclaw-exe

```
byclaw-exe/
├── skills/                   # 技能定义
│   └── byai-sqlite/
├── extensions/               # 扩展插件
│   ├── baiying-enhance/
│   ├── byai-channel/
│   └── byclaw-sqlite/
├── install.sh
└── README.md
```

## 开发规范

### 代码风格

使用 [Ruff](https://docs.astral.sh/ruff/) 进行代码格式化和检查：

```bash
# 格式化
uv run ruff format .

# 检查
uv run ruff check .

# 自动修复
uv run ruff check . --fix
```

### 类型注解

```python
from typing import Optional
from pydantic import BaseModel

class Document(BaseModel):
    id: str
    title: str
    content: Optional[str] = None
    metadata: dict[str, any] = {}

async def process_document(doc: Document) -> list[str]:
    """处理文档并返回分块列表."""
    chunks: list[str] = []
    # 处理逻辑
    return chunks
```

## 常用命令

### byclaw-data

```bash
cd byclaw-data

# 安装依赖
uv sync --frozen --dev

# 代码检查
uv run ruff check .

# 格式化
uv run ruff format .

# 运行测试
uv run python -m pytest tests/ -v
```

### byclaw-qa

```bash
cd byclaw-qa

# 安装依赖
uv sync --group dev

# 代码检查
uv run ruff check .

# 运行测试
uv run python -m pytest tests/ -v
```

## CI 集成

CI 中各模块的检查方式：

```yaml
# byclaw-data
- uses: astral-sh/setup-uv@v5
- run: uv sync --frozen --dev
- run: uv run ruff check .

# byclaw-qa
- uses: astral-sh/setup-uv@v5
- run: uv sync --group dev
- run: uv run python -m pytest tests/ -v
```

## 测试

### 单元测试

```python
import pytest

@pytest.fixture
def sample_data():
    return {"key": "value"}

def test_process(sample_data):
    result = process(sample_data)
    assert result is not None
```

### 运行测试

```bash
# 运行所有测试
uv run python -m pytest tests/ -v

# 运行特定文件
uv run python -m pytest tests/test_specific.py -v

# 覆盖率报告
uv run python -m pytest --cov=src --cov-report=html
```

## 调试技巧

### 日志配置

```python
import logging

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)
```

### 使用 pdb

```python
def process_data(data):
    import pdb; pdb.set_trace()
    result = transform(data)
    return result
```

## 最佳实践

1. **使用类型注解** - 提高代码可读性和 IDE 支持
2. **异步编程** - IO 操作使用 `async`/`await`
3. **错误处理** - 使用异常而不是返回错误码
4. **配置管理** - 使用 Pydantic Settings 管理配置
5. **日志记录** - 关键操作记录日志
6. **使用 uv** - 比 pip 更快的依赖管理
