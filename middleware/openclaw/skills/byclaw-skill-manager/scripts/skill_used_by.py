#!/usr/bin/env python3
"""
查询 Skill 被哪些数字员工使用

用法:
    skill_used_by.py <skill-id>
    skill_used_by.py 12345
"""

import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from byclaw_skill_api import ByClawSkillAPI, ByClawSkillAPIError


def main():
    if len(sys.argv) < 2:
        print("Usage: skill_used_by.py <skill-id>")
        print("\nExample:")
        print("  skill_used_by.py 12345")
        sys.exit(1)

    skill_id = int(sys.argv[1])

    try:
        api = ByClawSkillAPI()

        print(f"查询 Skill {skill_id} 的使用情况...")
        result = api.get_skill_used_by(skill_id)

        employees = result.get('data', [])

        if not employees:
            print(f"\n✅ Skill {skill_id} 未被任何数字员工使用")
            return

        print(f"\n✅ Skill {skill_id} 被以下数字员工使用 (共 {len(employees)} 个):")
        print(f"{'员工ID':<15} {'员工名称':<30} {'开始使用时间'}")
        print("-" * 75)

        for emp in employees:
            emp_id = emp.get('resourceId', 'N/A')
            emp_name = emp.get('resourceName', 'N/A')
            use_start = emp.get('useStartTime', 'N/A')

            print(f"{emp_id:<15} {emp_name:<30} {use_start}")

    except ByClawSkillAPIError as e:
        print(f"❌ 查询失败: {e}", file=sys.stderr)
        if e.response:
            print(f"响应: {json.dumps(e.response, ensure_ascii=False, indent=2)}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 未知错误: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
