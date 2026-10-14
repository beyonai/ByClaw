#!/usr/bin/env python3
"""
删除工作空间中的 Skill

用法:
    skill_delete.py <skill-path> <resource-id>
    skill_delete.py 'my-skill' 10000417
    skill_delete.py '/.openclaw/workspace-baiying-agent-10000417/skills/my-skill' 10000417
"""

import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from byclaw_skill_api import ByClawSkillAPI, ByClawSkillAPIError


def main():
    if len(sys.argv) < 3:
        print("Usage: skill_delete.py <skill-path> <resource-id>")
        print("\nExample:")
        print("  skill_delete.py 'my-skill' 10000417")
        print("  skill_delete.py '/.openclaw/workspace-baiying-agent-10000417/skills/my-skill' 10000417")
        sys.exit(1)

    skill_path = sys.argv[1]
    resource_id = int(sys.argv[2])
    user_code = None

    # 解析可选参数
    if '--user-code' in sys.argv:
        idx = sys.argv.index('--user-code')
        if idx + 1 < len(sys.argv):
            user_code = sys.argv[idx + 1]

    try:
        api = ByClawSkillAPI()

        # 确认删除
        print(f"⚠️  警告: 即将删除工作空间 Skill")
        print(f"  Skill Path: {skill_path}")
        print(f"  Resource ID: {resource_id}")
        confirm = input("\n确认删除? (yes/no): ").strip().lower()

        if confirm != 'yes':
            print("❌ 删除取消")
            sys.exit(0)

        print(f"\n删除 Skill...")
        result = api.delete_workspace_skill(skill_path, resource_id, user_code)

        result_data = result.get('data', {})
        deleted_skill_name = result_data.get('skillName', skill_path)
        deleted_skill_path = result_data.get('skillPath', skill_path)

        print(f"✅ 删除成功")
        print(f"  Skill Name: {deleted_skill_name}")
        print(f"  Skill Path: {deleted_skill_path}")

    except ByClawSkillAPIError as e:
        print(f"❌ 删除失败: {e}", file=sys.stderr)
        if e.response:
            print(f"响应: {json.dumps(e.response, ensure_ascii=False, indent=2)}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n❌ 用户取消")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 未知错误: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
