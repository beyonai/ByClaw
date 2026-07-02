===deploy/migrations/versions/===
V0.0.1-alpha__baseline.sql[BSY3OL]: F:ByClaw全量基线SQL,初始化byai schema/扩展(ltree/pg_trgm/age)、全部业务表DDL(资源/会话/消息/沙箱/权限/组织/数字员工等)及种子数据(用户/组织/岗位/系统配置/OpenClaw内置skill与tool清单/Agent角色模板/沙箱服务规格/趋势查询SQL/资源目录/提示词) | R:middleware/initdb 01_init~04_dml.sql,ss_sandbox_record↔SandboxRecordMapper,query_config↔QueryConfigMapper,byai_system_config↔SystemConfigMapper | A:- | S:OpenGauss建库脚本,ss_resource含implType/workerAgentType资源路由约定,沙箱spec_json含MinIO卷挂载与env模板,statics查询用于管理后台图表,密码MD5加密,武侠测试账号
```
V0.0.1.sql[ESG8L]: F:沙箱记录表加乐观锁版本号与网关token字段,并更新openclaw沙箱服务规格JSON(镜像/端口/卷挂载/网关认证/插件/模型配置) | R:ss_sandbox_record表,sandbox_service_spec表 | A:- | S:ALTER ADD lock_version/gateway_token,spec_json含env与volumes三态BYCLAW_SANDBOX_FILE_VOLUME_ROOT,template_json配gateway token认证与byai-channel插件,OPENCLAW_GATEWAY_TOKEN占位符注入
V0.0.2.sql[ESG3M]: F:数据库迁移V0.0.2,初始化系统配置与数字员工模版 | R:byai_system_config,po_users_organization,po_position | A:- | S:修正用户岗位关联,初始化后台菜单管理/文件上传全局配置/数字员工提示词模版(个人助理/助手/问答/问数/调试/编码),含agentType与relSkills/skillPath定义
V0.0.3.sql[EKG5M]: F:迁移脚本-重置byai_system_config表中OPENCLAW_BUNDLED_SKILLS配置项,写入OpenClaw内置Skill清单元数据JSON | R:byai_system_config表 | A:- | S:DELETE+INSERT幂等替换,param_code=OPENCLAW_BUNDLED_SKILLS,text类型,内含50+技能(skillName/skillCode/中英描述),含dws钉钉/iwhalehub市场/coding-agent等
V0.1.0.sql[DEC5M]: F:生态采集(EC)模块建表迁移,9张bykc_ec表(采集Agent/连接/同步任务/运行/步骤/产物/信号/入库记录)及索引注释,并更新sandbox_service_spec的openclaw沙箱规格与模板JSON | R:byai_files,sandbox_service_spec | A:- | S:OpenGauss/byai schema,JSONB字段(site_sessions/credential_config/scope_config),Browser Bridge浏览器桥接,LOCAL/SERVER运行位置,信号置信度,文件三态minio/local/sftp,openclaw镜像端口8080/8082-filebrowser,base卷挂载/by
V0.2.0.sql[EC3EM]: F:个人中心个人邮箱账号表迁移建表,IMAP/SMTP配置与授权码密文存储 | R:po_user_mail_account | A:- | S:byai.po_user_mail_account,授权码仅存密文cipher+后四位last4,default_flag用户内唯一部分索引,user隔离索引,逻辑删除,国密加密预留

===deploy/config/===
logback.xml[GG5AM]: F:be日志框架配置,定义控制台/DEBUG/ERROR三类输出及异步滚动归档 | R:application.yml | A:- | S:springProperty取appName/port,按日期分目录滚动(20MB/7天/100MB上限),tar.gz归档,trace_id/span_id链路埋点,第三方框架降噪WARN/INFO,异步队列512

===deploy/middleware/===
docker-compose.windows.yml[G5SE1T]: F:Windows环境opensandbox容器编排覆盖,用命名管道替代Unix socket | R:opensandbox-server.toml | A:- | S:挂载docker_engine命名管道,只读挂载config.toml
docker-compose.yml[GSY5M]: F:中间件编排,定义redis/minio/opengauss/opensandbox四服务及网络 | R:opensandbox-server.toml,.env,initdb | A:- | S:redis:6379带密码,minio:9000/9001,opengauss:5432预载age图扩展+initdb初始化,沙箱:9005挂docker.sock与文件卷三态(minio-mount/bind),byclaw-network桥接,环境变量驱动镜像/端口/凭据

===deploy/middleware/initdb/===
01_init.sql[GSY1T]: F:初始化byai schema及ltree/pg_trgm/age扩展并授权gaussdb用户 | R:opengauss | A:- | S:CREATE SCHEMA byai,启用ltree/pg_trgm/age扩展,GRANT全表全序列权限及默认权限给gaussdb
02_ddl.sql[GCO5M]: F:byai模式完整建表DDL,定义全库表结构(资源/会话/消息/数字员工/权限组/沙箱/数据云脚本/组织用户/任务/知识术语等百余表)及序列索引约束注释 | R:01_schema.sql,03_dml.sql,be各Mapper/Entity | A:- | S:OpenGauss建库脚本,ss_resource资源中枢含implType/workerAgentType编排映射,ss_sandbox_record沙箱租约乐观锁,permission_groups三层授权,po_users多租户com_acct_id隔离,source/target_content资源JSON
03_grant.sql[GS5MT]: F:OpenGauss初始化时为gaussdb用户授予postgres库建库权及byai schema下所有表/序列的全部权限 | R:- | A:- | S:GRANT CREATE ON DATABASE,ALL PRIVILEGES ON ALL TABLES/SEQUENCES IN SCHEMA byai,数据源权限初始化
04_dml.sql[GSY3FS]: F:数据库初始化DML脚本,灌入系统种基础数据 | R:byai.po_users,byai_system_config,sandbox_service_spec,query_config | A:- | S:武侠人名测试用户/组织树/岗位/系统配置(沙箱开关/OpenClaw内置工具与技能清单/Agent角色模板/文件上传配置)/AI模型/趋势统计SQL模板/资源目录/数据源系统/数字员工提示词,MD5密码生成,nextval序列,多租户com_acct_id,V0.0.1沙箱spec升级

===deploy/migrations/===
merge_migrations.py[XSY3TL]: F:数据库迁移合并脚本,将versions增量SQL按DDL/DML分类追加到initdb文件并审计 | R:02_ddl.sql,04_dml.sql,.applied,psycopg2 | A:- | S:SQL语句分割器(引号/$$块/注释),关键字分类,版本追踪.applied,dry-run预览,四项审计(覆盖/语法/表结构/种子数据),argparse-CLI

===deploy/standalone/===
docker-compose.windows.yml[GSY1GT]: F:Windows单机部署override,移除/etc/localtime挂载并改用Windows路径卷映射 | R:docker-compose.standalone.yml,nginx-standalone.conf,.env | A:- | S:覆盖fe/be/qa/data/demo各服务volumes,沙箱文件卷与MinIO挂载用C:/ProgramData/byclaw默认路径,日志目录映射
docker-compose.yml[GS5M]: F:单机版全栈服务编排,定义fe/be/qa-manager/qa-worker/data/demo六服务及网络卷挂载 | R:.env,nginx-standalone.conf,logback.xml | A:- | S:fe暴露8080/8443,be暴露8086/8082,qa:8000,data:8087,demo:8999(profile),qa-worker无端口走Redis消费,沙箱文件卷BYCLAW_SANDBOX_FILE_VOLUME_ROOT与MinIO卷挂载,byclaw-network桥接网络,depends_on be,env_file统一注入

