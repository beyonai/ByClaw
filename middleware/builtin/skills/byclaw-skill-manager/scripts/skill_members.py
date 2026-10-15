#!/usr/bin/env python3
"""
查询 Skill 已授权的用户列表

用法:
    skill_members.py <skill-id>
    skill_members.py 12345
    skill_members.py 12345 --page 2 --size 50
"""

import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from byclaw_skill_api import ByClawSkillAPI, ByClawSkillAPIError


def main():
    if len(sys.argv) < 2:
        print("Usage: skill_members.py <skill-id> [--page <num>] [--size <num>]")
        print("\nExample:")
        print("  skill_members.py 12345")
        print("  skill_members.py 12345 --page 2 --size 50")
        sys.exit(1)

    skill_id = int(sys.argv[1])
    page_no = 1
    page_size = 20

    # 解析可选参数
    if '--page' in sys.argv:
        idx = sys.argv.index('--page')
        if idx + 1 < len(sys.argv):
            page_no = int(sys.argv[idx + 1])

    if '--size' in sys.argv:
        idx = sys.argv.index('--size')
        if idx + 1 < len(sys.argv):
            page_size = int(sys.argv[idx + 1])

    try:
        api = ByClawSkillAPI()

        print(f"查询 Skill {skill_id} 的授权成员列表...")
        result = api.query_skill_members(skill_id, page_no, page_size)

        result_data = result.get('data', {})
        total = result_data.get('total', 0)
        members = result_data.get('list', [])

        if total == 0:
            print(f"\nSkill {skill_id} 未授权给任何用户")
            return

        print(f"\nSkill {skill_id} 授权成员列表 (共 {total} 人，当前页 {page_no}):")
        print(f"{'ID':<12} {'类型':<8} {'姓名':<20} {'授权类型':<15} {'授权时间'}")
        print("-" * 85)

        for member in members:
            obj_id = member.get('grantToObjId', 'N/A')
            obj_type = member.get('grantToObjType', 'N/A')
            obj_name = member.get('grantToObjName', 'N/A')
            grant_type = member.get('grantType', 'N/A')
            grant_time = member.get('grantTime', 'N/A')

            print(f"{obj_id:<12} {obj_type:<8} {obj_name:<20} {grant_type:<15} {grant_time}")

        # 显示分页信息
        total_pages = (total + page_size - 1) // page_size
        if total_pages > 1:
            print(f"\n第 {page_no}/{total_pages} 页")
            if page_no < total_pages:
                print(f"下一页: skill_members.py {skill_id} --page {page_no + 1}")

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
