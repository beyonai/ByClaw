
update byai.po_users_organization set position_id =1 where  position_id not in(select position_id from byai.po_position);



delete from byai.byai_system_config where param_code in('SYSTEM_BACKEND_MENU_MANAGE');


INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (10000375, null, 'SYSTEM_BACKEND_MENU_MANAGE', '后台菜单管理', 'SYSTEM_BACKEND_MENU_MANAGE', '[
    {
        "menuCode": "menu_org",
        "menuNameEn": "Organization Structure",
        "menuNameCn": "组织结构管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 1,
        "path": "/manager/org/orgMgr"
    },
    {
        "menuCode": "menu_staff_post",
        "menuNameEn": "Employee Post",
        "menuNameCn": "员工岗位管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 2,
        "path": "/manager/org/postManage"
    },
    {
        "menuCode": "menu_role_permission",
        "menuNameEn": "Role Permission",
        "menuNameCn": "角色权限管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 3,
        "path": "/manager/org/permissionGroup"
    },
    {
        "menuCode": "menu_asset_catalog",
        "menuNameEn": "Asset Catalog",
        "menuNameCn": "资产目录管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 4,
        "path": "/manager/business/field"
    },
    {
        "menuCode": "menu_param_config",
        "menuNameEn": "Parameter Config",
        "menuNameCn": "参数配置管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 5,
        "path": "/manager/systemParams/system"
    },
    {
        "menuCode": "menu_model_config",
        "menuNameEn": "Model Config",
        "menuNameCn": "模型配置管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 6,
        "path": "/manager/systemParams/modal"
    },
    {
        "menuCode": "menu_sandbox_config",
        "menuNameEn": "Sandbox Config",
        "menuNameCn": "沙箱配置管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 7,
        "path": "/manager/systemParams/sandbox"
    }
]', '企业后台菜单管理');



delete from byai.byai_system_config where param_code in('DIG_EMPLOYEE_FILE_UPLOAD_CONFIG');


INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (10863540, 'text', 'DIG_EMPLOYEE_FILE_UPLOAD_CONFIG', '数字员工文件上传全局配置', 'DIG_EMPLOYEE_FILE_UPLOAD_CONFIG', '{
    "enabled": true,
    "allowedFileTypes": [".docx", ".doc", ".pdf", ".txt", ".md", ".xlsx", ".xls", ".csv", ".pptx", ".ppt", ".png", ".jpeg", ".jpg",".mp4", ".mov",".html", ".zip", ".gz", ".json", ".wav"],
    "maxFileSize": 100,
    "maxFileCount": 5
}', '数字员工文件上传全局配置');



delete from byai.byai_system_config where param_code in('TEMPLATE_DIGITAL_EMPLOYEE');


INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (10028461, 'text', 'TEMPLATE_DIGITAL_EMPLOYEE', '数字员工提示词模版', 'TEMPLATE_DIGITAL_EMPLOYEE', '[
  {
    "name": "个人助理",
    "key": "BYCLAW_ASSISTANT",
    "ownerType": "personal",
    "agentType": "001",
    "relTools": ["*"],
    "relSkills": ["dws"],
    "skillPath": "",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": ""
      },
      {
        "name": "人格定义",
        "key": "soul",
        "enName": "Personality Definition",
        "defaultValue": ""
      },
      {
        "name": "工具规范",
        "key": "tools",
        "enName": "Tool Specification",
        "defaultValue": ""
      },
      {
        "name": "记忆规范",
        "key": "memory",
        "enName": "Memory Specification",
        "defaultValue": ""
      }
    ]
  },
  {
    "name": "助手",
    "key": "BYCLAW_EXE",
    "ownerType": "enterprise",
    "agentType": "001",
    "relTools": ["*"],
    "relSkills": [],
    "skillPath": "",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": ""
      },
      {
        "name": "人格定义",
        "key": "soul",
        "enName": "",
        "defaultValue": ""
      },
      {
        "name": "工具规范",
        "key": "tools",
        "enName": "Tool Specification",
        "defaultValue": ""
      },
      {
        "name": "记忆规范",
        "key": "memory",
        "enName": "Memory Specification",
        "defaultValue": ""
      }
    ]
  },
  {
    "name": "问答",
    "key": "BYCLAW_QA",
    "ownerType": "enterprise",
    "agentType": "006",
    "relTools": [],
    "relSkills": [],
    "skillPath": "/.ByKC/{userCode}/agent_{resourceId}/skills",
    "prompts": [
      {
        "name": "问题分解",
        "key": "questionDecompose",
        "enName": "Question Decomposition",
        "defaultValue": "将用户的自然语言问题拆解为一个或多个独立的子查询，并标注每个子查询的推理跳数（hop count），用于后续并行调度检索。"
      },
      {
        "name": "单跳问题处理",
        "key": "singleHop",
        "enName": "Single Hop Processing",
        "defaultValue": "指导单跳检索代理通过多轮检索收集充分证据，生成有据可查且无引用标记的自然语言回答。"
      },
      {
        "name": "多跳问题信息检索",
        "key": "multiHopSearch",
        "enName": "Multi-hop Search",
        "defaultValue": "指导多跳检索代理逐跳推理、逐跳检索，通过调用 next_hop 或 finalize 链接各步结论，最终完成链式问答。"
      },
      {
        "name": "多跳问题回答",
        "key": "multiHopSummary",
        "enName": "Multi-hop Summary",
        "defaultValue": "将多跳推理代理的逐跳结果（子问题、证据、结论）合成为一份结构完整、证据可追溯的最终报告。"
      },
      {
        "name": "复合问题回答",
        "key": "subanswerAggregator",
        "enName": "Composite Answer Aggregation",
        "defaultValue": "将多个子查询的回答整合为一份逻辑连贯、无引用标记的 Markdown 格式综合回答，直接回应用户的原始问题。"
      }
    ]
  },
  {
    "name": "问数",
    "key": "BYCLAW_DATA",
    "ownerType": "enterprise",
    "agentType": "005",
    "relTools": [],
    "relSkills": [],
    "skillPath": "/.ByDC/{userCode}/agent_{resourceId}/skills",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": "请依据已有的工具进行数据查询、数据分析、数据操作。"
      }
    ]
  },
  {
    "name": "调试",
    "key": "BYCLAW_DEBUG",
    "ownerType": "enterprise",
    "agentType": "010",
    "relTools": [],
    "relSkills": [],
    "skillPath": "",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": ""
      }
    ]
  },
  {
    "name": "编码",
    "key": "BYCLAW_CODE",
    "ownerType": "enterprise",
    "agentType": "011",
    "relTools": [],
    "relSkills": [],
    "skillPath": "",
    "prompts": [
      {
        "name": "工作规范",
        "key": "agent",
        "enName": "Work Specification",
        "defaultValue": ""
      }
    ]
  }
]', '数字员工提示词模版');
