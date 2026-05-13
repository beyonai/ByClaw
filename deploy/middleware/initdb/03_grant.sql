GRANT CREATE ON DATABASE postgres TO gaussdb;

-- 授权 gaussdb 用户访问 byai schema 下所有已创建的对象
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA byai TO gaussdb;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA byai TO gaussdb;
