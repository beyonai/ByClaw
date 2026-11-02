#!/usr/bin/env python3
"""
撤销用户使用 Skill 的授权

用法:
    skill_revoke.py <skill-id> <user-id>
    skill_revoke.py 12345 789
"""

import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from byclaw_skill_api import ByClawSkillAPI, ByClawSkillAPIError


def main():
    if len(sys.argv) < 3:
        print("Usage: skill_revoke.py <skill-id> <user-id>")
        print("\nExample:")
        print("  skill_revoke.py 12345 789")
        sys.exit(1)

    skill_id = int(sys.argv[1])
    user_id = int(sys.argv[2])

    try:
        api = ByClawSkillAPI()

        revoke_users = [{
            'grantToObjId': user_id,
            'grantToObjType': 'USER'
        }]

        print(f"撤销用户 {user_id} 使用 Skill {skill_id} 的授权...")
        result = api.grant_skill_to_users(skill_id, revoke_users=revoke_users)

        result_data = result.get('data', {})
        revoked = result_data.get('revokedMembers', 0)

        print(f"✅ 撤销授权成功: 用户 {user_id} 不再能使用 Skill {skill_id}")
        print(f"  撤销成员数: {revoked}")

    except ByClawSkillAPIError as e:
        print(f"❌ 撤销授权失败: {e}", file=sys.stderr)
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
