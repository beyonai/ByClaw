-- V0.5.1 增量数据：将内置连接器命令迁移为 Runtime Manifest 驱动的二维命令组。
-- 已执行 V0.3.1 的环境不会重放历史种子，因此必须在新版本中显式收敛现有记录。

SET search_path TO byai;

UPDATE byai.byai_connector_info
SET auth_config = CASE connector_code
        WHEN 'dingtalk' THEN '{}'
        WHEN 'lark' THEN '{}'
        WHEN 'wecom' THEN '{"authorizationTimeoutSeconds":120}'
    END,
    runtime_manifest = CASE connector_code
        WHEN 'dingtalk' THEN '{"authStorage":{"environment":{"DWS_CONFIG_DIR":"/by/.connector-auth/.dws/config","DWS_DISABLE_KEYCHAIN":"1","DWS_HOME":"/by/.connector-auth/.dws"},"lock":"exclusive-per-instance","mode":"native-home","nativePath":"/by/.connector-auth/.dws","owner":"be-auth-job","runtimeMutation":"provider-refresh-only"},"id":"dingtalk","runtime":{"authorizeIn":"be-auth-job","commands":{"login":[["dws","auth","login","--device","--no-browser","--recommend","-y"]],"logout":[["dws","auth","reset","-y"]],"status":[["dws","auth","status","--format","json"]]},"type":"cli"},"schemaVersion":"1.0","skill":{"code":"dws","grantScope":"agent","installScope":"user","source":"system-builtin"},"version":"1.0.52"}'
        WHEN 'lark' THEN '{"authStorage":{"environment":{"LARK_HOME":"/by/.connector-auth/.lark-cli"},"lock":"exclusive-per-instance","mode":"native-home","nativePath":"/by/.connector-auth/.lark-cli","owner":"user-sandbox-auth-job","runtimeMutation":"sandbox-native"},"id":"lark","runtime":{"authorizeIn":"user-sandbox","commands":{"configCheck":[["lark-cli","config","show"]],"configInitialize":[["lark-cli","config","init","--new","--force-init"]],"contextBind":[["lark-cli","config","bind","--source","openclaw","--identity","user-default","--force"]],"login":[["lark-cli","auth","login","--domain","all","--no-wait","--json"],["lark-cli","auth","login","--device-code","${deviceCode}","--json"]],"logout":[["lark-cli","auth","logout","--json"]],"status":[["lark-cli","auth","status","--json","--verify"]]},"type":"cli"},"schemaVersion":"1.0","skill":{"code":"fws","grantScope":"agent","installScope":"user","source":"system-builtin"},"version":"1.0.84"}'
        WHEN 'wecom' THEN '{"authStorage":{"environment":{"WECOM_HOME":"/by/.connector-auth/.wecom-cli"},"lock":"exclusive-per-instance","mode":"native-home","nativePath":"/by/.connector-auth/.wecom-cli","owner":"be-auth-job","runtimeMutation":"provider-refresh-only"},"id":"wecom","runtime":{"authorizeIn":"be-auth-job","commands":{"login":[["wecom-cli","init","--noninteractive","--no-open"]],"logout":[["wecom-cli","cache","clear"]],"status":[["wecom-cli","cache","status"],["wecom-cli","contact","get_userlist","{}"]]},"type":"cli"},"schemaVersion":"1.0","skill":{"code":"wecomcli","grantScope":"agent","installScope":"user","source":"system-builtin"},"version":"0.1.9"}'
    END,
    update_time = CURRENT_TIMESTAMP
WHERE connector_code IN ('dingtalk', 'lark', 'wecom');
