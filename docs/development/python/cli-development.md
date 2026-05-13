# CLI 开发指南

本文档介绍如何为 ByClaw 开发 CLI 工具和扩展。

## 扩展类型

ByClaw 支持以下类型的扩展：

| 类型 | 用途 | 位置 |
|------|------|------|
| Skills | AI 技能/工具 | `byclaw-exe/skills/` |
| Extensions | 功能扩展 | `byclaw-exe/extensions/` |

## Skill 开发

### Skill 结构

```
skills/
└── my-skill/
    ├── SKILL.md              # Skill 文档
    ├── config.yaml           # 配置文件
    ├── capabilities.json     # 能力定义
    ├── handler.py            # 处理器
    ├── executor.py           # 执行器
    └── requirements.txt      # 依赖
```

### 配置文件 (config.yaml)

```yaml
name: my-skill
version: 1.0.0
description: 我的自定义技能
author: your-name
type: tool  # tool / agent / workflow

# 配置参数
config:
  - name: api_key
    type: string
    required: true
    description: API 密钥
  - name: timeout
    type: number
    default: 30
    description: 超时时间(秒)

# 依赖
dependencies:
  - requests>=2.28.0
  - pydantic>=2.0.0
```

### 能力定义 (capabilities.json)

```json
{
  "capabilities": [
    {
      "name": "weather_query",
      "description": "查询指定城市的天气",
      "parameters": {
        "type": "object",
        "properties": {
          "city": {
            "type": "string",
            "description": "城市名称"
          },
          "date": {
            "type": "string",
            "description": "日期，格式 YYYY-MM-DD"
          }
        },
        "required": ["city"]
      }
    }
  ]
}
```

### 处理器 (handler.py)

```python
"""My Skill Handler."""

from typing import Any, Dict
import requests

class SkillHandler:
    """技能处理器."""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.api_key = config.get("api_key")
        self.timeout = config.get("timeout", 30)
    
    def weather_query(self, city: str, date: str = None) -> Dict[str, Any]:
        """查询天气.
        
        Args:
            city: 城市名称
            date: 日期
            
        Returns:
            天气信息
        """
        url = "https://api.weather.com/v1/current"
        params = {
            "city": city,
            "key": self.api_key
        }
        
        response = requests.get(url, params=params, timeout=self.timeout)
        response.raise_for_status()
        
        data = response.json()
        return {
            "city": city,
            "temperature": data["temp"],
            "condition": data["condition"],
            "humidity": data["humidity"]
        }
```

### 执行器 (executor.py)

```python
#!/usr/bin/env python3
"""Skill Executor."""

import sys
import json
import argparse

from handler import SkillHandler

def main():
    parser = argparse.ArgumentParser(description="My Skill Executor")
    parser.add_argument("--config", required=True, help="Config JSON string")
    parser.add_argument("--action", required=True, help="Action to execute")
    parser.add_argument("--params", default="{}", help="Parameters JSON string")
    
    args = parser.parse_args()
    
    # 解析配置
    config = json.loads(args.config)
    params = json.loads(args.params)
    
    # 创建处理器
    handler = SkillHandler(config)
    
    # 执行动作
    try:
        method = getattr(handler, args.action)
        result = method(**params)
        
        # 输出结果
        print(json.dumps({
            "success": True,
            "data": result
        }))
        
    except AttributeError:
        print(json.dumps({
            "success": False,
            "error": f"Unknown action: {args.action}"
        }))
        sys.exit(1)
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
```

## Extension 开发

### Extension 结构

```
extensions/
└── my-extension/
    ├── README.md             # 扩展文档
    ├── index.ts              # 扩展入口
    ├── src/                  # 源码
    │   ├── tool.ts           # 工具定义
    │   └── http.ts           # HTTP 服务
    └── package.json
```

### 扩展示例 (TypeScript)

```typescript
// index.ts
import { defineExtension } from '@byclaw/extension-sdk';
import { myTool } from './src/tool';

export default defineExtension({
  name: 'my-extension',
  version: '1.0.0',
  
  tools: [myTool],
  
  async onActivate(context) {
    console.log('Extension activated');
  },
  
  async onDeactivate() {
    console.log('Extension deactivated');
  }
});
```

```typescript
// src/tool.ts
import { defineTool } from '@byclaw/extension-sdk';

export const myTool = defineTool({
  name: 'my_tool',
  description: 'My custom tool',
  
  parameters: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Input data'
      }
    },
    required: ['input']
  },
  
  async execute({ input }) {
    // 处理逻辑
    return {
      result: `Processed: ${input}`
    };
  }
});
```

## 调试扩展

### 本地测试

```bash
# 测试 Skill
cd byclaw-exe/skills/my-skill
python executor.py \
  --config '{"api_key": "test"}' \
  --action weather_query \
  --params '{"city": "北京"}'
```

### 日志调试

```python
import logging

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

# 在代码中使用
logger.debug("Debug info")
logger.info("Processing...")
```

## 发布扩展

### 打包

```bash
# Python Skill
pip install build
python -m build

# TypeScript Extension
npm run build
npm pack
```

### 提交

1. Fork ByClaw 仓库
2. 在 `byclaw-exe/skills/` 或 `byclaw-exe/extensions/` 添加你的扩展
3. 提交 Pull Request
4. 等待审核合并

## 最佳实践

1. **错误处理** - 完善的异常处理和错误信息
2. **参数校验** - 使用 Pydantic 或 JSON Schema 校验输入
3. **超时控制** - 设置合理的超时时间
4. **资源清理** - 确保资源正确释放
5. **文档完善** - 提供清晰的使用文档
