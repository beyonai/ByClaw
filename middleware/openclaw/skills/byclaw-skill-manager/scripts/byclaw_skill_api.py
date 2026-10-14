#!/usr/bin/env python3
"""
ByClaw Skill 管理 API 封装（基于真实 /tool/* + /auth/* 接口）

真实接口来源:
- ToolManController: /tool/uploadSkillZip, /tool/resourceizeWorkspaceSkill 等
- AuthPrivilegeGrantController: /auth/privilegeGrant/setResourceUsers 等
"""

import os
import requests
from typing import Optional, List, Dict, Any
from byclaw_discovery import ByClawServiceDiscovery, ServiceDiscoveryError


class ByClawSkillAPIError(Exception):
    """Skill API 错误"""
    def __init__(self, code: str, message: str, response: dict = None):
        self.code = code
        self.message = message
        self.response = response
        super().__init__(f"[{code}] {message}")


class ByClawSkillAPI:
    """ByClaw Skill 管理 API 封装（基于真实 /tool/* 接口）"""

    def __init__(self, base_url: Optional[str] = None, token: Optional[str] = None,
                 service_name: str = ByClawServiceDiscovery.DEFAULT_SERVICE_NAME):
        """
        初始化 API 客户端

        Args:
            base_url: 可选，显式指定后端地址（跳过服务发现）
            token: Beyond-Token，默认从 BEYOND_TOKEN 环境变量读取
            service_name: 目标服务名，默认 "ByaiService"
        """
        self.token = token or os.getenv('BEYOND_TOKEN')
        if not self.token:
            raise ByClawSkillAPIError('AUTH_ERROR', 'BEYOND_TOKEN not set')

        if base_url:
            self.base_url = base_url
        else:
            try:
                discovery = ByClawServiceDiscovery()
                discovered_url = discovery.get_base_url(service_name)
                # 确保 base_url 包含 /byaiService 路径前缀
                # 服务注册中心返回的 path_prefix 应该已含此前缀，但作为防御性修复
                if '/byaiService' not in discovered_url:
                    self.base_url = discovered_url.rstrip('/') + '/byaiService'
                else:
                    self.base_url = discovered_url
            except ServiceDiscoveryError as e:
                raise ByClawSkillAPIError('SERVICE_DISCOVERY_FAILED', str(e))

        self.session = requests.Session()
        self.session.headers.update({
            'Beyond-Token': self.token
        })

    def _handle_response(self, response: requests.Response) -> dict:
        """统一响应处理"""
        try:
            data = response.json()
        except Exception:
            raise ByClawSkillAPIError(
                'INVALID_RESPONSE',
                f'Invalid JSON response: {response.text[:200]}'
            )

        # ByClaw 标准响应格式：{"code": "0", "msg": "...", "data": ...}
        if data.get('code') != '0' and data.get('code') != 0:
            raise ByClawSkillAPIError(
                data.get('code', 'UNKNOWN_ERROR'),
                data.get('msg', 'Unknown error'),
                data
            )

        return data

    # ===== 1. 上传 Skill 到工作空间 =====

    def upload_skill_zip(self, zip_path: str, resource_id: int = None,
                        user_code: str = None) -> dict:
        """
        上传 skill zip 到用户工作空间

        Args:
            zip_path: 本地 ZIP 文件路径
            resource_id: 数字员工 ID（超级助手可不传）
            user_code: 目标用户编码（可选，默认当前登录用户）

        Returns:
            {
                "code": "0",
                "data": [{
                    "skillName": "my-skill",
                    "skillPath": "/.openclaw/workspace-baiying-agent-10000417/skills/my-skill",
                    "uploadTime": "2026-08-24T10:00:00Z"
                }]
            }

        API: POST /tool/uploadSkillZip
        """
        url = f"{self.base_url}/tool/uploadSkillZip"

        with open(zip_path, 'rb') as f:
            files = {'file': (os.path.basename(zip_path), f, 'application/zip')}
            data = {}
            if resource_id is not None:
                data['resourceId'] = resource_id
            if user_code:
                data['userCode'] = user_code

            response = self.session.post(url, files=files, data=data, timeout=60)
            response.raise_for_status()
            return self._handle_response(response)

    # ===== 2. 查询技能列表 =====

    def list_workspace_skills(self, resource_id: int, user_code: str = None,
                              keyword: str = None) -> dict:
        """
        查询当前数字员工工作空间下未资源绑定的目录技能

        Args:
            resource_id: 数字员工 ID
            user_code: 用户编码（可选）
            keyword: 技能名称关键词（可选）

        Returns:
            {
                "code": "0",
                "data": [{
                    "skillName": "my-skill",
                    "skillPath": "/.openclaw/workspace-baiying-agent-10000417/skills/my-skill",
                    "sourceType": "user_dev"
                }]
            }

        API: POST /tool/qryWorkspaceSkillList
        """
        url = f"{self.base_url}/tool/qryWorkspaceSkillList"
        data = {'resourceId': resource_id}
        if user_code:
            data['userCode'] = user_code
        if keyword:
            data['keyword'] = keyword

        response = self.session.post(url, json=data, timeout=30)
        response.raise_for_status()
        return self._handle_response(response)

    # ===== 3. 资源化技能 =====

    def check_resourceize_conflicts(self, skill_path: str, resource_id: int,
                                   user_code: str = None) -> dict:
        """
        资源化前预检查是否会覆盖同名个人技能

        Args:
            skill_path: 工作空间技能路径
            resource_id: 数字员工 ID
            user_code: 用户编码（可选）

        Returns:
            {
                "code": "0",
                "data": {
                    "total": 1,
                    "updatedCount": 1,
                    "items": [{
                        "resourceCode": "my-skill",
                        "success": true,
                        "updated": true,
                        "message": "技能已存在，将会覆盖"
                    }]
                }
            }

        API: POST /tool/checkWorkspaceSkillShareConflicts
        """
        url = f"{self.base_url}/tool/checkWorkspaceSkillShareConflicts"
        data = {
            'skillPath': skill_path,
            'resourceId': resource_id
        }
        if user_code:
            data['userCode'] = user_code

        response = self.session.post(url, json=data, timeout=30)
        response.raise_for_status()
        return self._handle_response(response)

    def resourceize_skill(self, skill_path: str, resource_id: int,
                         user_code: str = None, overwrite_confirmed: bool = False) -> dict:
        """
        将工作空间技能资源化为个人技能并绑定到当前数字员工

        Args:
            skill_path: 工作空间技能路径
            resource_id: 数字员工 ID
            user_code: 用户编码（可选）
            overwrite_confirmed: 如果预检发现冲突，必须显式确认

        Returns:
            {
                "code": "0",
                "data": {
                    "total": 1,
                    "success": 1,
                    "items": [{
                        "resourceId": "12345",
                        "resourceCode": "my-skill",
                        "success": true,
                        "updated": false
                    }]
                }
            }

        API: POST /tool/resourceizeWorkspaceSkill
        """
        url = f"{self.base_url}/tool/resourceizeWorkspaceSkill"
        data = {
            'skillPath': skill_path,
            'resourceId': resource_id,
            'overwriteConfirmed': overwrite_confirmed
        }
        if user_code:
            data['userCode'] = user_code

        response = self.session.post(url, json=data, timeout=30)
        response.raise_for_status()
        return self._handle_response(response)

    # ===== 4. 查询技能使用情况 =====

    def get_skill_used_by(self, skill_id: int) -> dict:
        """
        查询正在使用某个技能的数字员工列表

        Args:
            skill_id: 技能资源 ID

        Returns:
            {
                "code": "0",
                "data": [{
                    "resourceId": 10000417,
                    "resourceName": "客服助手",
                    "useStartTime": "2026-08-01T10:00:00Z"
                }]
            }

        API: POST /tool/querySkillUsedDigitalEmployees
        """
        url = f"{self.base_url}/tool/querySkillUsedDigitalEmployees"
        data = {'resourceId': skill_id}

        response = self.session.post(url, json=data, timeout=30)
        response.raise_for_status()
        return self._handle_response(response)

    # ===== 5. 删除工作空间技能 =====

    def delete_workspace_skill(self, skill_path: str, resource_id: int,
                               user_code: str = None) -> dict:
        """
        删除用户工作空间下的单个 skill 目录

        Args:
            skill_path: 工作空间技能路径
            resource_id: 数字员工 ID
            user_code: 用户编码（可选）

        Returns:
            {
                "code": "0",
                "data": {
                    "skillName": "my-skill",
                    "skillPath": "/.openclaw/workspace-baiying-agent-10000417/skills/my-skill"
                }
            }

        API: POST /tool/deleteSkill
        """
        url = f"{self.base_url}/tool/deleteSkill"
        data = {
            'skillPath': skill_path,
            'resourceId': resource_id
        }
        if user_code:
            data['userCode'] = user_code

        response = self.session.post(url, json=data, timeout=30)
        response.raise_for_status()
        return self._handle_response(response)

    # ===== 6. 授权用户使用技能 =====

    def grant_skill_to_users(self, resource_id: int, grant_users: List[Dict] = None,
                            revoke_users: List[Dict] = None, org_id: int = None) -> dict:
        """
        授权/撤销用户使用技能（差异更新机制）

        Args:
            resource_id: 技能资源 ID（必须已资源化）
            grant_users: 授权用户列表
                [{"grantToObjId": 789, "grantToObjType": "USER", "grantToObjName": "张三"}]
            revoke_users: 撤销用户列表（同上结构）
            org_id: 组织 ID（可选，用于权限校验）

        Returns:
            {
                "code": "0",
                "msg": "授权成功",
                "data": {
                    "resourceId": 12345,
                    "updatedMembers": 2,
                    "revokedMembers": 1
                }
            }

        API: POST /auth/privilegeGrant/setResourceUsers

        注意:
        - 资源必须 publish_portal=1（发布到业务门户）
        - grantType 默认使用 FORCE_USE（强制使用）
        - 采用差异更新机制，自动新增/更新/移除
        """
        url = f"{self.base_url}/auth/privilegeGrant/setResourceUsers"
        data = {
            'resourceId': resource_id,
            'redList': grant_users or [],
            'blackList': revoke_users or []
        }
        if org_id:
            data['orgId'] = org_id

        # 为授权用户自动设置 grantType（如果未指定）
        for user in data['redList']:
            if 'grantType' not in user:
                user['grantType'] = 'FORCE_USE'

        response = self.session.post(url, json=data, timeout=30)
        response.raise_for_status()
        return self._handle_response(response)

    def query_skill_members(self, resource_id: int, page_no: int = 1,
                           page_size: int = 20) -> dict:
        """
        查询技能已授权的用户/组织/岗位列表

        Args:
            resource_id: 技能资源 ID
            page_no: 页码
            page_size: 每页数量

        Returns:
            {
                "code": "0",
                "data": {
                    "total": 10,
                    "list": [{
                        "grantToObjId": 789,
                        "grantToObjType": "USER",
                        "grantToObjName": "张三",
                        "grantType": "FORCE_USE",
                        "grantTime": "2026-08-24T10:00:00Z"
                    }]
                }
            }

        API: POST /auth/privilegeGrant/queryResourceMembers
        """
        url = f"{self.base_url}/auth/privilegeGrant/queryResourceMembers"
        data = {
            'resourceId': resource_id,
            'pageNo': page_no,
            'pageSize': page_size
        }

        response = self.session.post(url, json=data, timeout=30)
        response.raise_for_status()
        return self._handle_response(response)


if __name__ == '__main__':
    # 测试 API 初始化
    try:
        api = ByClawSkillAPI()
        print(f"✅ API 初始化成功，后端地址: {api.base_url}")
    except ByClawSkillAPIError as e:
        print(f"❌ API 初始化失败: {e}")
        exit(1)
