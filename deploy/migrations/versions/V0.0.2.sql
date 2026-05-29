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
    },
    {
        "menuCode": "menu_ui_agent",
        "menuNameEn": "UI Agent Skills",
        "menuNameCn": "界面技能管理",
        "menuUrl": "https://10.10.24.95:18082/skill-studio?uuid=a5wuyo&objectId=10000376&resourceCode=BYAI_DIG_EMPLOYEE_10000376&sessionId=&files=JTVCJTVE&language=zh-CN&session=main&token=${Beyond-token}",
        "menuDisplay": ["PLAT_MAN", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"],
        "menuDisplayName": ["平台管理", "组织管理", "业务管理", "平台运维"],
        "menuOrder": 8,
        "path": ""
    }
]', '企业后台菜单管理');

delete from byai.byai_system_config where param_code in('DIG_EMPLOYEE_FILE_UPLOAD_CONFIG');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (10863540, 'text', 'DIG_EMPLOYEE_FILE_UPLOAD_CONFIG', '数字员工文件上传全局配置', 'DIG_EMPLOYEE_FILE_UPLOAD_CONFIG', '{
    "enabled": true,
    "allowedFileTypes": [".docx", ".doc", ".pdf", ".txt", ".md", ".xlsx", ".xls", ".csv", ".pptx", ".ppt", ".png", ".jpeg", ".jpg",".mp4", ".mov",".html", ".zip", ".gz"],
    "maxFileSize": 100,
    "maxFileCount": 5
}', '数字员工文件上传全局配置');
