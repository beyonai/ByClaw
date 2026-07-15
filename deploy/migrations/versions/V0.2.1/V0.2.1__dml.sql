SET search_path TO byai;

INSERT INTO byai.po_storage_quota_setting
    (setting_id, default_quota_bytes, warning_percent, recycle_retention_days)
SELECT 1, 2147483648, 90, 7
WHERE NOT EXISTS (
    SELECT 1 FROM byai.po_storage_quota_setting WHERE setting_id = 1
);

UPDATE byai.byai_system_config
SET param_value = CASE
    WHEN btrim(param_value) = '[]' THEN '[
    {
        "menuCode": "menu_storage_quota",
        "menuNameEn": "Storage Quota",
        "menuNameCn": "存储配额管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN"],
        "menuDisplayName": ["平台管理"],
        "menuOrder": 8,
        "path": "/manager/storageQuota",
        "adminVipOnly": true
    }
]'
    ELSE substring(rtrim(param_value) FROM 1 FOR char_length(rtrim(param_value)) - 1) || ',
    {
        "menuCode": "menu_storage_quota",
        "menuNameEn": "Storage Quota",
        "menuNameCn": "存储配额管理",
        "menuUrl": "",
        "menuDisplay": ["PLAT_MAN"],
        "menuDisplayName": ["平台管理"],
        "menuOrder": 8,
        "path": "/manager/storageQuota",
        "adminVipOnly": true
    }
]'
END
WHERE param_code = 'SYSTEM_BACKEND_MENU_MANAGE'
  AND param_value NOT LIKE '%/manager/storageQuota%'
  AND rtrim(param_value) LIKE '%]';
