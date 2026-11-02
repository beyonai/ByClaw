#!/usr/bin/env python3
"""
授权用户使用 Skill

用法:
    skill_grant.py <skill-id> <user-id> <user-name>
    skill_grant.py 12345 789 "张三"
    skill_grant.py 12345 789 "张三" --org-id 456
"""

import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from byclaw_skill_api import ByClawSkillAPI, ByClawSkillAPIError


def main():
    if len(sys.argv) < 4:
        print("Usage: skill_grant.py <skill-id> <user-id> <user-name> [--org-id <id>]")
        print("\nExample:")
        print("  skill_grant.py 12345 789 '张三'")
        print("  skill_grant.py 12345 789 '张三' --org-id 456")
        sys.exit(1)

    skill_id = int(sys.argv[1])
    user_id = int(sys.argv[2])
    user_name = sys.argv[3]
    org_id = None

    # 解析可选参数
    if '--org-id' in sys.argv:
        idx = sys.argv.index('--org-id')
        if idx + 1 < len(sys.argv):
            org_id = int(sys.argv[idx + 1])

    try:
        api = ByClawSkillAPI()

        grant_users = [{
            'grantToObjId': user_id,
            'grantToObjType': 'USER',
            'grantToObjName': user_name,
            'grantType': 'FORCE_USE'
        }]

        print(f"授权用户 '{user_name}' (ID: {user_id}) 使用 Skill {skill_id}...")
        result = api.grant_skill_to_users(skill_id, grant_users=grant_users, org_id=org_id)

        result_data = result.get('data', {})
        updated = result_data.get('updatedMembers', 0)

        print(f"✅ 授权成功: {user_name} 可以使用 Skill {skill_id}")
        print(f"  更新成员数: {updated}")

    except ByClawSkillAPIError as e:
        print(f"❌ 授权失败: {e}", file=sys.stderr)
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
