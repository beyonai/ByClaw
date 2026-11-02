#!/usr/bin/env python3
"""
发布 Skill 到 ByClaw（完整流程：打包 → 上传 → 预检 → 资源化）

用法:
    skill_publish.py <skill-dir> <resource-id>
    skill_publish.py ./my-skill 10000417
    skill_publish.py ./my-skill 10000417 --user-code user001
"""

import sys
import json
import os
from pathlib import Path

# 添加 scripts 目录到路径
sys.path.insert(0, str(Path(__file__).parent))

from skill_package import package_skill, SkillPackageError
from byclaw_skill_api import ByClawSkillAPI, ByClawSkillAPIError


def main():
    if len(sys.argv) < 3:
        print("Usage: skill_publish.py <skill-dir> <resource-id> [--user-code <code>]")
        print("\nExample:")
        print("  skill_publish.py ./my-skill 10000417")
        print("  skill_publish.py ./my-skill 10000417 --user-code user001")
        sys.exit(1)

    skill_dir = sys.argv[1]
    resource_id = int(sys.argv[2])
    user_code = None

    # 解析可选参数
    if '--user-code' in sys.argv:
        idx = sys.argv.index('--user-code')
        if idx + 1 < len(sys.argv):
            user_code = sys.argv[idx + 1]

    try:
        api = ByClawSkillAPI()

        # Step 1: 打包
        print(f"[1/4] 打包 Skill: {skill_dir}")
        zip_path, size_mb = package_skill(skill_dir)
        print(f"✅ 打包完成: {zip_path} ({size_mb:.2f} MB)")

        # Step 2: 上传
        print(f"[2/4] 上传到工作空间...")
        upload_result = api.upload_skill_zip(zip_path, resource_id, user_code)

        if not upload_result.get('data'):
            print(f"❌ 上传失败: 返回数据为空")
            sys.exit(1)

        skill_info = upload_result['data'][0] if isinstance(upload_result['data'], list) else upload_result['data']
        skill_path = skill_info.get('skillPath')
        skill_name = skill_info.get('skillName')

        if not skill_path:
            print(f"❌ 上传失败: 未返回 skillPath")
            print(json.dumps(upload_result, ensure_ascii=False, indent=2))
            sys.exit(1)

        print(f"✅ 上传完成: {skill_path}")

        # Step 3: 预检冲突
        print(f"[3/4] 检查冲突...")
        conflicts_result = api.check_resourceize_conflicts(skill_path, resource_id, user_code)
        conflicts_data = conflicts_result.get('data', {})

        updated_count = conflicts_data.get('updatedCount', 0)
        if updated_count > 0:
            print(f"⚠️  发现 {updated_count} 个同名技能冲突:")
            for item in conflicts_data.get('items', []):
                if item.get('updated'):
                    print(f"  - {item.get('resourceCode')}: {item.get('message')}")

            confirm = input("\n是否覆盖? (yes/no): ").strip().lower()
            if confirm != 'yes':
                print("❌ 发布取消")
                # 清理临时 ZIP
                if os.path.exists(zip_path):
                    os.remove(zip_path)
                sys.exit(0)
            overwrite = True
        else:
            overwrite = False
            print("✅ 无冲突")

        # Step 4: 资源化
        print(f"[4/4] 资源化...")
        result = api.resourceize_skill(skill_path, resource_id, user_code, overwrite)

        result_data = result.get('data', {})
        if result_data.get('success', 0) > 0:
            items = result_data.get('items', [])
            if items:
                skill_resource_id = items[0].get('resourceId')
                skill_code = items[0].get('resourceCode')
                print(f"✅ 发布成功!")
                print(f"  Skill ID: {skill_resource_id}")
                print(f"  Skill Code: {skill_code}")
                print(f"  Skill Name: {skill_name}")
            else:
                print("✅ 发布成功!")
        else:
            print(f"❌ 资源化失败")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            sys.exit(1)

        # 清理临时 ZIP
        if os.path.exists(zip_path):
            os.remove(zip_path)

    except SkillPackageError as e:
        print(f"❌ 打包失败: {e}", file=sys.stderr)
        sys.exit(1)
    except ByClawSkillAPIError as e:
        print(f"❌ API 调用失败: {e}", file=sys.stderr)
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
