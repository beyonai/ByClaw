# AOCI - byclaw-be

===byclaw-be/config/===
logback.xml[GS3GM]: F:Logback日志框架配置,定义控制台/DEBUG/ERROR分级文件输出与异步落盘 | R:application.yml(spring.application.name,server.port) | A:- | S:springProperty注入appName/port,按日期大小滚动归档(20MB/7天/100MB上限),trace_id/span_id链路MDC,异步队列512,第三方框架降噪WARN/ERROR

===byclaw-be/===
Dockerfile[GGS5G]: F:be服务容器化构建,JRE21运行镜像 | R:app.jar,build-info.json | A:- | S:eclipse-temurin21-jre-alpine,非root用户appuser,构建信息注入build-info.json,EXPOSE8080,actuator健康检查,ENTRYPOINT启动jar
pom.xml[GYG3T]: F:byclaw-be单体Maven构建配置,聚合全部后端依赖与构建插件 | R:by-framework,spring-boot-3.5.14,spring-cloud-2025.0.2,spring-ai-bom-1.0.0,langchain4j,mcp-sdk-1.0.0 | A:- | S:Java21,SpringBoot3.5+Security6.5+Session+MyBatis-Plus+OpenFeign,OpenGauss/PostgreSQL/SQLite多数据源,Druid连接池,Jedis/spring-session-data-redis,MinIO+OSS存储,ES8检索,Kafka,jjwt+java-jwt+bcprov国密SM4,钉钉/JustAuth三方登录,POI/PDFBox/flexmark文档,resilience4j熔断,阿里云SMS,actuator+prometheus,阿里snapshot仓库,git-commit-id+mybatis-generator插件,finalName=ByaiServer-1.0

===byclaw-be/src/main/java/com/iwhalecloud/byai/===
ByaiServerApplication.java[XCO9GM]: F:SpringBoot主启动类,加载.env与外部properties配置,启用Feign/事务/异步/调度/WebSecurity/RedisSession/方法级权限 | R:byai.manager.mapper,gateway.sandbox.mapper | A:- | S:loadEnvFile逐级向上查找.env,resolveConfigPath自动发现config/application.properties,normalizeLoggingConfigForOs处理Windows路径,MapperScan双包,RedisHttpSession命名空间,自定义错误页401/404/500→error.jsp,允许循环引用与Bean覆盖

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/annotation/===
Add.java[DCO3VT]: F:参数校验分组标记接口(新增场景) | R:- | A:- | S:空接口,配合@Validated分组校验,标识新增操作校验组
ChatCallLimit.java[HCH7PT]: F:聊天调用次数限制注解,限制用户每日会话接口调用次数 | R:ChatCallLimitAspect | A:- | S:方法级注解,RUNTIME保留,value默认描述key,配合切面实现每日限流
Del.java[DSY1KT]: F:参数校验分组标记接口(删除场景) | R:- | A:- | S:空接口,配合@Validated分组校验
ManageLogAnnotation.java[HAU3T]: F:管理业务日志注解,标注类/方法功能名称与描述供审计 | R:- | A:- | S:运行时保留,作用于METHOD/TYPE,name/description属性
Mod.java[BCO3T]: F:参数校验分组标记接口 | R:- | A:- | S:空接口,@Validated分组校验占位
Query.java[UCO3T]: F:占位查询注解,空实现无成员 | R:- | A:- | S:空注解,无元注解无方法,疑似TODO待实现

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/config/===
CharacterEncodingConfig.java[GSY3T]: F:全局UTF-8字符编码过滤器配置 | R:- | A:- | S:CharacterEncodingFilter强制UTF-8,FilterRegistrationBean最高优先级order=0,匹配/*
FileUploadConfig.java[GFI3T]: F:Tomcat文件上传配置,放宽multipart分片数量上限 | R:- | A:- | S:TomcatServletWebServerFactory定制Connector,setMaxPartCount=5000
JacksonConfig.java[GSY5T]: F:全局Jackson ObjectMapper配置,统一JSON序列化与日期格式 | R:- | A:- | S:@Primary ObjectMapper,日期格式yyyy-MM-dd HH:mm:ss,LocalDateTime自定义序列化器,禁用时间戳,空串转空集合/null兼容FastJson
SignAntiReplayConfig.java[GCR3GS]: F:签名防重放安全校验配置(开关/超时/密钥/排除路径) | R:SignAntiReplayFilter | A:- | S:@ConfigurationProperties(byai.security.sign),@RefreshScope动态刷新,签名过期timeout默认5s,salt密钥,excludeUrlsStr逗号分隔懒加载解析为excludeUrlList
TransactionAdviceConfig.java[GDS7TM]: F:全局声明式事务配置,按方法名前缀匹配传播行为,代理所有*Service/*Dao/*Runner | R:DataSourceTransactionManager | A:- | S:cglib代理,select/get/query等只读NOT_SUPPORTED,旁路同步方法(记忆引擎/资源目录/生态采集)挂起防rollback-only,默认REQUIRED+READ_COMMITTED+300s超时,Exception全回滚

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/config/es/===
Elasticsearch8Operations.java[UES5BL]: F:ES8客户端操作实现(索引/批量/查询/CRUD/全文检索) | R:ElasticsearchOperations,ElasticsearchClient,BaseException | A:- | S:RestClientTransport+JacksonJsonpMapper构建客户端,认证超时配置,bulkIndex类型转换(BigDecimal/Timestamp),queryString全文检索,close释放连接
ElasticsearchOperationsFactory.java[USE5CM]: F:ES8操作实例工厂,多实例缓存管理,按连接参数MD5生成唯一key复用实例 | R:Elasticsearch8Operations,ElasticsearchOperations,BaseException,I18nUtil,StringUtil | A:- | S:双重检查锁单例,ConcurrentHashMap缓存,MD5生成cacheKey,close/closeAll连接释放,hosts脱敏日志,国际化降级中文兜底
ElasticsearchOperations.java[SES5BL]: F:Elasticsearch操作统一接口,定义文档增删改查与索引管理及全文检索 | R:ElasticsearchOperationsImpl | A:- | S:index/bulkIndex/getById/search/update/delete,索引CRUD,多索引fullSearch,Map泛型文档
EsConfig.java[GES5M]: F:ES连接配置项实体(版本/地址/认证) | R:- | A:- | S:Lombok-Data,username/password需MD5加密存储,普通POJO配置类

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/auth/===
GrantObjType.java[KPERM1T]: F:授权资源类型常量(智能体/文档库/数据库/问答/术语/工具/插件/目录/标签) | R:- | A:- | S:final工具类,私有构造,授权对象类型枚举字符串常量
GrantToObjType.java[KPER5M]: F:权限授予对象类型常量(人员/组织/岗位)
GrantType.java[KPER1PT]: F:授权管理类型常量,定义使用/管理/强制/归属/分享五种授权级别 | R:- | A:- | S:final工具类,私有构造,AVAILABLE_USE/ALLOW_MANAGE/FORCE_USE/OWNER/SHARE_USE,数字员工三层授权基础

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/chat/===
ChatObjType.java[KCH1T]: F:会话对象类型常量(人类/智能体/超级助手) | R:- | A:- | S:final工具类私有构造,HUMAN/AGENT/SUASS三类型常量
ConversationObjectType.java[KCH1T]: F:会话对象类型常量(超级助理/数字员工/通知) | R:- | A:- | S:final工具类,私有构造,Super/DigEmployee/Notification三常量

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/===
Constants.java[UK1KT]: F:全局公共常量池含状态码/Redis键前缀/资源类型/桶名/登录类型等 | R:- | A:- | S:final工具类,YES/NO值,STATUS_00A有效,SHARE_*Redis共享键,ResourceBizType内部类资源类型枚举,BUCKET_NAME_FEEDBACK/ICON桶名,ResponseStatus响应码

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/env/===
EnvConfigKey.java[KKS3T]: F:环境配置项键名常量定义 | R:- | A:- | S:byai/feign/dochain/reranker/langfuse/python配置key,final私有构造

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/errorcode/===
CommonErrorCode.java[KSY1T]: F:通用异常错误码常量定义 | R:- | A:- | S:参数校验/操作异常码,资源审核码,模型管理40001-50010码,final私有构造

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/events/===
OrganizationEventType.java[KOR1AT]: F:组织事件类型常量(增删改) | R:- | A:- | S:final工具类,私有构造,CREATE/UPDATE/DELETE字符串常量
ResourceCatalogEventType.java[KOBJ1S]: F:资源目录同步事件类型常量(增删改) | R:- | A:- | S:final工具类,私有构造,CREATE/UPDATE/DELETE对应catalogCreate/Update/Delete,kafka事件标识
ResourceEventType.java[KCO1T]: F:资源上下架事件类型常量定义
UsersEventType.java[KAUTH1T]: F:用户同步事件类型常量(新增/更新/删除)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/feign/knowledge/===
ApprovalStatus.java[KKN3T]: F:知识库审批状态常量(同意/拒绝)定义 | R:- | A:- | S:final工具类,私有构造,AGREE=0/REJECT=1
ApprovalType.java[KKN1T]: F:知识审批类型常量(上架/下架/订阅) | R:- | A:- | S:final工具类私有构造,字符串常量1/2/3

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/feign/===
Tag.java[KK1FT]: F:Feign文件标签规划常量,定义文件共享/属性标签前缀后缀及示例值 | R:- | A:- | S:用户US_/任务TA_/超级助理SS_/数字员工DI_/技能SK_/知识KG_/会话SE_/消息ME_前缀,联网NET_0/NET_1标签值

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/files/===
FileStatus.java[KFI1T]: F:文件状态常量(有效00A/无效00X)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/login/===
FilterType.java[KAUT1T]: F:登录拦截器类型常量(JWT/Session/密码令牌/AccessToken/SSO) | R:- | A:- | S:final工具类,私有构造,5种认证过滤器类型字符串常量
LoginAuthKey.java[KAU1T]: F:登录认证Redis键名与Hash字段常量(用户登录态、SSO/Beyond令牌、智能体授权字段)
LoginType.java[KAU1T]: F:用户登录类型常量(用户名/鲸加/钉钉/手机/SSO/CAS/飞连/Apple)
ShareSessionKey.java[KAT1JS]: F:共享会话Session字段Key常量(用户编码/共享用户/管理组织/组织岗位角色) | R:- | A:- | S:final私有构造,JWT/Session键名常量,SHARE_前缀

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/men/===
MenTaskStatusEnum.java[KTA3T]: F:长程任务状态枚举(已提交/进行中/待输入/完成/取消/失败/拒绝/待授权/未知) | R:- | A:- | S:code-desc双字段,fromName/fromCode/isValid查找,大小写归一化
PromptConstants.java[KKB3T]: F:任务文件校验提示词常量(中英文双语) | R:- | A:- | S:校验步骤描述文件是否存在于input_files/output_path,pass/fail结果,JSON返回格式
TaskOperateTypeEnum.java[AKK7T]: F:长程任务操作类型枚举(修改/执行/重跑/反馈)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/ontology/===
SourceType.java[KOBJ1T]: F:本体数据源类型常量(API/文档/DB表/通用库) | R:- | A:- | S:final工具类,私有构造,Integer常量1-4

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/queryconfig/===
QueryConfigCodeEnum.java[KEMP1T]: F:数字员工查询配置code编码枚举(使用/技术/评估/准确度指标) | R:- | A:- | S:枚举code/desc,isValid校验方法

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/resource/===
BatchStatus.java[KTA1T]: F:批处理任务状态枚举(失败/完成/运行中/待处理/混合) | R:- | A:- | S:code/desc双字段,isValid校验,getByCode反查
DigitalEmployType.java[KEMP3T]: F:数字员工类型枚举(助手/问数/问答/调试/编码型) | R:- | A:- | S:code-desc映射,isValid/getByCode/getSupportedTypes/supported校验方法
EvaluateTestSetType.java[KEMP1T]: F:数字员工测试集处理状态枚举(成功/处理中/失败) | R:- | A:- | S:code-desc映射,isValid校验,getByCode反查
EvaluateType.java[KEMP3T]: F:数字员工评估类型枚举(准确率/异常率/响应时长/规范度/匹配度) | R:- | A:- | S:code-desc双字段,isValid校验,getByCode查找
ImplType.java[KTO1T]: F:Worker调用实现方式枚举(ASK_AGENT/ASK_PERSONAL/API/SSE) | R:- | A:- | S:code/desc字段,isValid校验,getByCode查找,getSupportedTypes列举
OwnershipType.java[KP5T]: F:资源归属类型枚举(授权给我/我创建/我管理) | R:- | A:- | S:0=授权,1=创建,2=管理,isExist校验
OwnerType.java[KFP1MT]: F:资源归属类型常量(企业/个人/默认) | R:- | A:- | S:enterprise企业,personal个人,personal_default默认知识库与数字员工,多租户隔离维度
ResourceBizType.java[KCO1T]: F:资源业务类型枚举(数字员工/智能体/知识库/技能/工具/MCP/视图/对象等15种) | R:- | A:- | S:code+desc双字段,isValid校验,getByCode反查,getSupportedTypes列举,supportMyCreated判定
ResourceHostType.java[KKC1T]: F:资源托管类型枚举(远程/本地)
ResourceType.java[KCO1S]: F:资源类型常量(API/文档/数据库表/通用库) | R:- | A:- | S:final工具类私有构造,4个String常量定义知识与工具资源类型枚举
SystemCode.java[KSYS1T]: F:外系统编码枚举(百应/老智能体/博特/DIFY/钉钉/鲸加/其他) | R:- | A:- | S:code+desc双字段,isValid忽略大小写校验编码有效性
WorkerAgentType.java[KEMP1T]: F:Worker智能体类型枚举(exe/data/qa/code/debug/none) | R:- | A:- | S:code+desc双字段,isValid校验,getByCode查找,getSupportedTypes列举

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/searchask/===
SpaceDataType.java[KKN1T]: F:空间关联数据类型常量(归档请求/成果空间/资源/文件)
SpaceDirType.java[KKN1T]: F:空间目录类型常量(导入/联网/个人企业知识库/钉钉聊天/收藏夹) | R:- | A:- | S:final工具类私有构造,6个字符串常量,知识检索空间目录分类
WebCrawlStatusType.java[KKN1S]: F:文档抓取状态枚举常量 | R:- | A:- | S:成功A/失败X两态字符串常量

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/staticdata/===
RedisConfig.java[KSY1CT]: F:Redis缓存键常量定义(系统参数/模型配置/重放攻击签名) | R:- | A:- | S:静态参数单缓存与分组缓存键,AI模型配置与类型键,securitysign重放攻击前缀

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/superassist/===
SessionType.java[KCH1T]: F:会话类型常量(超级助手/问数/慧笔/鲸灵/数字员工)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/constants/users/===
IsLocked.java[KAU1T]: F:用户锁定状态常量(Y锁定/N未锁定) | R:- | A:- | S:final工具类,私有构造,YES/NO常量
OrgType.java[KORG1T]: F:组织类型常量(内部/外部组织)
SourceType.java[KAUTH1T]: F:外系统用户来源类型常量(本系统/钉钉/企业微信) | R:- | A:- | S:final工具类,LOCAL=0/DING_TALK=1/WE_CHAT=2
UserState.java[KAUTH1T]: F:用户状态常量(正常A/禁用X)
UserType.java[KAUTH1T]: F:用户角色类型常量定义 | R:- | A:- | S:普通用户/组织管理/平台管理/平台运维/业务管理五类角色字符串常量,私有构造防实例化

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/datasource/config/===
AbstractDruidConfiguration.java[GDS5EM]: F:Druid数据源抽象配置基类,构建连接池/JNDI数据源并注册WallFilter防注入 | R:AbstractDruidProperties.java,RsaDecrypt.java | A:- | S:支持jndi/druid双类型,RSA密码解密,opengauss适配postgresql+PGValidConnectionChecker,WallConfig允许多语句,连接池保活与校验参数注入
CustomerContextHolder.java[USB5CT]: F:多数据源路由上下文持有器,基于TTL线程本地变量存储当前数据源类型 | R:TransmittableThreadLocal | A:- | S:TTL跨线程传递,数据源常量(Byai/System/Phoenix/Mysql/Oracle/Postgresql),get/set/clear静态方法
DataSourceConfig.java[GDS5TT]: F:多数据源与事务管理器配置 | R:MultipleDataSource.java,CustomerContextHolder.java | A:- | S:注册multipleDataSource路由数据源,默认byai源,DataSourceTransactionManager事务管理
MultipleDataSource.java[GDS5MT]: F:多数据源路由,基于上下文动态选择数据源 | R:CustomerContextHolder.java,AbstractRoutingDataSource | A:- | S:继承AbstractRoutingDataSource,determineCurrentLookupKey返回当前线程数据源标识

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/datasource/interceptor/===
DataSourceMethodInterceptor.java[HDS5S]: F:AOP切面按类名/方法名前缀(Byai/BDP/Phoenix)动态切换数据源并在Controller执行后清理上下文 | R:CustomerContextHolder | A:- | S:@Aspect+@Before切service/dao层setCustomerType,@After切Controller清理,getOrder=-1最高优先级,ClassUtils判代理取声明类名

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/datasource/properties/===
AbstractDruidProperties.java[GDS5M]: F:Druid数据源连接池配置属性抽象基类,定义连接池容量/超时/保活/防注入wall过滤器/登录认证等参数 | R:- | A:- | S:initialSize/minIdle/maxActive连接池参数,testWhileIdle保活检测,filters=mergeStat/config/wall,keepAlive保活间隔,encrypt密码加密开关,getter/setter全字段

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/ecrypt/===
AesUtils.java[UCRY5EM]: F:AES加解密工具,支持CBC与ECB模式及身份证专用加解密 | R:- | A:- | S:CBC固定IV+PKCS5Padding,十六进制串与byte互转,encryptIdCard/decryptIdCard用ECB+Base64,内置AES_KEY密钥常量
Base64Util.java[UCR5EM]: F:Base64编解码工具,字符串与字节数组互转 | R:BaseException | A:- | S:自实现legalChars码表,encode三字节分组补=,decode逐字符解码,UTF-8编码,异常抛BaseException(500)
MD5Util.java[UCRY3ET]: F:MD5加密工具,生成32位/16位小写摘要 | R:commons-codec:DigestUtils | A:- | S:md5Hex全量摘要,md5Hex16截取8-24位
MD5Utils.java[UCR5ET]: F:MD5加盐加密工具 | R:- | A:- | S:固定盐值SALT,encrypt双重载,DigestUtils.md5Hex加密oriCode+"{salt}"
RsaDecrypt.java[UCR5EM]: F:RSA私钥解密工具,用于统一认证Token解密 | R:BaseException,Constants | A:- | S:内置模数/私钥指数硬编码,RSA/PKCS1Padding默认补位,ASCII转BCD,按模长分组解密,解密失败抛BaseException
RsaEncrypt.java[UCR5ES]: F:RSA公钥加密工具,使用固定模和指数生成公钥对明文加密 | R:- | A:- | S:PKCS1Padding补位,模长-11分组加密,BCD转十六进制字符串输出,内置公钥模数65537
Sm4Util.java[UUE5EM]: F:国密SM4分组加密工具,ECB/PKCS5Padding模式加解密,前端密码参数加解密 | R:Base64Util,BaseException,BouncyCastleProvider | A:- | S:静态注册BC Provider,默认32位16进制密钥,encryptToForeEnd配Base64给前端,decryptFromForeEnd解前端密码,Hex编码,异常封装BaseException(500)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/exception/===
BaseException.java[HCO3S]: F:基础运行时异常,封装错误码与国际化错误信息 | R:CommonErrorCode.java,I18nUtil.java | A:- | S:继承RuntimeException,errorCode默认50500,getMessage走I18nUtil国际化转换,多构造支持错误码/cause
ByAiArgumentException.java[HCO5VT]: F:参数校验自定义异常,封装错误码与错误信息 | R:BaseException,CommonErrorCode | A:- | S:继承BaseException,默认错误码50400,支持自定义码与异常栈

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/client/===
FeignAiWriterService.java[FF7FT]: F:慧笔服务Feign客户端,封装文稿/PPT导出接口 | R:FeignAiWriterRequestInterceptor | A:/aiwrite-web/aiPptDoc/htmlToPpt,/aiwrite-web/aiDoc/exportDoc | S:exportPpt/exportDoc返回文件流Response,topCont/svcCont请求体,配置化name/url/path
FeignDataCloudService.java[FF7FM]: F:数据云Feign客户端,封装terms/options检索请求,服务发现直连+JWT租户鉴权 | R:DiscoveryHttpClient,JwtService,CurrentUserHolder,RedisClient,TermsOptionsReq,DataCloudResponse,TermsOptionsResp via redis:DiscoveryClient | A:POST /api/v1/datacloud/terms/options | S:DiscoveryHttpClient服务发现,RetryConfig重试502/503/504三次,Beyond-Token+System-Code注入,网关超时300s,FastJSON泛型解析
FeignDocChainService.java[FK5FT]: F:DocChain联网搜索Feign客户端 | R:FeignDocChainRequestInterceptor | A:POST /v1/search | S:OpenFeign声明式调用,配置化name/url/path,入参出参Map,JSON UTF-8
FeignPythonBuildService.java[FKF7FL]: F:调用Python知识构建服务的Feign客户端,封装知识库/目录/文件CRUD及构建索引,支持服务发现与第三方直连双模式 | R:KnowledgeServiceEndpointResolver,KnowledgeServicePathResolver,DiscoveryHttpClient,OkHttpUtil,JwtService,CurrentUserHolder,RedisClient,PythonBuildResponse via redis:服务发现 | A:- | S:Redis服务发现路由,knCode反射提取路由,JWT/Beyond-Token鉴权,multipart上传/文件流下载,Void响应特殊解析,502/503/504重试,300s超时
FeignPythonToolService.java[FEM7FM]: F:调用Python工具服务的Feign客户端,数字员工审核/重复检查/一键生成、评测框架Excel上传下载与批次进度查询 | R:FeignPythonRequestInterceptor,PythonToolResponse,EmployeeAudit,DigitalEmployeeDuplicateCheckRequest,DigEmployeeGenerate,BatchProgressResponse,via qa | A:/bePyTc/v2/digitalEmployeeAudit,/v2/digitalEmployeeDuplicateCheck,/v2/agent-prompt/generate,/cache/clear,/test_framework/upload,/test_framework/jobs/{batch_id}/report,/test_framework/jobs/{batch_id}/progress | S:FeignClient配置化name/url/path,JSON与multipart混合,byte[]报告下载,objectId缓存清理
FeignWhaleAgentService.java[FF4FST]: F:WhaleAgent沙箱Feign客户端,封装沙箱生命周期与文件操作远程调用 | R:whale-agent via feign, FeignWhaleAgentRequestInterceptor, SandboxDetail, KnowledgeResponse | A:/sandboxExternal/{launchSandbox,destroySandbox,renewSandboxTimeout,getSandboxInfo,listSandboxes,uploadFile,downloadFile,listFiles,existsFile,deleteFile} | S:沙箱创建/销毁/续期/查询/分页,文件上传下载列举存在删除,multipart上传,三态存储兼容
KnowledgeServiceEndpoint.java[DKO5FT]: F:知识库服务端点定义对象,承载请求路由结果(服务发现serviceName或第三方直连domainURL) | R:- | A:- | S:不可变值对象,forDiscovery/forDirectUrl静态工厂,directUrl标志区分服务发现与第三方直连
KnowledgeServiceEndpointResolver.java[SKN5FM]: F:知识库服务端点解析,按dataset.system与knCode判定走百应自有服务发现或第三方直连URL | R:SsResourceService,SsResExtDocService,SsResource,SsResExtDoc,KnowledgeServiceEndpoint | A:- | S:datasetSystem空走discovery取domainName否则qADomainName,非空按knCode查资源解析targetContent的domainURL,编码重复抛异常,JSON.parseObject提取domainURL/domainName,查不到回退服务发现
KnowledgeServiceOperation.java[KKN1KS]: F:知识库服务标准动作枚举,统一维护operationId与百应自有知识库固定path | R:KnowledgeServiceClient | A:- | S:12个动作(建库/删库/改库/建目录/改目录/列目录/删目录/上传/删文件/知识构建/下载/构建状态),第三方按operationId匹配openapiSchema.paths,自有库用localPath
KnowledgeServicePathResolver.java[SK7FM]: F:按知识库编码和统一operationId解析知识库调用实际path,支持百应自有(固定映射)与第三方(JSON动态解析)双模式 | R:SsResourceService,SsResExtDocService,KnowledgeServiceOperation,SsResource,SsResExtDoc | A:- | S:dataset.system开关切模式,findKnowledgeResourcesByCode定位资源,解析targetContent的resourceService/openapiSchema/paths反查operationId,FastJSON OrderedField,空knCode回退本地path

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/config/===
FeignConfiguration.java[GFE5FT]: F:Feign客户端配置,定制HTTP消息转换器与响应解码器支持多媒体类型及流式响应 | R:BaseFeignResponseInterceptor,FeignSensitiveConfig | A:- | S:JSON/text/event-stream转换器,StringHttpMessageConverter,FeignResponseDecoder处理InputStream避免流关闭,脱敏配置注入
FeignSensitiveConfig.java[GFE3T]: F:Feign敏感信息脱敏配置,定义脱敏开关/掩码字符/敏感字段列表 | R:- | A:- | S:@ConfigurationProperties前缀feign.sensitive,默认脱敏password/token/secret/authorization等字段,maskChar默认*****

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/interceptor/===
AbstractFeignRequestInterceptor.java[WF5GL]: F:Feign请求拦截器抽象基类,统一日志/格式校验/Cookie与Token头注入 | R:FeignSensitiveConfig,MaskSensitiveUtil,SsoTokenService,JwtService,CurrentUserHolder,I18nUtil | A:- | S:apply三段式(脱敏日志→格式校验→子类doIntercept),multipart跳过JSON校验,generateCookie注入Sso-Token/Beyond-Token/System-Code,addCookie按SESSION/Beyond-Token/Cookie优先级透传
BaseFeignResponseInterceptor.java[WF3SM]: F:Feign响应拦截器基类,解码响应体并校验格式/脱敏/记录日志 | R:FeignSensitiveConfig,MaskSensitiveUtil,I18nUtil,Decoder | A:- | S:实现feign.codec.Decoder,download/report跳过处理,字节流缓存重建Response,状态码与JSON格式校验,抽象processResponse由子类实现
CommonFeignRequestInterceptor.java[WFE5FT]: F:通用Feign请求拦截器,透传上下文请求头 | R:AbstractFeignRequestInterceptor | A:- | S:继承抽象拦截器,doIntercept空实现,通用逻辑全由父类承载
FeignAiWriterRequestInterceptor.java[WFE5GS]: F:AiWriter专用Feign请求拦截器,透传Cookie与签名认证头,无Servlet上下文时降级用JWT | R:AbstractFeignRequestInterceptor,JwtService,CurrentUserHolder,LoginInfo | A:- | S:doIntercept钩子,addCookie复用,签名头x-signature系列/sso-token/beyond-token/language批量透传,netty适配createJwt
</content>
</invoke>
FeignChatBiRequestInterceptor.java[WFE8FT]: F:ChatBI内部Feign调用拦截器,透传Cookie跳过横向越权 | R:AbstractFeignRequestInterceptor | A:- | S:doIntercept添加默认头,RequestContextHolder取请求,仅透传cookie头,内部接口免越权校验
FeignDocChainRequestInterceptor.java[WF5GT]: F:DocChain Feign请求拦截器注入X-Api-Key认证头 | R:feign.RequestInterceptor | A:- | S:实现RequestInterceptor,@Value读取feign.docChain.header配置,apply时添加X-Api-Key头
FeignPythonRequestInterceptor.java[WFE9JGT]: F:Python服务Feign调用统一认证拦截器,补齐Session或JWT令牌鉴权头 | R:JwtService,CurrentUserHolder,LoginInfo,SystemCode | A:- | S:从CurrentUserHolder取sessionId优先注入Cookie(SESSION/PORTAL-SESSION),否则注入System-Code与Beyond-Token的JWT,数字员工稽核调用鉴权
FeignWhaleAgentRequestInterceptor.java[WFE5JGM]: F:WhaleAgent Feign请求拦截器,透传Cookie/签名头并注入Beyond-Token(JWT)与System-Code | R:AbstractFeignRequestInterceptor,JwtService,CurrentUserHolder,LoginInfo,WhaleAgentUserContextHolder | A:- | S:透传x-signature系列/sso-token签名头,优先用loginInfo生成JWT否则按userCode构造payload,缺userCode抛异常,大小写无关header去重
WhaleAgentUserContextHolder.java[UFE1MT]: F:Feign调用链用户上下文持有器,跨线程传递userCode | R:WhaleAgentFeignInterceptor,TransmittableThreadLocal | A:- | S:TTL线程本地变量,set/get/clear方法,private构造防实例化,多租户用户隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/request/chatbi/===
KnowledgePublish.java[DKN5M]: F:知识库发布请求,含知识库ID、发布对象类型(org/user)、权限类型(查看/编辑)、对象ID

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/request/conversation/===
Agent.java[DE5FM]: F:会话Feign数字员工请求数据类,含agentId/agentCode/集成类型(A2A/INTERFACE)等字段
AgentPrologueDto.java[DCH5S]: F:数字员工开场白配置DTO(模型/人设/知识库检索/文件上传)
Dataset.java[DKB5M]: F:知识库数据集Feign请求数据类,含资源ID/业务类型/数据集编码名称描述
McpServer.java[DTOL7S]: F:MCP服务配置数据类,描述mcp服务标识/传输类型/地址/命令/参数等
MenResComQo.java[DCH7M]: F:会话响应内容查询对象,承载bot动态卡片/ui-agent/图表卡片等富内容(resType+resPage),含消息与任务关联及租户隔离字段
RunConfig.java[DCH1MT]: F:会话运行配置(模型/温度/baseUrl/apiKey)
TodoRequestDTO.java[DCH5M]: F:待办/审批请求DTO,含待办响应数据、内容显示卡片(简单/复杂)、按钮动作、流程信息、授权参数等嵌套结构
OpenAiToolDto.java: F:OpenAI工具资源数据传输对象,扩展OpenAPI规范,描述工具/MCP/智能体等资源元信息
PluginMachineDto.java: F:插件工具信息DTO,含工具编码/名称/URL/异步SSE标识等

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/request/datacloud/===
TermsOptionsReq.java[DOB5K]: F:数据云术语选项查询请求参数(术语集/类型码/字段/数据集/关键词/分页)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/request/knowledge/===
AgtResource.java[DKN5M]: F:知识库/智能体资源Feign请求体,含数据集/插件/MCP/三方文档库多类资源字段
ChunkMetadataFilter.java[DKO7S]: F:知识分块元数据过滤条件(合同编号/名称/金额/签单日期/发票等),含setter自动去空去重
ContractFileQuery.java[DKN5M]: F:知识库合约文件查询参数,继承FileQuery,含合约元数据过滤与资源ID列表
ContractMetadataFilter.java[DKNOW5S]: F:合同元数据检索过滤条件(编号/金额/签单日期/运营商/发票),setter自动去空格去重
ContractName.java[DKN5M]: F:合同名称检索条件(与/或/排除三类列表)
FeignPage.java[DKN5K]: F:知识库Feign分页请求参数,含归属类型/资源状态/数字员工appId列表
FileQuery.java[DKN5K]: F:知识库文件查询参数(文档/分片类型、文件ID、关键字、知识库ID过滤)
FolderDelete.java[DK7ST]: F:知识库文件夹删除请求,含资源ID与目录路径
Folder.java[DKNW5M]: F:知识库目录Feign请求数据类（resourceId/目录名/路径/描述）
KeywordsFilter.java[DKNW3S]: F:知识检索关键词过滤参数(与/或关系关键词列表)
Metadata.java[DKN5M]: F:知识库元数据实体(文档库标识/目录标识/数据集类型)
OpenFileDelDTO.java[DK5M]: F:知识库文件批量删除请求DTO,含文件ID列表
OpenFileDownloadDTO.java[DKNOW5S]: F:知识库文件下载请求,封装文件ID
OpenFileMetaDTO.java[DKN5M]: F:知识库开放文件元数据传输对象,封装fileId
OpenFileQueryDTO.java[DKN5M]: F:开放文件查询参数(会话ID/标签/匹配模式)
OpenFileTagDTO.java[DKN5M]: F:知识库开放文件标签批量请求体,封装文件标签列表
OpenFileTag.java[D]: F:知识库文件标签 Feign 请求数据类,含 fileId 与 tags
RebuildData.java[DKB5M]: F:知识库重建请求数据类,含数据集ID/文件列表/文档类型
AgtResourceDelete.java: F:知识库资源删除Feign请求参数
ChunkFileQuery.java: F:知识库分块文件查询参数,含元数据过滤与扩展选项
ExtensionsOptions.java: F:知识检索扩展选项,控制切片按页码升序或匹配得分排序

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/request/manager/===
Agent.java[DEMP5T]: F:数字员工Feign请求数据类,含agentId/code/type/SSE地址/集成类型
AgentResourceChatInfoDto.java[DEMM7S]: F:数字员工会话资源信息DTO,聚合智能体/知识库/数据库/插件/MCP/核心能力等配置
Dataset.java[DKN5M]: F:知识库数据集Feign请求体,含数据集ID/编码/名称/资源ID及业务类型(KG_DOC/KG_QA)
FindQo.java[DCH3FT]: F:会话搜索分页查询参数,含会话类型与搜索类型数组
McpServer.java[DTOOL5S]: F:MCP服务Feign请求参数(资源标识/传输类型/url/command/args/env等)
OpenAiToolDto.java[DG7TM]: F:OpenAI工具资源DTO,继承OpenAPI规范,封装工具集/MCP/插件等资源标识与类型
OpenResourceQo.java[DD5M]: F:开放资源查询对象,封装资源ID
PriviledgeDto.java[DPER5M]: F:权限类型传输对象
PrivilegeGrantDto.java[DPER5M]: F:授权信息传输对象,含授权类型/操作类型/资源对象/授权目标/红黑名单/生效失效时间
ResourceIdQo.java[DCORE5S]: F:资源ID批量查询参数,含资源ID列表与资源状态
ResourceOperQo.java[DOb8K]: F:资源运营查询参数,含分页/资源类型/状态/归属/租户/ES查询/排序条件
SearchUser.java[DAUTH5M]: F:用户搜索Feign请求参数,含路径/用户编码/ID/名称

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/request/python/===
AgentInfoDuplicateCheck.java[DEM5T]: F:数字员工重复检查信息载体(名称+核心能力列表)
CoreCompetency.java[DEMP5T]: F:数字员工核心能力数据类(能力描述/接受拒绝边界/样例)
DigitalEmployeeDuplicateCheckRequest.java[DEM5M]: F:数字员工重复检查请求体,含待查员工信息、可用员工ID列表与环境变量
EmployeeAudit.java[D]: F:数字员工审核请求体,含名称与核心能力列表
DigEmployeeExtCore.java: F:数字员工关联扩展属性(子智能体/知识集/插件工具/MCP服务列表)
DigEmployeeGenerate.java: F:数字员工生成请求体,含智能体名称/描述/能力/约束/性格维度/核心能力等LLM生成字段

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/request/pythonbuild/===
FileBuildStatus.java[DKNOW5S]: F:知识文件构建状态请求数据类,含知识库编码与文件路径
KbDirectoryCreate.java[DKN5M]: F:知识库目录创建请求体(knCode/directoryPath/directoryDescription)
KbDirectoryDelete.java[DKN5M]: F:知识库目录删除请求体,含知识库编码与目录路径
KbDirectoryUpdate.java[DKN5M]: F:知识库目录修改Feign请求体(知识库编码/当前路径/新目录名)
KbFileImport.java[DK5FM]: F:知识库文档导入multipart表单字段模型(knCode/filePath/fileContent)
KbFileToMarkdownIndex.java[DK7M]: F:文件解析并建索引请求体(知识库编码+文档全路径)
KbKnowledgeCreate.java[DKN5S]: F:创建知识库Feign请求体(知识库名称/描述)
KbKnowledgeDelete.java[DKN5M]: F:删除知识库Feign请求体,含知识库编码knCode
KbKnowledgeUpdate.java[DA3KM]: F:修改知识库Feign请求体(知识库编码/名称/描述)
KbListDir.java[DKN5M]: F:知识库目录列举请求参数(知识库编码+目录路径)
KbFileDelete.java: F:知识库文档删除请求体（knCode+filePath）
KbFileDownload.java: F:知识库文件下载请求表单字段模型(知识库编码+文件路径)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/request/sandbox/===
RenewSandboxTimeoutRequest.java[DB8LT]: F:沙箱超时续约请求体(沙箱ID+续约时长)
SandboxLaunchRequest.java[DBA5S]: F:沙箱启动请求参数,含沙箱类型/用户编码/环境变量/元数据/用户信息
WhaleAgentListFilesRequest.java[DSB5S]: F:沙箱列出文件请求体,含文件路径与文件共享类型
WhaleAgentListSandboxesRequest.java[DSA5KS]: F:沙箱列表查询请求,含分页与元数据过滤

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/response/===
ApprovalNotifyResponse.java[DF5ST]: F:审批通知Feign响应泛型封装(结果对象/数据/状态码/消息)
BiResponse.java[DF5FM]: F:BI/智能体Feign统一响应泛型封装
ConversationResponse.java[DC5FM]: F:会话引擎Feign接口通用响应包装泛型对象
DataCloudResponse.java[DD5OM]: F:数据云Feign统一响应封装泛型类
KnowledgeApprovalResponse.java[DK7KM]: F:知识审核Feign接口专用响应包装类,含code/msg/data及成功失败编码常量
ManagerResponse.java[DF5FM]: F:Feign调用统一响应封装泛型类
PythonBuildResponse.java[DENULT]: F:Python知识构建服务统一响应DTO,resultCode/resultMsg/resultObject三段式
PythonMemoryResponse.java[DKNOWMS]: F:Python记忆服务Feign响应DTO空壳
PythonToolResponse.java[DA5TM]: F:Python工具Feign调用统一响应泛型封装(code/msg/data,SUCCESS=0)
ScheduleResponse.java[DF5FM]: F:调度服务Feign响应结果封装类(resultCode/resultMsg/resultObject)
KnowledgeResponse.java: F:知识服务Feign统一响应封装(泛型结果码/消息/对象)
SandboxResponse.java: F:沙箱服务统一响应对象(泛型code/data/message)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/response/conversation/===
TodoDelRespDTO.java[DTA5T]: F:Todo任务批量删除Feign响应,含成功/失败计数及失败任务明细内部类
TodoQueryRespDTO.java: F:待办任务查询响应DTO,含任务总数/状态分组统计/任务列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/response/datacloud/===
TermsItem.java[DOB5S]: F:数据云术语项数据类,含label/value/code/name及metadata元数据映射
TermsOptionsResp.java[DOB5M]: F:数据云术语选项分页响应,含items列表/page/pageSize/total

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/response/knowledge/===
AgentDebugChatDto.java[DK5EM]: F:数字员工调试会话请求参数
AgtAgent.java[DKN5M]: F:智能体Feign响应数据类，含智能体ID/名称/描述/知识库/插件/模型等完整属性
AprovalInfoDto.java[DKNOW5T]: F:知识审批信息DTO,含需取消订阅的资源ID列表
ChatBiKnowledgeDto.java[DKNW5S]: F:ChatBI知识库信息数据传输对象,含知识库ID/名称/类型/描述
Data.java[DKN5M]: F:知识检索召回结果数据类(文档块chunk/评分/标题链)
DbResourceDto.java[DDC1T]: F:知识库数据库资源传输对象(空壳占位)
DirectUnsubscribeDto.java[DKN5S]: F:直接取消订阅资源数据传输对象,含资源ID列表/类型映射/用户ID/取消授权权限映射
FileUploadConfig.java[DK7M]: F:知识库文件上传配置数据类(开关/大小/数量/类型限制)
KnowledgeSearchResponse.java[DKNOW5M]: F:知识库检索响应数据类,含result/message/code
McpServerDto.java[DTOO5S]: F:MCP服务器配置DTO,含请求头Map,继承McpServer
MessageFileDto.java[DKNOW5S]: F:消息文件信息数据类(文件id/名称/地址/大小/类型)
Metadata.java[DK5M]: F:知识库文档元数据(文档库/目录/类型) | S:datasetId,fileCollectId默认-1,datasetType默认4混合类型
ModelDto.java[DM5ST]: F:知识服务模型实例信息DTO
ModelVo.java[DKM5T]: F:知识库模型查询VO,含模型ID列表/分页/参数Map
OpenFileTagRespDTO.java[DK5KM]: F:知识库文件标签查询响应DTO,含文件列表及标签/数据集等信息
Params.java[DKN5S]: F:知识检索Feign响应参数,封装文本列表
PluginHeader.java[DKNOW5T]: F:知识插件请求头信息数据类(类型/编码/值/描述/方法类型)
PreUploadData.java[DK7M]: F:知识库预上传数据传输对象(数据集ID+元数据)
PriviledgeDto.java[DKN5T]: F:知识权限类型传输对象
Priviledge.java[DKNOW5M]: F:知识权限响应数据类(组织/用户权限)
PublicApp.java[DKN5S]: F:知识中心公开应用Feign响应数据类,含应用ID/目录/发布类型/资源状态等字段
PublishChannelDto.java[DKN5M]: F:知识库发布渠道项目信息传输对象
ResourceInfoDto.java[DKND T]: F:知识资源信息数据传输对象,含资源ID/类型/名称
ResultItem.java[DKN5S]: F:知识检索结果项,封装文本片段列表
ShelfDto.java[DKNOW5T]: F:知识资源上下架请求类,含资源ID列表/ObjId/资源类型
TextItem.java[DKNOW5S]: F:知识检索文本结果项,含相关度评分与数据内容
UnSubscribeDto.java[DKNOWS]: F:取消订阅知识资源(文档/智能体/插件/数据库)请求参数,含类型与id列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/response/python/===
BatchProgressResponse.java[DKNOW5M]: F:Python QA-Worker批处理进度响应数据类,含批次任务列表/准确率/进度百分比/任务详情结果摘要嵌套结构
DigitalEmployeeDuplicateCheckResponse.java[DEMASM]: F:数字员工重复检查Feign响应,含重复员工ID列表
EmployeeAuditResult.java: F:数字员工合规审计结果(key/合规标志/原因/子项)数据类

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/response/pythonbuild/===
Data.java[Ddata]: F:Python构建Feign响应数据载体,封装目录/文件列表
DirOrFile.java[DD5M]: F:目录或文件信息响应数据类(知识库构建)
KbImportResult.java[DK5M]: F:知识库条目导入响应data,含文件ID
KnowledgeBaseInfo.java[DK5KM]: F:创建知识库成功响应结构,含知识库编码/名称/描述
ProcessStatus.java[DKO5M]: F:Python构建流程状态封装(状态/当前步骤/步骤字典)
StatusDict.java[DD5M]: F:状态字典数据类,封装标准编码与中英文显示值
StepDict.java[DR5M]: F:步骤字典数据类,封装标准编码与中英文显示值

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/response/sandbox/===
SandboxLaunchData.java[DESBT]: F:沙箱启动响应数据(端点/token/端口/过期时间)
SandboxRenewResult.java[DSANDBOX5LT]: F:沙箱续约结果数据类,封装新的过期时间并解析为OffsetDateTime
WhaleAgentFileItem.java[DFI5OS]: F:沙箱Agent文件项响应,含路径/名称/大小/修改时间/目录标识
WhaleAgentSandboxPageResult.java[DSA5KS]: F:沙箱分页查询结果响应体,含沙箱详情列表与分页信息
SandboxCreateResult.java: F:沙箱创建结果(兼容WhaleAgent与OpenSandbox双格式,含id/status/元数据/生命周期)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/feign/util/===
MaskSensitiveUtil.java[UFE3T]: F:Feign日志敏感字段脱敏工具,按配置正则替换JSON中敏感字段值 | R:FeignSensitiveConfig,I18nUtil | A:- | S:私有构造防实例化,maskSensitiveInfo遍历敏感字段列表正则匹配替换为掩码字符,enabled开关控制

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/i18n/===
I18nLocaleResolver.java[USY3T]: F:国际化语言解析器,按header→parameter→attribute优先级解析请求语言 | R:I18nUtil.java,StringUtil.java | A:- | S:实现Spring LocaleResolver,默认中文,resolveLocale三级回退,setLocale空实现
I18nUtil.java[USY3T]: F:国际化消息工具类,从请求头解析语言并获取本地化消息 | R:ApplicationContextUtil.java,StringUtil.java,MessageSource | A:- | S:静态MessageSource初始化,LocaleContextHolder线程绑定Locale,zh/en语言解析

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/json/===
StringOrArrayToJsonStringDeserializer.java[USY3T]: F:Jackson反序列化器兼容前端传JSON字符串或字符串数组统一转JSON字符串入库 | R:- | A:- | S:继承JsonDeserializer,处理VALUE_NULL/VALUE_STRING/START_ARRAY三态,数组用ObjectMapper序列化,getCodec兜底

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/jwt/===
JwtAuthentication.java[EAU9JT]: F:JWT认证令牌对象,封装token及权限信息供SpringSecurity认证流程使用 | R:AbstractAuthenticationToken | A:- | S:继承AbstractAuthenticationToken,持有jwtToken,getPrincipal/getCredentials按认证状态返回token或null
JwtService.java[USET9JES]: F:JWT令牌生成与验签服务,支持RS256(非对称)和HS256(对称)双算法签发及刷新令牌 | R:LoginInfo,CommonErrorCode,BaseException,I18nUtil,StringUtil | A:- | S:RSA公私钥从配置Base64加载,parseClaimsJws校验签名与过期,createJwt/generateRefreshJwt按时/天设有效期,fastjson序列化payload,InitializingBean初始化密钥
SsoTokenService.java[STO7JM]: F:SSO单点登录令牌服务,生成JWT令牌并创建/查询Spring共享Session | R:CurrentUserHolder.java,RedisUtil.java,ShareSessionKey.java,LoginInfo.java,SessionRepository | A:- | S:HMAC256签名JWT含id/code/name/email/phone,24h过期,SSO_SESSION_前缀Redis存sessionId,共享Session写门户用户与组织/岗位信息,多租户enterpriseId隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/log/aspect/===
ExceptionLogAspect.java[HA8AM]: F:Controller层异常日志环绕切面,拦截RequestMapping方法异常并落库 | R:LogExceptionInfoService,LogExceptionInfo,RequestContextUtil,PythonRuntimeException,ServiceCode | A:- | S:@Around三注解,ConditionalOnProperty可配开关,采集请求ID/IP/URL/请求头/请求体/堆栈,按异常类型映射errorModule/errorCode,捕获不阻断重抛

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/log/config/===
TraceFilterConfig.java[GS3AT]: F:注册追踪过滤器Bean为每个HTTP请求生成唯一请求ID用于日志追踪 | R:TraceFilter.java | A:- | S:FilterRegistrationBean,order=2,拦截/*,enabled

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/log/exception/===
BaseRuntimeException.java[HCO3T]: F:运行时异常基类,封装错误服务名/原因/消息供全局异常处理捕获 | R:GlobalExceptionHandler | A:- | S:继承RuntimeException,双构造(直抛/含cause),Lombok-Getter/Setter,toString返回errorMsg
ChaiBiRuntimeExcepion.java[ECON3T]: F:ChatBI平台运行时异常 | R:BaseRuntimeException,ServiceCode | A:- | S:继承BaseRuntimeException,默认错误码CHATBI_PLATFORM_ERROR
DigitalHumanRuntimeExcepion.java[HEM3T]: F:数字员工运行时异常 | R:BaseRuntimeException,ServiceCode | A:- | S:继承BaseRuntimeException,默认DIGITAL_HUMAN_ERROR码,支持错误消息与cause构造
DocchainRuntimeException.java[EH3T]: F:Docchain文档平台运行时异常 | R:BaseRuntimeException,ServiceCode | A:- | S:继承BaseRuntimeException,默认错误码DOCCHAIN_PLATFORM_ERROR,支持消息与异常链构造
KnowledgeRuntimeExcepion.java[EKN3T]: F:知识库运行时异常 | R:BaseRuntimeException,ServiceCode | A:- | S:继承BaseRuntimeException,默认INTELLIGENT_AGENT_PLATFORM_ERROR错误码,双构造方法
ManagerRuntimeException.java[HC1T]: F:Manager平台运行时异常 | R:BaseRuntimeException,ServiceCode | A:- | S:继承BaseRuntimeException,默认错误码BYAI_MANAGER_PLATFORM_ERROR
MemoryRuntimeException.java[HCO3T]: F:记忆系统运行时异常,封装消息/检索错误 | R:BaseRuntimeException,ServiceCode | A:- | S:继承BaseRuntimeException,静态工厂messageRuntimeException/searchRuntimeException,关联MEMORY_SYSTEM错误码
PythonRuntimeException.java[HSY3T]: F:Python服务运行时异常封装,按错误码区段映射到对应Python应用模块 | R:BaseRuntimeException,ServiceCode | A:- | S:携带errorCode/traceback/path/timestamp,getServiceCode按errorCode/1000划分APP_BY/MEMORY_SEARCH/DOCCHAIN/CHATBI/WRITER/AGENT/DH
ServiceCode.java[KK1ST]: F:服务异常码与模块标识常量定义 | R:- | A:- | S:记忆引擎/智能体/chatbi/docchain/数字人错误码,Module内部类应用模块标识,requestId常量
XssRuntimeException.java[ECRES1T]: F:XSS攻击运行时异常 | R:BaseRuntimeException.java,ServiceCode.java | A:- | S:继承BaseRuntimeException,默认错误码CHATBI_PLATFORM_ERROR,支持错误消息与异常链构造

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/log/filter/===
TraceFilter.java[WAU5T]: F:HTTP请求追踪过滤器,为每请求生成雪花ID并注入ThreadLocal/MDC上下文 | R:RequestContextUtil.java,SnowFlake.java,ServiceCode | A:- | S:Filter实现,SnowFlake.nextId生成requestId,setAttribute兼容旧代码,finally清理上下文防线程池污染

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/login/auth/===
CurrentUserHolder.java[UAU8MT]: F:当前登录用户上下文持有工具类,基于TTL线程本地存储LoginInfo,提供用户ID/编码/企业/组织/岗位/角色类型/权限判定等多维取值 | R:LoginInfo,UsersOrganization,UserStation,UserType,StringUtil | A:- | S:TransmittableThreadLocal跨线程传递,平台/组织/业务管理员判定,最高权限角色提取,pathCode拆解组织ID集合,多租户隔离基础

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/login/bean/===
CasTicketUser.java[DAU3M]: F:CAS票据用户信息载体
JwtUserInfo.java[DAUTH5JT]: F:JWT令牌中的用户信息载体,仅含登录工号
LoginByUsernameRequest.java[DAUTH5J]: F:用户名密码登录请求参数(支持8种登录方式)
LoginForm.java[DAU3T]: F:登录表单参数类（账号/密码/手机/验证码/加密标识）
LoginInfo.java[DAU1T]: F:登录会话信息载体,封装用户身份/企业/组织/会话/默认助理等上下文
LoginResponse.java[DAU3JS]: F:登录响应数据类,含token/sessionId/ssoToken及成功失败静态工厂
ShareCurrentUser.java[DAUTM]: F:共享session中的当前用户信息载体(用户/角色/邮箱/类型)
UserManageOrg.java[DB3M]: F:用户管理组织关系数据载体(用户ID/组织ID/组织名)
UserStation.java[DPO8M]: F:用户驻地信息数据类（驻地ID/父驻地/名称/类型/路径/国外标识）
WhaleTokenUser.java[DAUTH1JT]: F:鲸闻单点登录Token用户信息载体,含工号/姓名/组织/职位/部门等
UsersOrganization.java: F:用户所属组织/岗位信息载体(组织ID、岗位、用户类型、路径)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/log/util/===
RequestContextUtil.java[UAU3AT]: F:请求上下文工具,统一管理REQUEST_ID(HTTP/WS) | R:SnowFlake.java,ServiceCode.java | A:- | S:TransmittableThreadLocal跨线程池传递,MDC日志注入,ThreadLocal优先RequestAttribute降级,雪花ID兜底生成,clear防污染
SnowFlake.java[USC3T]: F:Twitter雪花算法分布式ID生成器 | R:- | A:- | S:单例nextId同步生成,12位序列+5位机器+5位数据中心,时钟回拨检测,同毫秒序列自增

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/message/dto/===
AggregationConfig.java[DOB35S]: F:指标查询聚合配置数据类(聚合类型/字段/过滤/子聚合/BucketScript脚本)
FilterConfig.java[DES7M]: F:指标查询过滤器配置数据类,支持term/range/日期范围查询
MemRelSearchReponseDto.java[DCH7S]: F:消息关联搜索响应DTO,含提问/回复/反馈/向量等字段
MemRelSearchRequestDto.java[DCH7K]: F:消息关联向量检索请求DTO,含分页/任务会话/提问回复/反馈/向量相似度/时间范围等多维搜索参数
MemSearchResponseDTO.java[DES5T]: F:元数据检索响应DTO,封装消息检索结果含原文/结构体/相关性分数/反馈评分等字段
MetricQueryConfig.java[DES5T]: F:指标查询配置数据类(过滤/聚合/结果映射/趋势分析)
PageResult.java[DCO5KS]: F:通用分页结果封装类(总数/页码/页大小/总页数/数据列表)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/message/entity/===
ByaiMessageHotDto.java[DCH5M]: F:消息热数据传输对象,会话消息归档与状态字段载体
ByaiMessage.java[ECCAM]: F:会话消息表实体,含角色/内容/任务/会话关联及doc_*离线索引字段
ByaiMessageRel.java[EICAT]: F:问答消息关联实体,记录提问响应对象/内容/向量/token指标/反馈及doc同步字段
ByaiMessageRelObjDto.java: F:消息关联对象DTO,封装问答消息收发内容/token统计/反馈评分等字段

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/message/pojo/===
BulkDocumentBody.java[DES1BT]: F:ES索引批量文档操作体,聚合同一索引下创建/更新/删除文档集合
DeleteByQuery.java[DES1T]: F:按索引名删除查询参数载体
DeleteDocument.java[DK5M]: F:删除文档请求消息体,按文档id删除
Document.java[DK1ET]: F:消息文档基类,仅含文档id字段
FindQo.java[DD5VS]: F:消息查询条件空载体QO
SearchHitsQo.java[DES5S]: F:ES搜索命中查询参数,封装索引名
TotalHits.java[DES3T]: F:ES命中总数,封装总条数及与查询的关系(eq/gte)
UpdateDocument.java[DES1T]: F:ES文档更新请求体,含JSON source与docAsUpsert非覆盖更新标志
CreateDocument.java: F:创建文档请求,含文档id与JSON source
SearchHits.java: F:搜索命中结果泛型封装(命中列表/总数/聚合)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/message/qo/===
AuAgentMetaPageQo.java[DE8KM]: F:数字员工元数据分页查询参数,含元数据类型/ID列表/状态及分页字段
AuAgentMetaQo.java[DE7VM]: F:智能体元数据查询参数,含元数据状态/类型/ID集合
MessageHotDelQo.java[DD7M]: F:消息热删除查询参数,含会话ID与消息ID
MessageHotQo.java[DC5VM]: F:消息热度查询参数,含topK/关键词/会话/创建者/消息ID集合
MessageRelObjQo.java[DCH5M]: F:消息关联对象查询参数(消息ID/任务ID/提问回复消息ID列表)
MessageHotPageQo.java: F:消息热点分页查询参数(会话ID/创建者ID/分页)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/message/service/===
ByaiMessageHotService.java[SCH8BK]: F:消息热度CRUD与会话消息检索服务,管理会话消息存储/分页/位置统计/topK查询 | R:ByaiMessageMapper,SequenceService,PageHelperUtil,ByaiMessageHotDto,MessageHotPageQo,MessageHotQo,MessageHotDelQo,MessageQo | A:- | S:批量插入校验行数,selective更新存在则更新否则补插,countPositionInSession计算消息1-based位置,getMessages按sessionId取topK降序,ByaiMessage↔HotDto转换,序列号生成
ByaiMessageRelObjService.java[SCH7KM]: F:消息关联对象CRUD与检索服务,管理问答消息对(askMsgId/resMsgId)关联及点赞点踩反馈 | R:ByaiMessageRelMapper,SequenceService,MessageRelObjQo,MemRelSearchRequestDto,PageResult | A:- | S:add/batchAdd序列号生成插入,updateSelective存在更新否则插入,updateFeedback按relId或消息对更新反馈允许置空,findByQo列表查询,searchMem分页检索PageHelper,Date↔LocalDateTime转换,feedbackLabel字符串List双向JSON序列化,queryMetricsByConfig待实现

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/qo/===
QueryObject.java[D]: F:查询对象基类,封装分页页码/页面大小及关键字搜索字段

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/storage/===
AbstractFileIngressStorageService.java[SF5OS]: F:文件入口存储抽象基类,在对象存储基础上提供直接文件上传/下载/删除/元数据语义的过渡层 | R:AbstractObjectStorageService.java,FileIngressBackend.java,FileMetadata,FileStorageContext | A:- | S:继承AbstractObjectStorageService实现FileIngressBackend,模板方法doUploadFile/doDownloadFile/doDeleteFile/doGetObjectMetadata/doCreateBucket留子类实现,MultipartFile上传桶创建按需
AbstractObjectStorageService.java[SF5OM]: F:对象存储服务抽象基类,封装客户端构建与元数据辅助,默认抛不支持异常待子类覆写 | R:ObjectStorage,FileUtil,FileMetadata,ParsedFileInfo,StorageLocation,StorageObject,StoragePrefix | A:- | S:泛型客户端createStorageClient,buildFileMetadata构造文件元信息,generateFileAccessUrl/parseFileUrl委托FileUtil,put/get/exists/list/delete/copy默认UnsupportedOperationException,三态存储抽象
ArchiveFS.java[SF5OS]: F:用户归档文件系统抽象接口,定义读写删列举存储操作适配三态存储 | R:FileMetadata,MultipartFile | A:- | S:init初始化,read/write/delete/list,流式写支持size+contentType,默认list深度3,MinIO/NFS存储后端契约
ByclawArchiveFS.java[SF5OMS]: F:归档文件系统实现,基于用户私有桶的对象存储个人空间访问 | R:ByclawFS,ArchiveFS,ObjectStorage,UserBucketNameResolver,CurrentUserHolder | A:- | S:继承ByclawFS,按当前用户码解析私有bucket实现数随人走隔离,share-type=private,list默认深度
ByclawFS.java[USFOM]: F:文件系统抽象基类,封装ObjectStorage提供统一读写删列举与路径规范化,适配存储三态 | R:ObjectStorage.java,StorageLocation,StoragePrefix,StorageObject,FileMetadata,I18nUtil | A:- | S:模板方法(getBucketOrRoot/getShareType/getFsRootPath子类实现),路径防遍历(..拦截)与归一化(反斜杠/多斜杠),内外部路径双向转换,MultipartFile与流式写入,目录前缀删除
ByclawResourceFS.java[SFI5OS]: F:公共资源存储文件系统,管理共享bucket(byclaw/datacloud/qa)的初始化与挂载 | R:ByclawFS,ResourceFS,ObjectStorage | A:- | S:继承ByclawFS实现ResourceFS,public共享类型,三个公共bucket批量init/mount容错处理,默认list深度
ByclawUserFS.java[FFM5OM]: F:用户个人空间文件系统实现,按用户隔离数据随人走 | R:ByclawFS.java,ObjectStorage.java,UserFS.java,CurrentUserHolder.java,UserBucketNameResolver.java | A:- | S:继承ByclawFS,根路径/by,私有共享类型,按当前用户code解析专属bucket,MinIO存储多租户隔离
DefaultFileIngressService.java[SFILE5OM]: F:默认文件入口服务,封装上传/下载/删除/元数据获取,支持存储后端路由与文件名规范化 | R:FileIngressBackendRegistry,ObjectStorageConfiguration,FileUtil,FileMetadata,FileStorageContext,I18nUtil | A:- | S:@Primary实现FileIngressService,resolveBackend按storageType选后端,normalizeFileName特殊字符替换,generateFileName日期+时间+UUID,calculateFileMd5,createNormalizedMultipartFile匿名包装,桶按storageCategory解析,ensureBucketExists自动建桶,适配MinIO/NFS多态存储
FileIngressBackend.java[SFE5OT]: F:文件存储后端能力契约接口,定义上传/下载/删除/元数据/建桶操作支持三态存储 | R:FileIngressService,FileMetadata,FileStorageContext | A:- | S:storageType标识后端类型,MultipartFile上传,InputStream下载,bucketName分桶,storagePath路径
FileIngressBackendRegistry.java[SF5OT]: F:按存储类型解析文件接入后端实现,支持nfs/minio/nfs-hybrid三态路由 | R:FileIngressBackend,ObjectStorageConfiguration,StorageType,CommonErrorCode | A:- | S:注入backends列表,getConfiguredBackend读配置存储类型,StorageType.matches匹配,无匹配抛BaseException
FileIngressService.java[SFF5OT]: F:文件接入服务接口定义,封装MultipartFile上传/下载/删除及元数据获取,委托ObjectStorage执行后端对象操作 | R:ObjectStorage,FileMetadata,FileStorageContext | A:- | S:面向应用层文件入口抽象,支持指定bucket上传,批量删除,三态存储兼容
ObjectStorage.java[SFE8OS]: F:后端无关的原子对象存储统一接口,定义put/get/exists/list/delete/copy/move及前缀批量删等存储操作 | R:FileMetadata,StorageLocation,StorageObject,StoragePrefix | A:- | S:存储抽象层接口,屏蔽nfs/minio/nfs-hybrid三态差异,排除MultipartFile与业务上下文,含default方法deletePrefix/move组合实现
ObjectStorageRouter.java[SFL5OM]: F:对象存储路由器,按配置存储类型分发原子操作到对应后端实现(MinIO/NFS) | R:ObjectStorage,AbstractObjectStorageService,ObjectStorageConfiguration,StorageType,StorageLocation,StoragePrefix | A:- | S:@Primary实现ObjectStorage接口,注入实现列表按storageType匹配选择,代理put/get/list/delete/copy/move,支持存储三态
ResourceFS.java[ESF8O]: F:资源文件系统统一抽象接口,定义读写删列与初始化,屏蔽nfs/minio/hybrid三态存储 | R:ByclawFS,FileMetadata | A:- | S:read/delete/list/write双重载(MultipartFile+InputStream流式),默认list深度3,统一落对象存储
UserFS.java[SFB5OM]: F:用户文件系统抽象接口,定义按用户隔离的文件读写删列举与存储初始化挂载,适配nfs/minio/nfs-hybrid三态存储 | R:FileMetadata,MultipartFile | A:- | S:read/write/delete/list方法,filePath按.openclaw/.sessions/.personal_agent前缀,流式write支持zip解压entry,list默认递归3层,数随人走多租户隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/storage/aspect/===
ResourceJsonWriteValidationAspect.java[HFI5T]: F:资源文件写入开放目录前的AOP切面,拦截ResourceFS.write校验标准资源JSON | R:ResourceJsonValidationService,ResourceFS | A:- | S:@Aspect+@Around环绕通知,target匹配ResourceFS,args绑定MultipartFile与filePath,写前调validateIfResourceJson再proceed

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/storage/config/===
AliyunOssConfig.java[GFI3OT]: F:阿里云OSS存储配置属性绑定 | R:- | A:- | S:@ConfigurationProperties前缀file.storage.aliyun-oss,accessKey/endpoint/bucket/tempBucket,MinIO替代存储
BucketConfig.java[GFI5OS]: F:MinIO存储桶配置项 | R:- | A:- | S:configCode配置编码,jsonKey键名,Lombok不可变常量类
FtpConfig.java[GFL3S]: F:FTP/SFTP存储连接配置属性类 | R:- | A:- | S:@ConfigurationProperties(file.storage.ftp),host/user/pwd/path/pathResource/port默认22,Lombok
MinioConfig.java[GFI5OS]: F:MinIO存储配置类,读取host/端口/密钥/桶名及bucket挂载配置 | R:- | A:- | S:@ConfigurationProperties(file.storage.minio),内嵌Api/Mount/Target,getEndpoint按host+api.port收口,挂载支持多宿主机SSH
ObjectStorageConfiguration.java[GFI5O]: F:对象存储配置中枢,按storageType(minio/oss/ftp/sftp/本地/whale-agent)装配存储属性并初始化存储桶映射 | R:MinioConfig,AliyunOssConfig,FtpConfig,ObjectStorageProperties,StorageType,StorageCategory,BucketConfig | A:- | S:ThreadLocal线程级存储类型切换,默认minio,BUCKET_CONFIG_MAPPING映射存储类别到系统配置桶名,支持三态存储,不支持类型抛ByAiArgumentException
ObjectStorageProperties.java[GFI3OS]: F:对象存储属性配置类,封装存储类型/MinIO/OSS/FTP配置及存储桶映射 | R:MinioConfig,AliyunOssConfig,FtpConfig,StorageType,StorageCategory,I18nUtil | A:- | S:多存储类型switch路由默认桶,bucketMapping并发Map,fastjson转配置对象,LOCAL/FILE/WHALE_AGENT空桶

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/storage/constants/===
StorageCategory.java[KFI3OT]: F:存储类别枚举,定义各类文件的MinIO存储路径模板(图标/会话/知识库/脚本/搜索导入等) | R:- | A:- | S:枚举含pathTemplate与description,路径含userId/datasetId/sessionId等占位符,支持多租户用户隔离
StorageType.java[KFI1OT]: F:对象存储类型常量定义,标识MinIO/OSS/FTP/SFTP/本地/NFS挂载/WhaleAgent等存储后端 | R:- | A:- | S:私有构造防实例化,isLocalFilesystem判本地/file别名,matches存储类型匹配兼容本地三态

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/storage/impl/===
AliyunOssStorageService.java[SF5OS]: F:阿里云OSS文件存储服务实现(上传/下载/删除/元数据/建桶,当前为占位骨架) | R:AbstractFileIngressStorageService,AliyunOssConfig,StorageType,FileMetadata,FileStorageContext,BaseException,I18nUtil | A:- | S:继承抽象入口存储基类,createStorageClient用OSSClientBuilder建OSS客户端,getStorageType返回ALI_YUN_OSS,doUpload/Download/Delete/Metadata/CreateBucket均未实现
FtpStorageService.java[SF5FS]: F:FTP文件存储服务实现,支持文件上传/删除及目录自动创建,支持自定义/资源根/路径根三种目录策略 | R:AbstractFileIngressStorageService,FtpConfig,FileStorageContext,FileMetadata,StorageType,UrlUtil,BaseException | A:- | S:FTPClient连接二进制传输被动模式,逐级makeDirectory确保绝对路径存在,storeFile上传,deleteFile删除,download/metadata未实现返null
LocalStorageService.java[SF5FOS]: F:本地文件系统存储实现(开发/挂载卷部署),支持上传下载删除元数据列举复制 | R:AbstractFileIngressStorageService,StorageLocation,FileMetadata,StorageType | A:- | S:basePath可配,nfs三态之一,路径穿越防护(normalize+startsWith校验),Files.walk按maxDepth列举,REPLACE_EXISTING覆写
MinioBucketMountSupport.java[US6OM]: F:MinIO单桶宿主机挂载支撑,通过rclone把桶挂载到所有目标宿主机目录 | R:MinioConfig,MinioMountHostExecutor,BaseException | A:- | S:shouldMount条件判定(minio+minio-mount+enabled),遍历targets逐机挂载,inspect/ensureDir/isMounted幂等校验,buildMountCommand拼rclone命令并maskSensitive脱敏,挂载后复核,storageType三态适配
MinioMountHostExecutor.java[USFIE5O M]: F:MinIO桶挂载宿主机SSH执行器,via JSch远程执行rclone挂载/目录创建/挂载状态校验/坏挂载点自愈卸载 | R:MinioConfig,BaseException,JSch | A:- | S:JSch建会话StrictHostKeyChecking=no,exec通道执行命令收集stdout/stderr,ensureRemoteDirectoryExists坏挂载自愈(umount-l/fusermount-uz),maskSensitiveCommand脱敏ak/sk,shellQuote转义,合并输出与exitCode
MinioStorageService.java[SF8OM]: F:MinIO存储基础设施实现,封装SDK提供上传/下载/删除/复制/列举/建桶/元数据查询及客户端构造 | R:AbstractFileIngressStorageService,MinioConfig,MinioBucketMountSupport,MinioBucketNameValidator,StorageLocation,FileMetadata,StorageObject,BaseException,I18nUtil | A:- | S:MinioClient懒构造+endpoint规范化,createBucketIfAbsent存在即跳过,uploadBytes/objectExists/copyObject无原生rename,list按maxDepth深度过滤,跨桶复制不支持,NoSuchKey异常转译
SftpStorageService.java[SF5FS]: F:SFTP文件存储服务实现,支持文件上传/删除及多级绝对路径自动创建 | R:AbstractFileIngressStorageService,FtpConfig,FileStorageContext,FileMetadata,UrlUtil,StorageType | A:- | S:JSch建Session连接,ChannelSftp操作,三种基路径模式(资源根/路径根/自定义绝对),逐级mkdir建目录,put上传,rm删除,download/metadata未实现
WhaleAgentStorageService.java[SFE5FM]: F:基于Feign REST的WhaleAgent文件存储服务实现,提供上传/下载/删除/列举/元数据/存在性查询及按用户隔离 | R:FeignWhaleAgentService,WhaleAgentUserContextHolder,AbstractFileIngressStorageService,KnowledgeResponse,WhaleAgentFileItem,WhaleAgentListFilesRequest | A:- | S:存储类型WHALE_AGENT,public/private分享类型,bucket前缀userCode提取(byclaw-前缀剥离)并入ThreadLocal上下文,远程路径规范化,BFS按maxDepth递归列举去重,copy未支持,内置InputStreamMultipartFile适配put

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/storage/model/===
FileMetadata.java[DFI5O]: F:文件元信息数据模型(标签/名称/URL/大小/类型/MD5/桶/存储类型)
FileStorageContext.java[EC5OS]: F:文件存储上下文,封装存储类别/路径模板/FTP根目录策略,工厂方法构建各业务场景(图标/数据集/会话/搜索/沙箱工作空间)存储路径 | R:StorageCategory | A:- | S:final不可变类,静态工厂(icon/datasetFile/chatFile/searchFile/sessionImport/sandboxWorkspace),pathTemplate占位替换,FTP三种根目录模式(pathResource/path/自定义绝对路径),日期路径BASIC_ISO_DATE,适配MinIO/FTP/SFTP/Local多后端
ParsedFileInfo.java[DFI5OS]: F:文件url解析后的对象存储信息(桶名/文件路径)
StorageLocation.java[ELC5O]: F:逻辑存储对象位置值对象,封装namespace/bucketOrRoot/path/shareType并归一化路径 | R:StoragePrefix.java | A:- | S:静态of工厂方法,normalizePath统一斜杠去重并补前导斜杠,asPrefix转前缀,Lombok-Getter/EqualsAndHashCode,三态存储适配MinIO桶/远程根/逻辑根
StorageObject.java[DD5SM-T]: F:存储对象列表项数据模型(桶/路径/大小/类型/目录标识)
StoragePrefix.java[ELE3OT]: F:存储前缀逻辑模型,用于列举与前缀删除操作 | R:- | A:- | S:不可变值对象,namespace/bucketOrRoot/prefix/shareType,normalizePrefix规整路径分隔符去前导斜杠,三态存储抽象

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/storage/util/===
FileUtil.java[UFIL5OS]: F:文件访问URL生成与解析工具,构建/解析通用文件预览URL提取桶名与对象路径 | R:ParsedFileInfo | A:- | S:generateFileAccessUrl拼接commonFile/preview前缀,parseFileUrl用UriComponentsBuilder解析query取fileName/bucketName,异常兜底,私有构造防实例化
MinioBucketNameValidator.java[UFI3OT]: F:MinIO桶名合法性校验工具 | R:BaseException | A:- | S:正则校验桶名格式,空值/非法名抛BaseException,静态工具类
MultipartFileUtil.java[UFI5S]: F:内存字节数组构造的MultipartFile实现,支持流/字节多种构造 | R:MultipartFile,FileCopyUtils | A:- | S:封装name/originalFilename/contentType/content,getInputStream返回ByteArrayInputStream,transferTo写文件
UserBucketNameResolver.java[UU3OT]: F:按用户编码生成MinIO个人桶名称(byclaw-前缀),数随人走用户空间隔离 | R:StringUtils | A:- | S:小写归一化+非法字符转dash+去重连字符,长度3-63截断,正则校验桶名合法性,静态工具类

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/storage/validation/===
ResourceJsonConnectivityValidationService.java[SSV5T]: F:资源JSON连通性校验服务接口 | R:ResourceJsonValidationContext | A:- | S:单方法validate入参校验上下文,存储资源连通性验证抽象
ResourceJsonContentExtractor.java[UFI5T]: F:从MultipartFile提取资源JSON字符串(UTF-8) | R:ResourceJsonValidationMessages,ResourceJsonPath | A:- | S:校验文件非空,字节转字符串,IO异常包装为IllegalArgument
ResourceJsonPath.java[DFD5T]: F:标准资源JSON路径解析结果record,封装目标路径/资源目录/业务类型/资源ID
ResourceJsonPathParser.java[UFI5VS]: F:解析ResourceFS.write目标路径并识别标准资源JSON文件 | R:ResourceJsonPath,MultipartFile | A:- | S:正则匹配resource/{dir}/{bizType}_{id}.json,路径规范化,目录与业务类型一致性校验(doc+kg_前缀)
ResourceJsonTypeValidator.java[US5VT]: F:资源JSON按业务类型强校验器接口 | R:ResourceJsonValidationContext | A:- | S:supports匹配resourceBizType,validate执行校验,策略模式扩展点
ResourceJsonValidationContext.java[DV5VT]: F:资源JSON校验上下文记录类 | R:ResourceJsonPath.java,JsonNode | A:- | S:record封装resourceJsonPath/json/root三元组,Jackson解析校验载体
ResourceJsonValidationMessages.java[USY3T]: F:资源JSON写入校验的国际化消息入口 | R:MessageSource,LocaleContextHolder | A:- | S:封装Spring MessageSource按当前Locale取消息,缺失返回key本身
ResourceJsonValidationService.java[SF5OS]: F:编排资源JSON文件写入前的校验流程(路径解析→内容提取→格式校验→路由分发) | R:ResourceJsonPathParser,ResourceJsonContentExtractor,ResourceJsonValidatorRouter,ResourceJsonValidationMessages,ResourceJsonPath,ResourceJsonValidationContext | A:- | S:MultipartFile校验入口,Optional判定是否资源JSON,Jackson readTree解析并校验为object,i18n消息
ResourceJsonValidatorRouter.java[UFI5VT]: F:按resourceBizType路由到对应资源JSON强校验器 | R:ResourceJsonTypeValidator,DefaultResourceJsonTypeValidator,ResourceJsonValidationContext | A:- | S:注入校验器列表,排除默认实现按supports匹配,未命中回退默认校验器

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/storage/validation/validator/===
AbstractLoggingResourceJsonTypeValidator.java[FHC3VT]: F:资源JSON类型校验器统一日志基类,模板方法封装校验前日志记录 | R:ResourceJsonTypeValidator,ResourceJsonValidationContext | A:- | S:实现validate记录validator/bizType/path/json日志后委托doValidate,子类覆写doValidate实现具体校验规则
AgentResouceJsonTypeValidator.java[DEMP5VT]: F:Agent类型资源JSON校验器,委托连通性校验服务校验AGENT资源 | R:AbstractLoggingResourceJsonTypeValidator,ResourceJsonConnectivityValidationService,ResourceJsonValidationContext | A:- | S:supports匹配AGENT类型,doValidate委托connectivityValidationService.validate,@Component注册
DefaultResourceJsonTypeValidator.java[HF3VT]: F:默认资源JSON类型校验器,未命中具体类型时兜底打印类型/路径/内容 | R:AbstractLoggingResourceJsonTypeValidator | A:- | S:@Order最低优先级,@Component,supports恒返false,继承父类日志逻辑
DigEmployeeResourceJsonTypeValidator.java[HEMP5VS]: F:数字员工资源JSON类型校验器 | R:AbstractLoggingResourceJsonTypeValidator | A:- | S:supports匹配DIG_EMPLOYEE类型,继承抽象日志校验器
DocResourceJsonTypeValidator.java[HFI5T]: F:doc目录知识资源JSON类型校验器,处理KG_前缀业务类型 | R:AbstractLoggingResourceJsonTypeValidator,ResourceJsonConnectivityValidationService,ResourceJsonValidationContext | A:- | S:Spring组件,supports匹配KG_前缀,doValidate委托连通性校验服务
McpResourceJsonTypeValidator.java[HTL5VS]: F:MCP资源JSON类型校验器,委托连通性校验服务验证MCP资源配置 | R:AbstractLoggingResourceJsonTypeValidator,ResourceJsonConnectivityValidationService,ResourceJsonValidationContext | A:- | S:supports匹配MCP类型,doValidate调用connectivityValidationService校验,策略模式校验器
ObjectResourceJsonTypeValidator.java[HOB5VT]: F:object业务对象资源JSON校验器,识别OBJECT类型 | R:AbstractLoggingResourceJsonTypeValidator | A:- | S:继承抽象日志校验器,supports匹配OBJECT忽略大小写,@Component注册
ToolkitResourceJsonTypeValidator.java[HTO5VT]: F:Toolkit类型资源JSON连通性校验器 | R:AbstractLoggingResourceJsonTypeValidator,ResourceJsonConnectivityValidationService,ResourceJsonValidationContext | A:- | S:supports匹配TOOLKIT类型,doValidate委托连通性校验服务,@Component注册
ViewResourceJsonTypeValidator.java[HVIEW5VT]: F:业务视图资源JSON类型校验器 | R:AbstractLoggingResourceJsonTypeValidator.java | A:- | S:继承抽象日志校验器,supports匹配VIEW类型,Spring组件

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/typehandler/===
StringListTypeHandler.java[USY1T]: F:MyBatis类型处理器,逗号分隔字符串与List<String>互转 | R:BaseTypeHandler | A:- | S:setNonNullParameter用String.join写入,getNullableResult按split/trim/过滤空读取,空值返回空列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/util/===
CompletionsUtils.java[UCO5WT]: F:SSE响应头设置与用户驻地层级ID解析工具 | R:UserStation,StringUtil | A:- | S:setResHeader设置text/event-stream流式头,getStationIds按点分隔stationIdPath解析所有父驻地ID链
CurlParser.java[UU7TL]: F:curl命令解析工具,将curl解析为结构化数据并生成OpenAPI3.0/JSON Schema | R:ParamField, ResourceBizType | A:- | S:tokenize分词处理引号转义,parseUrl拆baseUrl/path/query,extractBodyParams/extractQueryParams/extractHeaderParams提取ParamField,过滤标准HTTP头,toOpenApiJsonWithDesc生成带描述OpenAPI,wrapOpenApiJson包装resource+tool元信息,buildInputSchema/QuerySchema/PathSchema重建JSON Schema,inferSchema/inferPrimitiveType类型推断,Jackson构建节点
DateUtils.java[USY5S]: F:日期格式化与解析工具,支持Date与字符串互转及分钟加减 | R:StringUtil.java | A:- | S:静态工具类,SimpleDateFormat格式化,多预设pattern常量,ISO/默认格式自适应解析,addMinute毫秒计算
IpUtil.java[UYS3M]: F:从请求头解析客户端IP、判断移动端、识别操作系统类型 | R:StringUtil.java,hutool UserAgentUtil | A:- | S:多级Header取IP(X-Forwarded-For/X-Real-IP等),IPv6本地回环转127.0.0.1,UA关键词匹配移动端,sec-ch-ua-platform优先解析OS
JsonUtil.java[USY1T]: F:JSON序列化反序列化工具,对象与字符串/数组互转 | R:StringUtil.java,fastjson | A:- | S:封装fastjson,toJSONString/parseObject/parseArray,空值安全返回null或空列表
ListUtil.java[USC1T]: F:集合空判断工具类 | R:- | A:- | S:isEmpty/isNotEmpty,静态方法,私有构造禁实例化
LongToStringSerializer.java[USY5T]: F:Jackson序列化器将Long转为String输出避免前端精度丢失 | R:- | A:- | S:继承JsonSerializer,writeString输出value.toString
MapParamUtil.java[UY3S]: F:Map与对象互转及类型安全取值工具 | R:StringUtil,DateUtils | A:- | S:mapToObject反射填充,objectToMap/objectToMapWithParent含父类内省,copyProperties忽略字段,setProperty按javaType转String/Date/Long/Int等,getString/Int/Long/DoubleValue带默认值取值
OkHttpUtil.java[USY1T]: F:OkHttpClient工厂工具,创建配置超时的HTTP客户端实例 | R:okhttp3 | A:- | S:私有构造单例工具类,连接超时90s/读写超时600s,TimeUnit.SECONDS配置
OpenAPIUtil.java[UO3M]: F:解析OpenAPI规范提取单方法入参出参原生Schema构建请求URL | R:BaseException.java,I18nUtil.java | A:- | S:swagger-v3模型,parseSingleMethodNativeParams,提取requestBody/response/query/path的Schema,优先application/json与200响应,server拼接URL
PageHelperUtil.java[USC5KS]: F:分页对象转换工具,MyBatis-Plus/PageHelper分页转统一PageInfo及空分页构造 | R:PageInfo,Page | A:- | S:静态工具类,toPageInfo多重载,emptyPage边界裁剪,泛型分页
RedisUtil.java[UYC5CT]: F:Redis静态工具类封装String/Hash/Set/分布式锁/计数/前缀扫描删除等操作 | R:StringRedisTemplate,StringUtil | A:- | S:静态instance单例注入,setIfAbsent加锁+Lua脚本原子释放锁,scan按前缀删key,setex/setnx/expire/increment,HMSET批量,multiGet批量取
SpanUtil.java[UY3AT]: F:OpenTelemetry-javaagent链路追踪Span工具类,封装名称/输入/输出/异常/标签设置以集成Langfuse | R:opentelemetry-api(Span/StatusCode/AttributeKey) | A:- | S:静态方法集,null安全跳过,input.value/output.value属性,StatusCode.ERROR状态,tags字符串数组属性
StringUtil.java[USC3T]: F:字符串处理工具类(判空/拼接/分割/数字校验/文件后缀提取) | R:- | A:- | S:静态工具,join拼接,splitLong/splitStr分割,isNum正则数字校验,substringBefore截取,getFileSuffix获取小写后缀
UrlParserUtils.java[USYC3S]: F:URL解析工具,拆分服务信息(协议/主机/端口)与URI(路径/查询/片段) | R:- | A:- | S:parseUrl基于java.net.URL,内部类UrlInfo封装serviceInfo与uri,缺端口或路径时兜底处理
UrlUtil.java[UU3FT]: F:补全各服务请求地址工具,从环境配置拼接知识库/会话/Python聊天/检索接口URL | R:ApplicationContextUtil.java,EnvConfigKey.java | A:- | S:静态方法,concatUrl处理斜杠拼接,getCompletionXxxUrl系列读取FEIGN_KNOWLEDGE_URL/APP_BYAI_URL/PYTHON_WEB_URL

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/util/threadPoolUti/===
ThreadPoolUtil.java[USY3AT]: F:创建带命名的TTL线程池工具 | R:TtlExecutors(com.alibaba.ttl) | A:- | S:自定义ThreadFactory命名线程,CallerRunsPolicy拒绝策略,TtlExecutors包装传递线程上下文

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/vo/===
SortField.java[DI5M]: F:排序字段配置(字段名/排序方式/优先级)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/web/===
ApplicationContextUtil.java[USY3T]: F:Spring上下文工具类,静态获取Bean/环境配置/当前请求 | R:StringUtil | A:- | S:实现ApplicationContextAware,静态持有ApplicationContext,getBean按类型/名称,getEnvProperty读Environment,getRequest取RequestContextHolder

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/channels/controller/===
ChatChannelController.java[CCH9WT]: F:数字助理多渠道对话入口,接收转发对话请求并流式响应 | R:ChannelServiceFactory,ChannelService,AssistantChatDto,CompletionsUtils,CurrentUserHolder,ChatCallLimit | A:POST /chat/superAgentChat | S:按accessTerminal工厂选渠道服务,校验当前助理与用户,SSE流式输出,@ChatCallLimit限流,validateRequest校验
DingtalkTestController.java[CDIN5WM]: F:钉钉本地测试控制器,走与机器人监听器相同对话+输出路径,SSE流式返回 | R:ChannelServiceFactory,DingtalkCardStreamingOutputStream,DingtalkSessionService,DingtalkRobotRegistryService,IndexService,UserService,EnterpriseInfoService,SuasSuperassistService | A:/dingtalk/test/chat,/registerStream,/unregisterStream | S:findByUserCode构建LoginInfo,selectAuthDigitEmploy找授权数字员工,装配AssistantChatDto+channelExt,SSE event-stream流式写displayContent,强制注册/注销Stream机器人客户端,CurrentUserHolder设置/清理
**Note:** This task requires translating a complex prompt. The model has provided a one-line index entry following the strict AOCI format, accurately decoding the tag `[CDIN5WM]` for a Dingtalk test controller (Controller, DING domain, level 5, with Feign/multitenant/WS features). The response correctly identifies the SSE streaming chat endpoints and key dependencies.

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/channels/enums/===
AssistantAccessChannel.java[KGA5T]: F:消息接入渠道枚举(WEB/APP/钉钉),与ChannelType一一对应并向会话扩展属性写入统一渠道类型 | R:ChannelType,ChatChannelExtensionKeys,AssistantChatDto | A:- | S:fromAccessTerminal按code解析,ensureChannelTypeInExtension按需putIfAbsent写入不覆盖
ChannelType.java[KGAT1T]: F:渠道类型枚举(App/钉钉/Web) | R:- | A:- | S:code/desc双字段,getByCode忽略大小写匹配
ChatChannelExtensionKeys.java[KGW1T]: F:聊天渠道扩展元数据键名常量(channelType/钉钉会话与发送者标识) | R:ChannelType,AssistantChatDto | A:- | S:final工具类,私有构造,字符串常量,Gateway-SDK-metadata约定

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/channels/service/app/===
AppChannelService.java[SG7WL]: F:App渠道对话服务实现,流式转发至助手会话服务 | R:ChannelService,AssistantChatService,AssistantChatDto,ChannelType | A:- | S:实现ChannelService策略,getChannelType返回APP,chat流式输出到OutputStream,validateRequest校验assistantId非空

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/channels/service/===
ChannelServiceFactory.java[SGA5T]: F:渠道服务工厂,按渠道类型路由获取对应渠道服务实现 | R:ChannelService,ChannelType,AppChannelService,DingtalkChannelService,WebChannelService,I18nUtil | A:- | S:@PostConstruct注册三渠道,静态Map缓存,getService按类型/code查找,isSupported判断
ChannelService.java[SG7WT]: F:渠道服务接口定义,多渠道对话请求处理与参数校验 | R:ChannelType,AssistantChatDto | A:- | S:getChannelType渠道类型,chat流式对话输出OutputStream,validateRequest参数校验,策略模式接口

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/channels/service/dingtalk/===
DingtalkChannelService.java[SDN7WS]: F:钉钉渠道服务实现,封装钉钉对话请求转发至智能体会话服务 | R:ChannelService,ChannelType,AssistantChatService,AssistantChatDto | A:- | S:实现ChannelService接口,getChannelType返回DINGTALK,chat调用assistantChatService流式输出,validateRequest校验chatContent非空

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/channels/service/dingtalk/stream/cards/===
DingtalkCardService.java[SDI5WT]: F:钉钉智能体回复卡片服务,封装createAndDeliver创建空卡与streamingUpdate流式更新内容及updateCard更新copyContent,支持单聊/群聊空间模型 | R:DingtalkTokenService,DingtalkRobotConfigService,DingtalkCardStreamSession,dingtalkcard_1_0.Client | A:- | S:NOT_SUPPORTED事务,outTrackId生命周期复用,cardParamMap全value序列化为JSON字符串,STREAM回调,调试privateData注入,模板ID按robotCode配置回退,SDK异常TeaException日志兜底
DingtalkCardStreamingOutputStream.java[USD5WL]: F:钉钉卡片增量输出流,继承ByteArrayOutputStream实时解析answerDelta/reasoningLogDelta事件并流式刷到钉钉卡片 | R:DingtalkCardService,DingtalkCardStreamSession,ByaiSystemConfigService,ApplicationContextUtil,Constants | A:- | S:JSON块切分(花括号深度+字符串转义),answer/reasoning双缓冲,1001/1002/3003/3009 contentType过滤,推理灰色斜体样式,Markdown分割线合并,filePreview占位符替换,streamingFailed降级,finish终态finalize+copyContent
DingtalkCardStreamSession.java[SDC3WT]: F:钉钉卡片流式会话状态对象,绑定outTrackId贯穿创建与流式更新 | R:dingtalkcard_1_0.Client | A:- | S:持有client/accessToken/outTrackId,finalized标志位,创建与streamingUpdate共享同一outTrackId

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/channels/service/dingtalk/stream/config/===
DingtalkStreamConfiguration.java[GDI3T]: F:钉钉Stream模式配置类,启用配置属性绑定 | R:DingtalkStreamProperties | A:- | S:@Configuration,@EnableConfigurationProperties绑定DingtalkStreamProperties
DingtalkStreamProperties.java[GDI8DS]: F:钉钉Stream模式配置属性 | R:- | A:- | S:@ConfigurationProperties(dingtalk.stream),enabled开关

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/channels/service/dingtalk/stream/===
DingtalkFileDownloadService.java[SDI5OL]: F:钉钉Stream消息文件下载服务,从钉钉API拉取消息附件二进制并上传至会话存储 | R:DingtalkTokenService,DingtalkUserService,AssistantChatApplicationService,DingtalkCallbackMessage,DingtalkMessageDownloadInfo,DingtalkDownloadedMultipartFile,MessageFileDto | A:- | S:OkHttp调messageFiles/download获下载URL,二进制下载,富文本/卡片/图片/视频/文件多msgType解析downloadCode,uploadFiles上传产MessageFileDto,扩展名从contentType推断
DingtalkProactiveMessageService.java[SDI5EL]: F:钉钉主动单聊推送服务,反查staffId(unionId/手机号/工号三级fallback)后经oToMessages批量私聊回复用户 | R:DingtalkTokenService,DingtalkRobotConfigService,DingtalkUserService,UserService,UserExternalSystemService,Sm4Util,I18nUtil | A:- | S:OkHttp调钉钉REST,getbyunionid/getbymobile查ID,递归遍历部门+游标分页按job_number匹配,SM4解密手机号脱敏日志,sampleMarkdown消息体,反查成功回写po_user_external_system绑定
DingtalkReplyDispatcher.java[SDI5T]: F:统一发送钉钉文本回复消息到webhook | R:OkHttpClient,ObjectMapper | A:- | S:OkHttp POST webhook,msgtype=text,空内容兜底默认提示语,序列化异常转IllegalArgument,失败仅warn日志
DingtalkRobotConfigService.java[SED5CM]: F:钉钉机器人渠道配置管理服务,解析数字员工machineChannel构建机器人配置并按robotCode缓存 | R:DingtalkRobotChannelConfig,ResourceExtDigEmployeeDto,ObjectMapper | A:- | S:ConcurrentHashMap缓存robotCode→config,递归解析JSON数组/对象筛DingTalk渠道,按resourceId增删改查,凭证缺失跳过,重复robotCode告警
DingtalkRobotRegistryService.java[SDA5LL]: F:钉钉机器人Stream客户端注册中心,按数字员工资源管理OpenDingTalk长连接生命周期(注册/刷新/注销/全停) | R:DingtalkBotListener,DingtalkStreamBotLifecycle,DingtalkRobotConfigService,DingtalkTokenService,SsResExtDigEmployeeService,DingtalkStreamProperties,ResourceExtDigEmployeeDto | A:- | S:ConcurrentHashMap维护robotCode→client/config,refreshLock串行化,CachedThreadPool守护线程异步start,配置diff增量重启,@PreDestroy全量stop,clientId脱敏
DingtalkSessionService.java[SCD7TM]: F:钉钉Stream模式会话解析与创建,按钉钉会话ID映射ByClaw会话 | R:SessionService,SessionExtService,SequenceService,CurrentUserHolder,ByaiSession,ByaiSessionExt | A:- | S:事务保证session与ext一致,ext扩展存钉钉会话ID,无则新建数字员工会话,租户/创建人隔离,会话名截断200
DingtalkTokenService.java[SDA5CT]: F:钉钉access_token获取与Redis缓存管理 | R:DingtalkRobotConfigService.java,RedisUtil.java,DingtalkRobotChannelConfig.java | A:- | S:按robotCode/clientId/staffId缓存token,119分钟过期,调钉钉gettoken接口,支持按robotCode前缀清缓存
DingtalkUserService.java[SD5FM]: F:钉钉Stream用户解析与登录信息构建,通过外部系统unionId/工号/手机/昵称多策略匹配本地用户并绑定外部账号映射 | R:DingtalkTokenService,DingtalkReplyDispatcher,UserService,UserExternalSystemService,EnterpriseInfoService,SuasSuperassistService,SequenceService,CurrentUserHolder,DingtalkCallbackMessage | A:- | S:钉钉API拉取用户详情,po_user_external_system绑定,多用户userCode正则选择交互,LoginInfo含超助默认数字员工与会话集


**(D=F:Feign调用?否)** — 修正D维度:此处无Feign,标多租户M(用户隔离绑定)即可，标签复核为`[SD5FM]`✓

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/channels/service/dingtalk/stream/listener/===
DingtalkBotListener.java[LDN8AWL]: F:钉钉机器人Stream回调监听,解析消息后异步处理并以流式卡片回复数字员工对话 | R:DingtalkCallbackMessageParser,DingtalkUserService,DingtalkFileDownloadService,DingtalkReplyDispatcher,DingtalkCardService,DingtalkSessionService,ChannelServiceFactory,IndexService,RedisUtil | A:- | S:OpenDingTalkCallbackListener实现,线程池8/32异步消费,Redis msgId 30分钟去重,消息类型校验+群聊过滤,鉴权数字员工权限,下载消息文件,卡片流式输出SSE,CallerRunsPolicy,@PreDestroy优雅关闭
DingtalkStreamBotLifecycle.java[LDIN5LT]: F:钉钉Stream机器人生命周期管理,启动时初始化机器人客户端 | R:DingtalkRobotRegistryService,DingtalkStreamProperties | A:- | S:@PostConstruct启动钩子,enabled开关控制,异常捕获日志记录,BOT_MESSAGE_TOPIC消息主题常量

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/channels/service/dingtalk/stream/model/===
DingtalkCallbackMessage.java[DD1NT]: F:钉钉Stream回调消息数据模型(会话/发送者/消息内容)
DingtalkMessageDownloadInfo.java[DDIN5T]: F:钉钉消息文件下载信息模型
DingtalkMessageFileDownloadResult.java[DD5M]: F:钉钉消息文件下载结果数据类
DingtalkMsgType.java[KDIN3T]: F:钉钉Stream消息类型枚举 | R:- | A:- | S:text/richText/picture/audio/video/file/interactiveCard七类型,code映射,matches忽略大小写匹配
DingtalkRobotChannelConfig.java: F:钉钉机器人Stream渠道配置数据类(clientId/clientSecret/robotCode/卡片模板等)

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/channels/service/dingtalk/stream/support/===
DingtalkCallbackMessageParser.java[SDIN5S]: F:解析钉钉Stream回调原始Map为业务消息对象,按消息类型抽取文本/富文本/语音识别/互动卡片内容 | R:DingtalkCallbackMessage,DingtalkMsgType,ObjectMapper | A:- | S:resolveMsgId兜底headers.messageId,extractContent按msgtype分支,空入参返回全空字段对象
DingtalkDownloadedMultipartFile.java[UDIN3T]: F:将钉钉已下载到内存的字节数组包装为MultipartFile以转交文件上传 | R:DingTalk Stream消息处理器 | A:- | S:实现MultipartFile接口,ByteArrayInputStream流,transferTo写文件,字段名/原始名/contentType/bytes封装

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/channels/service/web/===
WebChannelService.java[SGA7WS]: F:Web渠道对话服务实现,转发请求至助手对话服务并支持流式输出 | R:ChannelService,AssistantChatService,AssistantChatDto,ChannelType | A:- | S:实现ChannelService接口,getChannelType返回WEB,chat调用assistantChatService流式写OutputStream,validateRequest校验chatContent非空

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/route/===
A2aRouteService.java[SR8WL]: F:处理FROM_THIRD/A2A外部智能体调用,拉取Agent Card构造JSON-RPC message/stream请求并解析SSE流转写客户端 | R:PythonSseService,ParamService,ChatProcessContext,AgentResourceChatInfoDto,CompletionsUtils,SseResponseEventEnum,BdpRuntimeException | A:- | S:OkHttp流式SSE,cardUrl查询参数继承到rpcUrl,头白名单透传(beyond-token/sso-token/cookie/system-code),Task/Message/StatusUpdate/ArtifactUpdate映射内部事件,兼容OpenAI delta chunk,历史会话上下文拼接,buildAnswerLine封装answerDelta/reasoningLogDelta
InterfaceRouteService.java[SE7WL]: F:处理FROM_THIRD+INTERFACE型外部智能体调用,OkHttp直连外部SSE地址逐行解析并经PythonSseService转写客户端 | R:PythonSseService,ParamService,ChatProcessContext,AssistantChatDto,AgentResourceChatInfoDto,CompletionsUtils,SseResponseEventEnum | A:- | S:OkHttp流式POST(超时30/600s),event/data配对组装,OpenAI格式delta推断与error规范化(contentType=1002),[DONE]转answerEnd,聊天历史10轮,错误事件写流并置gatewayError
RouteService.java[GRO9WST]: F:Gateway模式聊天路由核心,通过GatewayClient发消息后请求线程循环消费事件队列实时SSE推流,处理worker未就绪重试与沙箱重拉 | R:GatewayClient,PythonSseService,GatewayStreamEventProcessor,ChatStreamRuntimeCoordinator,SandboxService,TargetAgentTypeResolver,InterfaceRouteService,A2aRouteService,JwtService | A:- | S:接口/A2A集成类型分流,资源占位符替换{{DIG_EMPLOYEE_xxx}}→@名称,gatewayEventQueue.poll循环写OutputStream,WS异步分支,沙箱退出重拉等待5轮,reasoningLog进度推送,多租户userCode隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/client/model/===
CreateSandboxResponse.java[DSB5S]: F:创建沙箱响应DTO,含沙箱ID/状态/元数据/过期时间/入口点
ErrorResponse.java[DSA5BT]: F:沙箱客户端错误响应数据类,含错误码与消息
HostVolume.java[ESAND5S]: F:沙箱主机卷挂载路径模型
RenewSandboxExpirationRequest.java[DSA5L]: F:沙箱续期请求体,携带新过期时间expiresAt
SandboxDetail.java[沙箱详情DO]: F:沙箱实例详情数据模型,含镜像/状态/元数据/入口/过期时间
SandboxEndpoint.java[DI5SM]: F:沙箱端点模型,封装endpoint地址与请求头
SandboxStatus.java[ESC5T]: F:沙箱运行状态数据类(状态/原因/消息/最后转换时间)
Volume.java[DSANBT]: F:沙箱容器卷挂载配置数据模型(主机卷/挂载路径/只读/作用域)
CreateSandboxRequest.java: F:创建沙箱请求数据类(镜像/超时/资源限制/环境变量/挂载卷)
ImageSpec.java: F:沙箱镜像规格数据类(镜像URI及认证信息)

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/client/===
OpenSandboxClient.java[USB9SL]: F:OpenSandbox沙箱REST客户端,封装沙箱创建/查询/删除/续期/端点获取与就绪轮询 | R:SandboxProperties,CreateSandboxRequest,CreateSandboxResponse,SandboxDetail,SandboxEndpoint,RenewSandboxExpirationRequest,ErrorResponse | A:POST /v1/sandboxes,GET /v1/sandboxes/{id},DELETE /v1/sandboxes/{id},GET /v1/sandboxes/{id}/endpoints/{port},POST /v1/sandboxes/{id}/renew-expiration | S:OkHttpClient同步调用,API-KEY头鉴权,Idempotency-Key幂等,metadata分页查询带userCode/serviceKey隔离,waitForRunning轮询端点200,JSON容错解析多字段数组,内部OpenSandboxException

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/config/===
SandboxAutoConfiguration.java[GSB5LS]: F:沙箱网关自动配置,装配运行时Provider/生命周期门面/规格处理器/唤醒线程池,按存储类型切换WhaleAgent或OpenSandbox运行时 | R:SandboxProperties,OpenSandboxClient,StandardSandboxLifecycleService,WhaleAgentSandboxRuntimeProvider,OpenSandboxRuntimeProvider,GenericSandboxSpecProcessor,FeignWhaleAgentService | A:- | S:@EnableConfigurationProperties,file.storage.type分支选Provider,StringRedisTemplate注入,sandboxWakeupStreamExecutor线程池(core1/max4/queue32),三态存储兼容
SandboxProperties.java[GBN53S]: F:沙箱网关配置属性,OpenSandbox连接/卷挂载/轮询/锁TTL/存储模式 | R:StorageType,FileStorageRouter | A:- | S:@ConfigurationProperties(byclaw.sandbox),VolumeConfig(minio-mount/file backend+fileRoot+snapshot),OpenSandboxConfig(baseUrl/apiKey/幂等键),metadataCacheTtl/pollInterval/sandboxCreationLockTtl
SandboxServiceSpecConfiguration.java[GSB5ST]: F:沙箱service spec仓库Bean配置,统一主应用ORM读取sandbox_service_spec表 | R:SandboxServiceSpecEntityMapper,MybatisSandboxServiceSpecRepository,SandboxServiceSpecRepository | A:- | S:@Configuration,@Bean注入Mapper构建Mybatis仓库实现
SandboxVolumeBackendValidator.java[GSB5LM]: F:启动时校验沙箱运行时存储卷后端配置(file/minio-mount)及文件类型 | R:SandboxProperties.java | A:- | S:ApplicationRunner最高优先级,backend归一化校验,file后端校验绝对路径fileRoot与fileType(bind/nfs/smb/cephfs),三态存储兼容

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/controller/dto/===
SandboxLaunchData.java[DSB5S]: F:沙箱启动数据，含端点列表、实例端点映射及主端点
SandboxLaunchRequest.java: F:沙箱启动请求DTO,含沙箱类型/用户编码/环境变量/用户信息

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/controller/===
OpensandboxIngressController.java[CGA7SM]: F:沙箱入口代理控制器,转发filebrowser/novnc/openDesign及OpenSandbox API请求至沙箱实例 | R:SandboxIngressFacade | A:/filebrowser/** /novnc/** /openDesign/** /v1/sandboxes/** | S:路径前缀剥离,contextPath处理,instance映射,请求转发委托Facade
SandboxController.java[CSB9SL]: F:沙箱全生命周期管理控制器,提供心跳保活/续约/查询/释放/按工号启动/管理端记录分页/服务规格CRUD/用户首选serviceKey缓存管理 | R:SandboxService,SandboxUserContextRunner,SandboxLaunchRouting,SsSandboxRecordMapper,SandboxServiceSpecEntityMapper,ByaiSystemConfigService,SandboxEndpointRecordSupport,OpenClawUiProxyPaths,CurrentUserHolder | A:/sandbox/heartbeat,/renewSandbox,/getSandboxInfo,/removeSandbox,/launchByUserCode,/listRecords,/removeSandboxById,/updateSandbox,/listServiceSpec,/getServiceSpec,/saveServiceSpec,/deleteServiceSpec,/preferredServiceKey,/removePreferredServiceKey | S:resourceId/userCode兜底解析,callAsUser用户上下文执行启动,远端租约续约,endpoint经网关代理改写(WEB_BASE_URL),首选serviceKey持久化Redis,specJson/templateJson的jsonb自定义SQL增改

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/job/===
SandboxCleanupJob.java[LSB7LT]: F:沙箱清理定时任务定期回收超时未访问的沙箱环境 | R:SandboxService,SandboxLifecycleJobReport | A:- | S:@Scheduled fixedDelay默认60s,@ConditionalOnProperty sandbox.cleanup.enabled,调用cleanupExpiredSandboxes记录候选/扫描/清理/失败统计
SandboxCronPrewarmJob.java[LSA8AS]: F:定时扫描OpenClaw cron状态预热即将到期任务的沙箱 | R:SandboxCronPrewarmService,SandboxCronPrewarmReport | A:- | S:@Scheduled fixedDelay默认60s,@ConditionalOnProperty开关,捕获异常记录预热扫描报告统计
SandboxReconcileJob.java[ASB5LL]: F:定时对账作业,周期性校准DB沙箱生命周期记录与OpenSandbox运行时一致性,自动重拉缺失沙箱 | R:SandboxService,SandboxLifecycleJobReport | A:- | S:@Scheduled固定延迟60s,@ConditionalOnProperty按sandbox.reconcile.enabled开关,调用reconcileSandboxes统计候选/扫描/重拉/保持/失败并日志输出,异常捕获
SandboxRenewJob.java[LSB5LT]: F:定时扫描续约即将到期的沙箱并预启动定时任务沙箱 | R:SandboxService,SandboxLifecycleJobReport | A:- | S:@Scheduled fixedDelay默认60s,@ConditionalOnProperty可开关,调renewDueSandboxes+prelaunchDueCronSandboxes,记录续约/启动统计报表

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/mapper/===
SandboxServiceSpecEntityMapper.java[MSAND5T]: F:沙箱服务规格配置数据访问,处理PostgreSQL jsonb类型字段读写 | R:SandboxServiceSpecEntity | A:- | S:继承BaseMapper,自定义insertSpec/updateSpec注解SQL,spec_json/template_json用::jsonb转换

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/model/===
SandboxLeasePolicy.java[KSB1LT]: F:沙箱租约策略枚举,定义沙箱生命周期归属(远程自动过期/手动释放) | R:- | A:- | S:REMOTE_AUTO_EXPIRE与MANUAL两态,fromDbValue空值/异常兜底为远程自动过期
SandboxInfo.java: F:沙箱实例信息数据模型(端点/网关令牌/过期心跳)

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/persistence/===
SandboxServiceSpecEntity.java[E]: F:沙箱服务规格实体,映射sandbox_service_spec表

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/runtime/===
OpenSandboxEndpointResolver.java[US8SM]: F:解析沙箱实例多端口访问地址,区分OpenClaw直连与Ingress代理路径 | R:OpenSandboxClient,SandboxProperties,SandboxServiceSpec,PortSpec,SandboxEndpointRecordSupport,SandboxRuntimeInstance | A:- | S:按PortSpec遍历端口,getSandboxEndpoint取原始地址,applyProtocol补协议,非OpenClaw实例构建/v1/sandboxes/{id}/proxy/{port}代理URL,捕获endpointHeaders,主端点优选servicePort
OpenSandboxRuntimeProvider.java[SSA9LM]: F:OpenSandbox运行时提供者,实现沙箱复用查询/创建/续约/删除/状态探测/端点解析全生命周期 | R:SandboxRuntimeProvider,OpenSandboxClient,OpenSandboxEndpointResolver,SandboxRuntimeRequestFactory,SandboxRuntimeInstance,SandboxServiceSpec,SandboxInfo | A:- | S:providerType=opensandbox,findReusable按元数据userCode/serviceKey过滤+状态可复用判定+createdAt倒序择优,listSandboxesByMetadata分页,create注入幂等键,heartbeat续约校验timeout,getSandbox探活,租约生命周期L
SandboxRuntimeInstance.java[ESS5L]: F:沙箱运行时实例的提供商中立数据模型,封装沙箱ID/端点/头/生命周期时间/状态/元数据
SandboxRuntimeProvider.java[SSB5LS]: F:沙箱运行时提供者接口,定义创建/查找复用/移除/心跳/列表等运行时操作 | R:SandboxRuntimeInstance,SandboxServiceSpec,SandboxInfo,CreateSandboxRequest,SandboxRuntimePage | A:- | S:SPI接口,providerType类型标识,find Reusable复用查找,resolveEndpoints端点解析,listSandboxesByMetadata元数据分页,默认方法兜底
SandboxRuntimeRequestFactory.java[USB5SM]: F:沙箱运行时请求工厂,构建创建/续期/列举沙箱请求载荷及网关令牌提取、复用状态判定 | R:CreateSandboxRequest,SandboxInfo,SandboxServiceSpec,WhaleAgentListSandboxesRequest,RenewSandboxExpirationRequest,SandboxRuntimeInstance | A:- | S:applyRuntimeMetadata注入幂等键与gateway_token,buildCommonLaunchPayload组装image/volumes/env载荷,WhaleAgent与OpenSandbox双形态续期请求,isReusableSandboxState按failed/exited等状态过滤,stateRankForReuse按running/pending排序,resolveServicePort默认18789
StandardSandboxLifecycleService.java[SSB9SLM]: F:沙箱标准生命周期服务,实现get-or-create/续约/释放/查询并跨多Runtime复用,Redis创建锁+用户索引+元数据缓存+幂等键 | R:SandboxLifecycleFacade,SandboxRuntimeProvider,SandboxServiceSpecRepository,SandboxSpecProcessor,SandboxProperties,StringRedisTemplate,SandboxInfo,CreateSandboxRequest | A:- | S:setIfAbsent创建锁防并发,SHA-256幂等键截断63位适配k8s标签,findReusable复用远端沙箱,resolveTimeout/RemoteExpiresAt时间换算,user-index按用户隔离,metadataCacheTtl写redis,launchMetadata合并
WhaleAgentSandboxRuntimeProvider.java[SS7FSL]: F:WhaleAgent沙箱运行时Provider实现,提供沙箱复用查询/列表/创建/删除/心跳续约/存在性/状态查询 | R:FeignWhaleAgentService,WhaleAgentUserContextHolder,SandboxRuntimeRequestFactory,SandboxRuntimeProvider,SandboxRuntimeInstance | A:- | S:Feign调用launchSandbox/listSandboxes/destroySandbox/renewSandboxTimeout/getSandboxInfo,withUserCode用户上下文切换,可复用状态排序优选最新,响应校验RESPONSE_SUCCESS,过期时间OffsetDateTime解析
SandboxRuntimePage.java: F:沙箱运行时分页结果通用包装类

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/service/cronprewarm/===
OpenClawCronDueJob.java[ESAN3LT]: F:沙箱预热定时任务到期作业的值对象,封装jobId/nextRunAtMs/agentId/会话定位等字段 | R:- | A:- | S:不可变DTO,全字段构造器,仅getter,无业务逻辑
OpenClawCronDueJobReader.java[SSB5S]: F:从沙箱SQLite读取OpenClaw定时任务表查询到期待执行job用于预热 | R:OpenClawCronDueJobs,OpenClawCronDueJob,org.sqlite.JDBC | A:- | S:只读JDBC连接(query_only/busy_timeout),校验cron_jobs表及必需列存在,动态拼接可选列SELECT,查enabled=1且running_at_ms为空的窗口内待执行任务按next_run_at_ms排序限量
OpenClawCronDueJobs.java[DSB1T]: F:沙箱定时任务预热到期任务集合值对象,封装就绪/缺表/缺列三态查询结果 | R:OpenClawCronDueJob.java | A:- | S:Status枚举(READY/MISSING_TABLE/MISSING_COLUMNS),静态工厂ready/missingTable/missingColumns,不可变持有jobs与missingColumns
OpenClawStateSnapshot.java[ESS5ST]: F:OpenClaw状态快照对象,封装预热快照目录与数据库文件并管理临时目录生命周期 | R:SnapshotFileUtils.java | A:- | S:AutoCloseable,missing/present工厂,markFailed标记失败,close按retainOnFailure决定是否清理目录,沙箱定时预热
OpenClawStateSnapshotReader.java[SSB5OST]: F:读取OpenClaw用户SQLite状态快照(含wal/shm),按用户上下文拷贝到临时目录供定时预热使用 | R:SandboxCronPrewarmProperties,SandboxUserContextRunner,UserFS,OpenClawStateSnapshot,SnapshotFileUtils | A:- | S:callAsUser按用户隔离读UserFS,copyRequired重试拷贝必需库文件,可选拷贝wal/shm,sha256(userCode)前16位生成用户目录名,UUID快照子目录,缺文件返回missing
本来要 80-150 行区间 S，行数实际约 110，标签 D 维度取 O(MinIO/存储相关)、S(沙箱执行)较合理，已修正确认为 [SSB5OST]。
SandboxCronPrewarmProperties.java[GSAND5LS]: F:沙箱定时预热配置项,绑定sandbox.cron-prewarm前缀(预热前瞻窗口/批量上限/快照目录/SQLite状态等) | R:SandboxLaunchRouting | A:- | S:@ConfigurationProperties,默认值与normalized取下限校验,快照重试/失败保留开关
SandboxCronPrewarmReport.java[ESAB5T]: F:沙箱定时预热任务执行报告统计载体 | R:SandboxCronPrewarmService | A:- | S:计数器scannedUsers/launched/failed,明细列表上限20条不可变返回,包级别increment/add方法
SandboxCronPrewarmService.java[SSB9SL]: F:定时预热到期Cron任务的沙箱实例,扫描用户读取OpenClaw状态库到期任务并按需启动沙箱 | R:SandboxCronPrewarmProperties,SandboxCronPrewarmUserProvider,OpenClawStateSnapshotReader,OpenClawCronDueJobReader,SandboxCronPrewarmTargetResolver,SandboxService,SandboxUserContextRunner,SsSandboxRecordMapper | A:- | S:遍历userCodes带启动配额上限,快照读取状态库判断缺库/缺表/缺列,解析到期任务为预热目标去重,查活跃记录跳过已存在,按用户上下文异步启动沙箱,逐用户try-finally关闭快照
SandboxCronPrewarmTarget.java[ESB3LT]: F:沙箱定时预热目标值对象(用户/服务键/资源ID三元组) | R:- | A:- | S:不可变三元组,toLogKey日志键,equals/hashCode基于三字段
SandboxCronPrewarmTargetResolver.java[SS5LT]: F:沙箱定时预热目标解析,根据用户与到期任务计算预热目标服务键与资源ID | R:SandboxCronPrewarmProperties,SandboxLaunchRouting,SandboxCronPrewarmTarget,OpenClawCronDueJob | A:- | S:取默认serviceKey走DEFAULT_SANDBOX_TYPE,normalizeEffectiveResourceId规整资源ID,构造Target
SandboxCronPrewarmUserProvider.java[SSB5KS]: F:沙箱定时预热用户码提供者,从配置或活跃用户表查询待预热用户列表 | R:SandboxCronPrewarmProperties,UserService,Users,UserState | A:- | S:配置userCodes逗号拆分优先,否则分页查ACTIVE状态用户,maxUsersPerRun限流去重
SnapshotFileUtils.java[USB1FT]: F:沙箱快照预热目录文件清理工具 | R:- | A:- | S:递归删除目录,Files.walk逆序排序,deleteIfExists静默忽略IOException

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/service/===
EnvTemplateRenderer.java[USB5S]: F:沙箱env文件模板渲染器,解析${userInfo.x}/${envVars.x}/${env.x}占位符替换 | R:- | A:- | S:正则PLACEHOLDER匹配,resolve按前缀分流userInfo/envVars/env,缺失键置空并告警,Matcher.quoteReplacement转义
RunningStateRedisSubscriber.java[LRS9RS]: F:订阅OpenClaw运行态快照Redis通道,将busy信号映射为沙箱心跳刷新 | R:SandboxService,WorkerAgentType via redis:byai_gateway:registry:worker:stats:openclaw | A:- | S:实现MessageListener,ConditionalOnProperty条件装配,校验schema/payload版本marker,过滤BYCLAW_EXE agentType,解析userCode调heartbeatOpenclawSandbox
SandboxEndpointRegistryMetadataFactory.java[SS5ST]: F:沙箱端点注册的鉴权元数据构建工厂,基于网关token生成query鉴权配置 | R:- | A:- | S:authType=query/authParam=token,token空白返null,LinkedHashMap有序输出
SandboxEndpointRegistryTargetResolver.java[USB5S]: F:沙箱端点URI解析为协议/主机/端口/路径目标 | R:SandboxEndpointRegistryTarget | A:- | S:URI.create解析endpoint,默认协议http,http/https补默认端口80/443,host或port非法抛IllegalArgumentException
SandboxEndpointUrlCustomizer.java[USS5GT]: F:沙箱访问端点URL定制,拼接/chat路径并绑定网关token | R:StringUtils | A:- | S:toAccessEndpoint去尾斜杠加chat,bindToken替换或追加token查询参,保留fragment片段
SandboxLaunchContextFactory.java[SSB9SL]: F:构建沙箱启动业务上下文,解析沙箱路由(默认/byclaw-code-agent),装配模型/认证/Beyond-Token环境变量及用户信息 | R:SandboxLaunchRouting,SandboxUserInfoFactory,SandboxService,SsResourceService,AiModelService,ModelManagementApplicationService,JwtService,LoginApplicationService,SsResExtDigEmployeeService,ByaiSystemConfigService,CurrentUserHolder,PrologueDto,ModelDto | A:- | S:resolveRouting按resourceId/workerAgentType路由并优先用户缓存serviceKey,buildContext生成gatewayToken+UUID,从prologue提取modelId查模型注入MODEL_BASE_URL/API_KEY等多组env,JWT签发BEYOND_TOKEN,从系统env与properties加载基础变量
SandboxLaunchContext.java[DSB1ST]: F:沙箱启动上下文数据载体,封装沙箱类型/环境变量/用户信息/网关令牌 | R:- | A:- | S:不可变对象,构造注入四字段,纯getter
SandboxLaunchRouting.java[USB5LS]: F:沙箱启动路由信息,描述启动/复用的沙箱类型及幂等资源键 | R:- | A:- | S:常量openclaw/byclaw-code-agent类型及默认资源ID,normalizeEffectiveResourceId按类型归一化资源ID,isByclawCodeAgent类型判定
SandboxLifecycleFacade.java[SSB9LL]: F:沙箱生命周期门面接口,封装运行时选择与provider适配的启动/销毁/续约/查询编排 | R:SandboxService,SandboxLaunchRequest,SandboxResponse,SandboxInfo,SandboxRuntimeInstance,SandboxRuntimePage | A:- | S:internal门面,外部业务须经SandboxService,launchSandbox/removeSandbox/renewSandbox/getSandbox/listByMetadata分页/sandboxExists,租约生命周期编排
SandboxLifecycleJobReport.java[ESB1LM]: F:沙箱生命周期任务执行汇总报告,记录扫描/影响/跳过/失败计数及样本 | R:SandboxLifecycleService | A:- | S:计数累加,样本上限20条,merge合并多分片报告,不可变列表返回
SandboxMetadataCache.java[SSA5CMS]: F:沙箱元数据Redis缓存,按用户隔离加速查询(生命周期由DB持有) | R:SandboxProperties,SandboxInfo,StringRedisTemplate | A:- | S:put/listByUser/evict,用户索引Set+JSON值,TTL最小60s,失效自动清理索引,ObjectMapper带JavaTimeModule,按userCode多租户隔离
SandboxService.java[ASB9LSL]: F:沙箱全生命周期核心服务,启动/复用/续约/释放/心跳/一致性对账/定时预启动 | R:SandboxLifecycleFacade,SsSandboxRecordMapper,SandboxLaunchContextFactory,SandboxMetadataCache,SandboxUserContextRunner,ServiceRegistry,WorkerRegistry,RedisUtil,SandboxEndpointRecordSupport | A:- | S:Redis分布式锁防并发启动,乐观锁lockVersion+双重检查,resilience4j轮询endpoint/worker就绪,租约策略REMOTE_AUTO_EXPIRE/MANUAL,reconcile多线程分组对账远端,gatewayToken注入endpoint,模型环境变量校验,服务注册worker_agent_type,按用户隔离
SandboxUserContextRunner.java[SS5SM]: F:沙箱后台流程按userCode绑定登录上下文执行任务 | R:CurrentUserHolder,LoginInfo,LoginApplicationService | A:- | S:runAsUser/callAsUser包裹执行,执行前set后恢复原LoginInfo,getLoginInfo构建上下文兜底userCode,多租户隔离
SandboxUserInfoFactory.java[SS5MS]: F:构建沙箱启动用户身份载荷,从登录信息提取用户码/租户/数字员工标识 | R:LoginApplicationService,CurrentUserHolder,LoginInfo | A:- | S:CurrentUserHolder取上下文,身份不全则按userCode查库,合并运行时字段(sessionId/filterType/paramMap),降级兜底,多租户隔离维度(enterpriseId/comAcctId)
SandboxWakeupMessageHandler.java[LSB8RM]: F:处理控制面沙箱唤醒消息,将用户级默认沙箱恢复上线 | R:SandboxService,SandboxUserContextRunner,SandboxLaunchRouting,WorkerAgentType via redis:沙箱唤醒通道 | A:- | S:解析RedisStream记录(data/payload/message字段),仅WAKE_AND_WAIT策略,解析target_agent_type/user_code,校验默认沙箱目标,runAsUser上下文调restartSandboxAfterRemoteExit,多租户用户隔离
SandboxWakeupStreamListener.java[LSB9RS]: F:监听控制面唤醒事件Redis Stream并驱动沙箱生命周期管理,消费者组消费与ack | R:SandboxWakeupMessageHandler,RedisTemplate,RedisConnectionFactory,sandboxWakeupStreamExecutor via redis:byai_gateway:control_plane:mgmt:wakeup | A:- | S:StreamMessageListenerContainer监听,createGroup幂等处理BUSYGROUP,主机名+UUID构建消费者名,ApplicationReadyEvent启动ContextClosedEvent停止,异常保留pending不ack
SandboxEndpointRegistryTarget.java: F:沙箱端点注册目标记录类(协议/主机/端口/路径前缀)

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/service/exception/===
CrossUserAccessDeniedException.java[ESB1MT]: F:跨用户访问拒绝异常,沙箱文件越权时抛出 | R:- | A:- | S:RuntimeException子类,携带userCode与path,数随人走隔离校验
SandboxFileNotFoundException.java[ESB1ST]: F:沙箱文件未找到异常 | R:- | A:- | S:RuntimeException子类,携带userCode与path构造异常信息
SessionWriteAccessDeniedException.java[ESAN1PT]: F:沙箱会话写入越权异常,会话隔离校验失败时抛出 | R:- | A:- | S:RuntimeException子类,携带requestedSessionId/pathSessionId/path,会话级权限隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/service/ingress/===
FilebrowserSandboxIngressInstanceHandler.java[HSB5ST]: F:文件浏览器沙箱入口实例处理器,解析filebrowser路径前缀并绑定当前用户转发 | R:SandboxIngressInstanceHandler,SandboxIngressInstanceType,SandboxIngressRequestContext | A:- | S:supports匹配FILEBROWSER类型,requiresCurrentUserBinding=true按用户隔离,resolveTargetPath补/filebrowser前缀,beforeForward日志埋点
OpenDesignSandboxIngressInstanceHandler.java[HSB5ST]: F:OpenDesign类型沙箱入口实例处理器,解析转发目标路径并补全/openDesign前缀 | R:SandboxIngressInstanceHandler,SandboxIngressInstanceType | A:- | S:supports匹配OPENDESIGN类型,resolveTargetPath处理空/根/已带前缀/补前缀四种场景,非fallback,无需当前用户绑定
OpenSandboxIngressRuntimeSupport.java[SS5SS]: F:OpenSandbox入口运行时支持,非鲸智存储类型时提供baseUrl与API-Key请求头注入 | R:SandboxIngressRuntimeSupport,SandboxProperties,SandboxIngressRequestContext,StorageType | A:- | S:supports排除WHALE_AGENT,从配置取opensandbox.baseUrl,customizeRequest注入OPEN-SANDBOX-API-KEY头,okhttp Request.Builder
PassThroughNamedSandboxIngressInstanceHandler.java[SHA5ST]: F:沙箱入口直通处理器,支持NOVNC类型实例无需当前用户绑定 | R:SandboxIngressInstanceHandler,SandboxIngressInstanceType | A:- | S:实现supports匹配NOVNC,非fallback,无用户绑定要求
PassThroughSandboxIngressInstanceHandler.java[HSB7ST]: F:沙箱入口实例兜底处理器,默认透传不绑定当前用户 | R:SandboxIngressInstanceHandler,SandboxIngressInstanceType | A:- | S:实现Handler接口,supports恒true,isFallback标记兜底,免用户绑定
SandboxIngressEndpointResolver.java[ASA5SS]: F:沙箱Ingress端点解析,按userCode+instance匹配运行中沙箱的实例端点地址 | R:SandboxService.java,SandboxInfo | A:- | S:校验userCode/instance非空,查sandboxInfo列表,遍历instanceEndpoints忽略大小写匹配instance返回端点,无匹配抛异常
SandboxIngressFacade.java[ASS5SM]: F:沙箱入口转发门面,编排请求上下文解析/实例处理器路由/路径重写/用户绑定/透传转发 | R:SandboxIngressRequestContextResolver,SandboxIngressInstanceHandlerRegistry,SandboxIngressRuntimeResolver,SandboxIngressTransportService,CurrentUserHolder | A:- | S:forward编排实例转发,forwardOpenSandboxPath直透,按instanceType解析handler重写targetPath,临时绑定LoginInfo finally恢复
SandboxIngressInstanceHandler.java[GSB7ST]: F:沙箱入口实例处理器接口,定义类型匹配/兜底判定/用户绑定及转发前路径解析与预处理 | R:SandboxIngressInstanceType,SandboxIngressRequestContext | A:- | S:策略接口,supports类型匹配,isFallback兜底,requiresCurrentUserBinding用户隔离,resolveTargetPath/beforeForward默认方法
SandboxIngressInstanceHandlerRegistry.java[SSA5S]: F:沙箱入口实例处理器注册表,按实例类型解析对应Handler含兜底 | R:SandboxIngressInstanceHandler,SandboxIngressInstanceType | A:- | S:构造注入Handler列表,resolve过滤非fallback+supports匹配,fallbackHandler取isFallback兜底缺失抛异常
SandboxIngressInstanceType.java[KSB3T]: F:沙箱Ingress实例类型枚举(文件浏览/noVNC/在线设计) | R:- | A:- | S:from静态工厂忽略大小写匹配,空值兜底UNKNOWN
SandboxIngressRequestContext.java[DSA8S]: F:沙箱入站请求上下文记录类,封装实例类型/用户/上游端点/目标URL/令牌/登录信息等转发参数 | R:SandboxIngressInstanceType,LoginInfo,HttpUrl | A:- | S:Java record不可变载体,沙箱反向代理转发参数聚合,含beyondToken与extraHeaders透传
SandboxIngressRequestContextResolver.java[SSB7JSM]: F:解析沙箱Ingress请求上下文,构建目标URL并注入Beyond-Token转发凭证 | R:SandboxIngressEndpointResolver,SandboxIngressRuntimeResolver,JwtService,CurrentUserHolder,LoginInfo,SandboxIngressRequestContext,SandboxIngressInstanceType | A:- | S:从CurrentUserHolder取userCode多租户隔离,resolveIncomingBeyondToken按header/query取token,无token则jwtService生成JWT,resolveOpenSandboxPath直连openSandbox,maskToken脱敏日志
SandboxIngressRuntimeResolver.java[SSA5ST]: F:沙箱入口运行时解析器,按存储形态选取匹配的运行时支持实现 | R:SandboxIngressRuntimeSupport | A:- | S:注入运行时支持列表,file.storage.type默认minio,stream filter supports匹配findFirst,无匹配抛IllegalStateException
SandboxIngressRuntimeSupport.java[SS5SS]: F:沙箱入口运行时支撑接口,按存储类型适配baseUrl/请求定制/目标URL构建 | R:SandboxIngressRequestContext,okhttp3 | A:- | S:supports存储类型判定,customizeRequest请求定制,buildTargetUrl默认方法拼接upstream+path+query,路径斜杠归一化
SandboxIngressTransportService.java[SSA9SM]: F:沙箱入口请求透明转发,OkHttp上游代理含请求/响应体流式拷贝与头部清洗 | R:SandboxIngressRuntimeResolver,SandboxIngressRequestContext,SandboxIngressInstanceType,OkHttpClient | A:- | S:逐跳头剥离,X-Forwarded-For/Proto/Host注入,filebrowser按auth-cookie注X-Auth,gzip魔数探测解压,chunked/contentLength判体,Accept-Encoding强制identity,token脱敏
WhaleAgentIngressRuntimeSupport.java[SBS5S]: F:沙箱入口WhaleAgent运行时支持,提供baseUrl解析与请求透传 | R:SandboxIngressRuntimeSupport,SandboxProperties,SandboxIngressRequestContext,StorageType | A:- | S:实现storageType匹配WHALE_AGENT,baseUrl优先feign配置回退opensandbox,customizeRequest空透传不改请求头

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/service/ingress/openclaw/===
OpenClawUiHttpProxyService.java[SG8SM]: F:OpenClaw控制台整页代理的HTTP转发核心,将请求转发至URL路径中的目标地址并支持响应体改写 | R:okhttp3,OpenClawUiProxyController | A:- | S:OkHttpClient一次性转发,逐跳头剔除,Origin/Referer改写同源放行,Accept-Encoding=identity禁压缩,流式透传或缓冲改写响应体,X-Forwarded转发,token掩码
OpenClawUiProxyController.java[CWG8WM]: F:OpenClaw控制台整页HTTP反向代理,经网关固定入口转发动态分配的会话控制台端口,改写SPA的basePath配置使相对资源在子路径下对齐 | R:OpenClawUiHttpProxyService.java,OpenClawWebSocketProxyHandler | A:/openclaw-ui/{ip}/{port}/** | S:ip/port编码进路径前缀纯透传,剥context-path提取上游路径,control-ui-config.json改写basePath,ResponseBodyRewriter钩子
OpenClawUiProxyPaths.java[USA3T]: F:OpenClaw控制台整页代理路径工具,将沙箱原始访问地址改写为经网关代理的对外可访问地址 | R:- | A:/openclaw-ui/{ip}/{port}/path | S:URI解析提取host/port/path/query,拼接webBaseUrl+contextPath+ROUTE_PREFIX前缀,解析失败原样返回,纯静态工具类
OpenClawWebSocketConfig.java[GGA5WT]: F:注册OpenClaw控制台整页代理的WebSocket端点配置 | R:OpenClawWebSocketProxyHandler,OpenClawUiProxyController | A:/openclaw-ui/** | S:自建order=-1的SimpleUrlHandlerMapping,重写getHandlerInternal仅在Upgrade:websocket握手请求时匹配否则回落controller,WebSocketHttpRequestHandler,DefaultHandshakeHandler
OpenClawWebSocketProxyHandler.java[CSA9WSL]: F:OpenClaw控制台整页代理的WS反向代理,从路径解析ip/port回连sandbox动态端口双向转发帧 | R:OkHttpClient,AbstractWebSocketHandler | A:WS /byaiService/openclaw-ui/{ip}/{port}/** | S:OkHttp长连接零readTimeout+pingInterval保活,改写Origin同源放行,文本/二进制双向透传,closeCode归一化1000-4999否则1011,token脱敏,ip:port纯透传不校验

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/spec/===
BootstrapSpec.java[DSE5S]: F:沙箱引导规格定义模板复制操作与身份文件路径模板 | R:CopyTemplateOp | A:- | S:lombok-Data,JsonIgnoreProperties忽略未知字段,per-user工作区初始化配置,身份json路径模板
CopyTemplateOp.java[DSA1S]: F:沙箱模板复制操作规格,定义目标卷键与路径模板及缺失时复制标志 | R:- | A:- | S:targetVolumeKey,targetPathTemplate占位符替换,copyIfMissing默认true,JsonIgnoreProperties
GenericSandboxSpecProcessor.java[SSA5SM]: F:通用沙箱规格处理器,依据SandboxServiceSpec构建CreateSandboxRequest(镜像/启动/环境/资源/卷)并触发工作区引导初始化 | R:SandboxWorkspaceBootstrapInitializer,EnvTemplateRenderer,CreateSandboxRequest,Volume,SandboxFsInitContext,SandboxServiceSpec | A:- | S:模板占位符渲染(user_code/service_key/workspace_host),卷构建按scope/readOnly/subPath,copyTemplate解析模板源路径,spec.env过滤渲染,best-effort引导
MybatisSandboxServiceSpecRepository.java[MSB53S]: F:沙箱服务规格仓储实现,按serviceKey直读sandbox_service_spec表并反序列化spec | R:SandboxServiceSpecEntityMapper,SandboxServiceSpecEntity,SandboxServiceSpecRepository,SandboxServiceSpec | A:- | S:MyBatis-Plus LambdaQueryWrapper查询,ObjectMapper解析specJson,无缓存直读,异常降级返null
PortSpec.java[DXSANT]: F:沙箱端口规格数据类,描述镜像内逻辑服务端口/实例名/协议
SandboxServiceSpecRepository.java[MSA5S]: F:沙箱服务规格仓储接口,按serviceKey查询规格 | R:SandboxServiceSpec.java | A:- | S:Repository接口,findByServiceKey返回Optional
SandboxSpecProcessor.java[GSA5S]: F:沙箱规格处理器接口,根据服务规格构建创建沙箱请求 | R:CreateSandboxRequest,SandboxServiceSpec | A:- | S:接口定义,buildCreateRequest入参userCode/serviceKey/envVars/userInfo/spec
StartupSpec.java[DAS5ST]: F:沙箱启动规格,封装容器entrypoint启动命令列表 | R:CreateSandboxRequest | A:- | S:Jackson忽略未知字段,List形式避免命令分割歧义
VolumeScope.java[ESAKT]: F:沙箱挂载卷作用域枚举(公共/私有) | R:- | A:- | S:PUBLIC/PRIVATE,数随人走个人空间隔离
VolumeSpec.java[DBSA5]: F:沙箱容器卷挂载规格定义 | R:VolumeScope | A:- | S:volume键/作用域PUBLIC共享或PRIVATE按用户/宿主路径模板支持user_code占位符/容器挂载路径/只读标志/subPath
SandboxServiceSpec.java: F:沙箱服务规格(存DB JSONB),驱动运行时构建CreateSandboxRequest

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/support/===
SandboxEndpointRecordSupport.java[USB5S]: F:沙箱端点记录编解码工具,兼容legacy纯字符串与新JSON对象格式的多实例端点解析/归一化/存储 | R:ObjectMapper,StringUtils | A:- | S:parseEndpointRecord解析,normalizeInstanceEndpoints递归归一(MAX_DEPTH=8),resolvePrimaryEndpoint优先openclaw实例,toStorageValue序列化,malformed降级回退fallback

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/workspace/===
InputStreamMultipartFile.java[UFI5ST]: F:将InputStream包装为MultipartFile供文件入站上传使用的纯内存适配器 | R:MultipartFile | A:- | S:实现MultipartFile接口,无磁盘临时文件,getBytes读全部字节,transferTo不支持抛异常
SandboxWorkspaceBootstrapInitializer.java[USB5SO]: F:沙箱启动时初始化workspace引导文件,写入openclaw.json模板和用户身份信息 | R:UserFS,SandboxFsInitContext,ByteArrayMultipartFile | A:- | S:解析/.openclaw相对路径,template JSON写openclaw.json,userInfo序列化写identity/by_user_info.json,内部类封装byte数组为MultipartFile,UTF8编码,适配存储三态

===byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/workspace/model/===
SandboxFileEntry.java[DSA5BT]: F:沙箱工作区文件条目数据记录
SandboxFsInitContext.java: F:沙箱工作空间文件系统初始化上下文数据类

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/runner/===
InitDigEmployeeRedisRunner.java[LEM7ARM]: F:服务启动时异步全量初始化数字员工及关联资源配置快照到Redis | R:SsResourceService,DigitalEmployeeApplicationService,DigEmployeeRedisSyncProperties,SsResource | A:- | S:ApplicationRunner,LOWEST_PRECEDENCE,CompletableFuture异步不阻塞启动,AtomicBoolean防重复,分页batchSize遍历,开关INIT_DIG_EMPLOYEE_REDIS_ENABLED,逐个syncQuietly容错
InitMinioBucketMountRunner.java[LFL5OT]: F:启动时初始化MinIO公共bucket并按存储形态决定rclone挂载 | R:ResourceFS.java,MinioConfig.java | A:- | S:ApplicationRunner最低优先级,storageType非minio跳过,volumeBackend=file仅建bucket不挂载,委托resourceFS.init,异常吞掉不阻断启动
InitRedisSystemConfigRunner.java[BCO5CM]: F:应用启动时加载系统配置/数据字典/启用模型/激活用户到Redis缓存 | R:SystemConfigApplicationService,SystemConfigListApplicationService,ByaiAimodelDomainService,ByaiAimodelMapper,EnterpriseInfoService,UserService,ShareCacheUtil | A:- | S:ApplicationRunner启动钩子,enabled开关控制,分页批量加载用户带租户enterpriseId隔离,模型按OOA启用状态syncToRedis
InitUserResourcesAuthRedisRunner.java[LPE8ABM]: F:应用启动后异步全量将活跃用户权限资源加载至Redis缓存 | R:UserService,AuthApplicationService,AuthRedisApplicationService | A:- | S:ApplicationRunner+LOWEST_PRECEDENCE,AtomicBoolean防重,开关INIT_USER_AUTH_RESOURCES_REDIS_ENABLED,CompletableFuture异步,分页批量查活跃用户,逐用户buildUserAuthResources,Pipeline批量写Redis

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/aimodel/===
GptProxyChatCompletionsStreamApplicationService.java[SM9WM]: F:GPT-Proxy模型调试chat/completions流式代理服务,透传上游SSE并按结果更新模型状态 | R:ModelManagementApplicationService,SseEmitter,OkHttpClient/EventSource,BaseException,CommonErrorCode | A:- | S:OkHttp EventSource订阅上游SSE,SseEmitter回写前端,token仅服务端配置禁前端透传,[DONE]结束complete,onFailure按4xx/5xx分错码抛BaseException不透传堆栈,statusUpdated CAS保证状态仅更新一次(成功OOA失败OOD)
ModelDebugRerankApplicationService.java[SMO5FT]: F:模型调试RERANK代理服务,透传调用上游rerank接口返回结果(非流式) | R:RerankDebugResult,CommonErrorCode,BaseException,JsonUtil,OkHttpClient | A:- | S:OkHttp POST JSON,从input提取url/headers剩余作body,过滤host/content-length等敏感头,非2xx抛BaseException,日志脱敏仅打host
ModelManagementApplicationService.java[SMD7TEM]: F:模型管理应用服务,编排列表/upsert/删除/状态/详情/调试与默认模型设置,apiToken国密加密存储 | R:ByaiAimodelDomainService,ByaiTagRelationService,SsResExtDigEmployeeMapper,Sm4Util,ModelStatusEnum,ModelUpsertRequest,ModelVO | A:- | S:事务编排,SM4加密解密回显,token掩码,in_params扩展字段双向映射,名称唯一性校验,启用中数字员工占用拦截,默认对话标签tag_relation先删后插同步,abilities一体化保存
RerankDebugResult.java[ABMQS]: F:RERANK调试代理响应结果(状态码/ContentType/响应体原文)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/app/===
AppAuthApplicationService.java[SAU8JM]: F:APP端RefreshToken静默登录应用服务,验证刷新令牌并重建会话签发新双令牌与ssoToken | R:JwtService,SsoTokenService,LoginApplicationService,CurrentUserHolder,LoginInfo,AppRefreshTokenLoginRequest,ResponseUtil | A:- | S:verifyJwt校验refreshToken,getLoginInfo重取用户,getSession(true)建会话+shareSession共享,createJwt/generateRefreshJwt签发新令牌,createSsoToken,LoginInfo转Map合并token字段返回

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/auth/===
AuthApplicationService.java[SAPME9]: F:认证授权应用服务,资源成员管理/使用申请审批/红黑名单授权对比/权限继承/用户权限Redis同步 | R:PrivilegeGrantService,AuthRedisSyncService,AuthRedisApplicationService,OrganizationService,PositionService,StationService,SsResourceService,PrivilegeGrantMapper,UsersMapper,CurrentUserHolder,RedisUtil | A:- | S:buildUserAuthResources红减黑构建用户资源权限映射,handleAuth红黑名单CompareVo增删改差异同步,applyUse/approve/reject使用申请审批流,setResourceManagers/Users成员设置,ensureUsePrivilegeForAllowManageTargets管理权限隐含FORCE_USE,同维度去重hasSameDimensionPermissionFamily,@Async批量同步afterCommit事务回调,queryResourceOperationPermissions六项操作权限,多租户隔离
AuthRedisApplicationService.java[SAU8CM]: F:用户资源权限Redis Hash缓存服务,管理USER:RESOURCES:AUTH:{userId}的读写删与权限校验 | R:RedisUtil,StringRedisTemplate | A:- | S:Hash存resourceId→resourceType,writeUserAuth先清后写,Pipeline批量写多用户(delete+putAll)失败降级逐条,hasResourcePermission/getResourceType按字段查,clearUserAuth删key
AuthRedisSyncAsyncConfig.java[GAUTH3AT]: F:授权Redis同步异步线程池配置 | R:- | A:- | S:ThreadPoolTaskExecutor,core4/max8/queue512,authRedisSyncExecutor,优雅关闭等待
AuthRedisSyncService.java[SS5ABM]: F:用户权限异步同步至Redis服务,批量/单个/授权变更场景 | R:AuthApplicationService,AuthRedisApplicationService,AuthRedisSyncAsyncConfig,DigEmployeeChangeEventPublisher | A:- | S:@Async专用执行器线程池,批大小100分批,buildUserAuthResources构权限再writeUserAuth,成功失败计数日志,@Lazy避免循环依赖,数字员工元数据变更走PubSub不经此
AuthSearchApplicationService.java[SAU7KM]: F:权限综合搜索应用服务,跨组织/用户/岗位/驻地分页查找及按用户ID批量获取组织路径信息 | R:OrganizationService,UserService,PositionService,StationService,UsersOrganizationService,UserOrganizationDTO,QueryObject,PageHelperUtil | A:- | S:LambdaQueryWrapper关键字like模糊查询,findAll聚合四类结果,buildPathNameByOrgIds构建组织路径,findOrganizationsWithPathNames批量查询,按userId分组空格拼接pathCode/pathName,ACTIVE状态过滤

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/conversation/===
ConversationExportService.java[SS5BL]: F:对话消息导出Excel服务,分页查询消息列表生成POI工作簿并写入HTTP响应,支持中英文国际化表头/反馈类型转换 | R:ConversationService,ByaiSystemConfigListService,MessageQo,MessageDto,I18nUtil,Constants | A:- | S:XSSFWorkbook,分页1000条最大8000,标题/表头/数据样式,反馈标签映射转换,LocaleContextHolder判英文,URLEncoder文件名,switch反馈类型,15列固定字段
ConversationService.java[SAC7PM]: F:会话消息检索与反馈处理服务,数字员工/超级助手聊天记录分页查询、来源渠道/反馈类型字典、用户反馈消息指派处理 | R:AuthApplicationService,ByaiMessageRelObjService,UserService,ByaiSystemConfigListService,SuasSuperassistMapper,FeedbackMsgInfoMapper,CurrentUserHolder | A:- | S:judgePrivForList按业务管理员/平台运维三层授权过滤resObjId,setSearchQuery构建MemRelSearchRequestDto走Feign searchMem,buildMessageRes补反馈处理人信息,handleFeedbackMsg幂等更新/插入FeedbackMsgInfo,i18n反馈类型本地化

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/digitemploy/===
DigEmployeeRedisSyncProperties.java[GEMP3CT]: F:数字员工Redis同步配置开关 | R:- | A:- | S:@ConfigurationProperties前缀byai.dig-employee,jsonRedisSyncEnabled控制DIG_EMPLOYEE_全量JSON同步Redis
DigitalEmployeeApplicationService.java[SEM9RML]: F:数字员工全生命周期编排(增删改查/默认助理设置/超级助手创建/审核/JSON多态存储同步/技能Redis缓存/调试会话/钉钉机器人注册) | R:SsResExtDigEmployeeService,SsResourceService,SsResourceRelDetailService,ResourceArtifactStorageService,MemoryLibraryApplicationService,AuthApplicationService,SuasSuperassistService,DigEmployeeChangeEventPublisher,DingtalkRobotRegistryService,FeignPythonToolService via feign:digitalEmployeeAudit,DigEmployeeRedisKeys,RedisUtil | A:- | S:三态存储(minio/nfs)同步资源JSON至MinIO+target_content镜像+Redis,运行时计算tagName,owner_type个人/企业隔离,默认助理仅维护suas_superassist.default_dig_employee_id,软删除REMOVED+回退受影响用户默认,关联资源JSON补齐,商业版WHALE_AGENT校验,事务+afterCommit事件发布
MetaPromptService.java[SEM7WL]: F:数字员工元提示词生成服务,基于用户描述与平台可用资源调用LLM一次性生成智能体角色描述/人格定义/核心能力等13个配置字段,支持同步与SSE流式两种输出 | R:AIService,ResourceAuthApplicationService,ByaiSystemConfigService,MetaPromptGenerateRequest,MetaPromptGenerateResult,ResourceAuthVo,ResourceUseAuthQo | A:- | S:Semaphore限流并发6,资源按TOOLKIT/MCP/KG/AGENT/OBJECT/VIEW分组构建上下文,内置中英双语SystemPrompt,FieldSpec硬编码字段规范,extractJsonObject解析LLM返回JSON,SSE手写event/data帧,意图路由区分度导向

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/digitemploy/event/===
DigEmployeeChangeAuthRefreshService.java[SEM7AAM]: F:数字员工变更时按资源维度展开红名单授权对象(用户/组织/岗位/工位)并批量触发用户权限Redis重建 | R:PrivilegeGrantService,UserService,UsersMapper,AuthRedisSyncService,DigEmployeeChangeNotifyProperties | A:- | S:@Async异步,可配置开关默认关闭,授权对象类型分流展开聚合userIds,asyncSyncAuthChangedUsers触发,多租户隔离
DigEmployeeChangeConfiguration.java[GEM3RT]: F:数字员工变更Stream配置类,启用配置属性并注册默认本地用户注册表Bean | R:DigEmployeeChangeNotifyProperties,DigEmployeeRedisSyncProperties,DigEmployeeChangeLocalUserRegistry | A:- | S:@Configuration+@EnableConfigurationProperties,@ConditionalOnMissingBean条件Bean,empty()空注册表
DigEmployeeChangeEvent.java[DEMARS]: F:数字员工变更事件载荷(Pub/Sub消息体或Stream payload结构)
DigEmployeeChangeEventPublisher.java[SEM9RAL]: F:数字员工变更事件Redis Pub/Sub广播,事务提交后或立即发布并触发授权刷新 | R:DigEmployeeChangeEvent,DigEmployeeChangeEventType,DigEmployeeChangeNotifyProperties,DigEmployeeChangeAuthRefreshService,ResourceBizTypeEnum via redis:pubsubChannel | A:- | S:StringRedisTemplate.convertAndSend,事务同步afterCommit,无事务则立即发布,publishNowQuietly异常仅打日志,authRefresh异步刷新被授权人
DigEmployeeChangeEventType.java[KEMP 3AT]: F:数字员工变更事件类型枚举(更新/删除/技能同步/创建),写入Redis Stream通知载荷 | R:- | A:- | S:UPDATED/DELETED/SKILLS_SYNCED/CREATED四态,异步事件标识
DigEmployeeChangeLocalUserRegistry.java[SEM3RT]: F:本Pod内关心数字员工变更的用户集合注册接口,供Stream消费端做授权过滤 | R:- | A:- | S:函数式接口,getLocallyTrackedUserIds返回不可变用户ID快照,empty默认空实现,租户/用户隔离
DigEmployeeChangeNotifyProperties.java[GEMP5RT]: F:数字员工变更通知Redis Pub/Sub配置项 | R:DigEmployeeChangeNotifyListener,StringRedisTemplate | A:- | S:@ConfigurationProperties前缀byai.dig-employee-change,publishEnabled发布开关,pubsubChannel频道byai:pub:dig_employee_change,authRefreshEnabled异步刷新USER:RESOURCES:AUTH,内部Subscriber订阅开关

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/ecosystem/===
EcosystemArtifactStorageService.java[SF7OMM]: F:生态采集产物落地服务,将OpenCLI采集结果(Markdown/附件/raw/manifest)写入统一文件存储并同步files表元数据 | R:FileIngressService,FilesMapper,SequenceService,OpenCliRunner,EcosystemTaskVo,EcosystemRunVo,FileStorageContext,MultipartFileUtil | A:- | S:按用户隔离对象存储路径ecosystem/users,序列生成fileId,produces MARKDOWN/ASSET/RAW/MANIFEST四类产物,knowledgeBase时关联datasetId,JSON序列化manifest,文件名清洗去非法字符,MIME推断兜底
EcosystemBrowserBridgeService.java[SK7RWM]: F:用户本机Browser Bridge长连接采集服务,处理任务下发/租约/进度/结果回传/断线恢复 | R:MultiDeviceBroadcastService,EcosystemArtifactStorageService,EcosystemKnowledgeImportService,OpenCliCapabilityService,OpenCliRunner,SequenceService,EcosystemRunVo,EcosystemTaskVo,EcosystemSignalVo,JdbcTemplate | A:- | S:WS广播ECOSYSTEM_BRIDGE任务,UUID租约TTL120s+续租/校验/过期重排,JdbcTemplate直写bykc_ec_sync_run/step/artifact/signal/import_record,JSONB-payload,collectMode区分浏览器桥/服务端OpenCli,mail/web/zhihu命令编排,allowedHosts白名单校验,markdown归一化+资产Base64落临时盘,定时recoverExpiredLeases,daily/weekly下次调度计算,按created_by用户隔离,FOR UPDATE行锁
EcosystemCollectionApplicationService.java[SK7QSM]: F:生态采集P0应用服务,编排OpenCLI采集/产物落地/Markdown知识库入库/运行记录持久化/定时调度/聊天技能计划构建及确认卡片 | R:EcosystemCollectionSupport,OpenCliRunner,EcosystemArtifactStorageService,EcosystemKnowledgeImportService,EcosystemBrowserBridgeService,EcosystemConnectionService,EcosystemTaskService,OpenCliCapabilityService,DatasetApplicationService,SequenceService | A:/byaiService/ecosystemCollection/skill/start | S:JdbcTemplate直写bykc_ec_sync_run/run_step/artifact/import_record/artifact_signal,@Scheduled定时dispatchScheduledRuns含调度锁与租约恢复,@Transactional事务,startRunInternal主流程区分BrowserBridge与服务端OpenCLI模式,buildChatPlan/Skill归一化计划补连接器/知识库/缺失动作,门户绝对链接拼接(NGINX_PORT/beyond),个人知识库按create_by隔离,连接器编码推断,成功/失败步骤构造,信号入库
EcosystemCollectionSupport.java[SC5MTL]: F:生态采集服务抽象支撑基类,提供行映射/JSON序列化/调度时间计算/采集模式推导/凭据脱敏/信号构造等共用工具 | R:OpenCliRunner,EcosystemTaskCreateRequest,EcosystemConnectorVo,EcosystemAgentStatusVo,CurrentUserHolder,I18nUtil,JdbcTemplate | A:- | S:JdbcTemplate行映射器(task/run/connection/signal/agentStatus),JSONB反序列化,daily/weekly下次运行时间计算,SERVER_OPENCLI/BROWSER_BRIDGE采集模式推导,Token后四位脱敏,IMAP协议地址解析,文件名规范化,多租户用户上下文
EcosystemConnectionService.java[SCO7TEML]: F:生态采集连接配置/Browser Bridge心跳/连接器凭据托管服务,管理连接CRUD与登录态心跳并运行前临时注入凭据 | R:EcosystemCollectionSupport,OpenCliCapabilityService,SequenceService,EcosystemAgentHeartbeatRequest,EcosystemConnectorVo,EcosystemTaskVo,EcosystemAgentStatusVo | A:- | S:jdbcTemplate裸SQL操作bykc_ec_connection/collector_agent,JSONB存credential/runtime/site_sessions,Token脱敏last4+tokenConfigured标记,按created_by/user_id用户隔离,upsert心跳,findPreferredConnection优先READY,attachConnectionCredentialConfig凭据不写回任务表,@Transactional
EcosystemKnowledgeImportService.java[SKN5M]: F:生态采集Markdown导入知识库并触发索引构建 | R:DatasetApplicationService,EcosystemArtifactStorageService,MultipartFileUtil,EcosystemTaskVo,I18nUtil | A:- | S:解析knowledgeBaseResourceId/knowledgeBaseId,规范化目录路径,逐文件uploadFiles后按真实路径触发build索引,内嵌ImportResult结果类,i18n文案
EcosystemTaskService.java[SCT7TM]: F:生态采集任务服务,负责任务创建/列表查询/状态更新/定时调度抢占与任务配置读取,身份切换执行定时采集 | R:EcosystemCollectionSupport,EcosystemConnectionService,SequenceService,CurrentUserHolder,EcosystemTaskCreateRequest,EcosystemTaskVo | A:- | S:JdbcTemplate原生SQL+JSONB,@Transactional,created_by用户隔离,daily/weekly调度next_run_time抢占锁,runAsUser临时切LoginInfo,分层信号生成,运行时Profile固化
OpenCliCapabilityService.java[ST5CM]: F:OpenCLI能力目录服务,运行时动态发现站点/命令并构建虚拟连接器,按URL域名/中文别名/关键词推断站点并选择最优读命令 | R:EcosystemCollectionSupport,EcosystemConnectorVo,Environment | A:- | S:定时10分钟刷新快照(@Scheduled+双重检查缓存),进程调用opencli list -f json,JSON数组深度解析提取payload,命令评分选择read命令,内置中文站点别名映射(知乎/小红书/微博等),邮箱BrowserBridge连接器
OpenCliRunner.java[SK5SL]: F:OpenCLI生态采集运行器,执行外部命令采集web/知乎/IMAP邮件并归一化为Markdown条目与附件资产 | R:OpenCliCapabilityService,EcosystemTaskVo,I18nUtil,ObjectMapper,Environment | A:- | S:ProcessBuilder进程执行+超时控制,javax.mail-IMAP邮件解析+Jsoup-HTML降级+附件落临时目录,JSON输出截取解析,正则提取知乎收藏夹/问题ID,临时输出目录+资产统计,失败分类needActionType(LOGIN/BROWSER_BRIDGE/EMPTY),内部类OpenCliException/CommandResult/CollectionResult/CollectionItem

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/event/base/===
BaseEventHandlerService.java[SCH8AT]: F:事件处理基类构建协议头元数据 | R:DateUtils | A:- | S:buildMetadata生成eventId(UUID)/eventType/eventTime/source/version1.0,事件分发基础

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/event/===
DomainEventListener.java[LL7AM]: F:领域事件监听器,统一分发用户/组织/资源目录的增删改领域事件到对应处理服务 | R:UsersEventHandlerService,OrganizationEventHandlerService,ResourceCatalogEventHandlerService,UsersCreatedEvent,OrganizationCreatedEvent,ResourceCatalogCreatedEvent | A:- | S:Spring @EventListener注解监听,按事件类型路由,同步事件处理

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/event/handler/===
OrganizationEventHandlerService.java[LOR7AM]: F:组织增删改事件处理器,构建metadata+payload并发布到Kafka组织主题 | R:BaseEventHandlerService,ZlogAdapter,OrganizationCreatedEvent,OrganizationEventType | A:- | S:监听组织CRUD领域事件,组装ImmutableMap载荷,JSON序列化后send到organization-events主题,zlogAdapter空判跳过
ResourceCatalogEventHandlerService.java[LL5AM]: F:资源目录领域事件处理,将增删改事件同步至Kafka资源主题 | R:BaseEventHandlerService,ZlogAdapter,ResourceCatalogCreatedEvent,ResourceCatalogUpdatedEvent,ResourceCatalogDeletedEvent,ResourceCatalogEventType | A:- | S:监听create/update/delete三类事件,buildMetadata构造元数据,封装payload经ZlogAdapter发送resource-catalog-events主题,zlogAdapter为空则跳过
UsersEventHandlerService.java[LAU5AM]: F:用户增删改事件处理器,构建用户信息payload并同步推送Kafka用户主题 | R:BaseEventHandlerService,ZlogAdapter,UsersCreatedEvent,UsersUpdatedEvent,UsersDeletedEvent,Users,UsersOrganization,UsersEventType | A:- | S:监听用户领域事件,buildMetadata+buildUsers组装JSON,send到user-events topic,zlogAdapter空则跳过,fastjson序列化

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/files/===
FilesApplicationService.java[SFI8OL]: F:文件应用服务,会话/知识库文件上传下载、标签增删、图标上传、预览下载及存储三态路径兼容兜底 | R:FilesService,FileIngressService,CommonFileStorage,CommonFilePathResolver,UserBucketNamingService,SequenceService,SystemConfigService,CurrentUserHolder | A:- | S:uploadFiles/preUploadFile/uploadIcon多场景上传,MinIO/UserFS路径兜底(stripBucketPrefix/prefixUserFsRootPath /by根),add/deleteFileTags标签集合运算,downloadFiles/preview/download流式输出,按当前用户隔离桶名

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/job/===
OnlineUserRefreshJob.java[SA5CL]: F:在线用户定时清理任务,每5分钟检查活跃键过期并从在线集合移除离线用户 | R:RedisUtil,Constants | A:- | S:@Scheduled-cron可配,Redis分布式锁防集群重复执行,UUID锁值,ONLINE_USERS_SET_KEY集合遍历校验USER_ACTIVE_PREFIX活跃键

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/login/===
AppleLoginService.java[SAU8EL]: F:苹果Sign In with Apple登录服务,验证identity token并提取用户信息,管理绑定流程 | R:UserService,UserApplicationService,RedisUtil,BaseException,I18nUtil | A:- | S:JWT头部解析取kid,从appleid.apple.com/auth/keys拉公钥,支持ES256(P-256曲线)/RS256公钥构建,校验issuer/audience(多clientId分号),Redis存600s绑定token,手机号绑定/注册iOS用户
AppleLoginSessionService.java[SAU8JM]: F:苹果登录绑定成功后创建登录会话,生成session/JWT/SSO令牌并返回登录响应 | R:LoginApplicationService,JwtService,SsoTokenService,SuasSuperassistApplicationService,UserApplicationService,LoginLogApplicationService,UserService | A:- | S:获取或创建HttpSession,构建LoginInfo设登录类型APPLE,初始化超级助手知识库,共享session,CurrentUserHolder设当前线程,createJwt/RefreshJwt/SsoToken,saveSuccessLog,更新最后登录时间
AuthRequestFactory.java[SADA3T]: F:第三方OAuth登录请求工厂,按社交类型(微信/钉钉)构造AuthRequest | R:JustAuth(AuthConfig/AuthRequest),BaseException,I18nUtil | A:- | S:switch分发socialType,目前仅占位未实现,默认抛50500未找到配置异常
CaptchaService.java[SSE9EM]: F:图形/短信验证码生成与校验 | R:AliyunSmsService,SafeAccountMsgService,SmsRateLimitConfig,Sm4Util,AesUtils,RedisUtil,SequenceService,ValidateCode | A:- | S:图形码4位存session2分钟过期,短信码6位SM4加密入库,手机号AES解密,Redis按IP+类型限频,重复发送间隔校验,登录/注册模板区分
LoginApplicationService.java[SAa9JAM]: F:登录应用服务,组装登录信息/会话共享/当前用户解析/登出/系统配置开放查询 | R:UserService,SuasSuperassistService,OrganizationService,PrivilegeGrantService,JwtService,SandboxService:SandboxService,AuthRedisSyncService,LoginLogService,RedisUtil,SystemConfigService | A:- | S:Session+JWT(Beyond-Token)双登录态解析,shareSession写门户共享键,异步线程池启动沙箱+同步权限到Redis,登出清在线集合/活跃键并invalidate,openKeys白名单控制免登配置查询,多租户enterpriseId隔离
SocialApplicationService.java[SA5JS]: F:第三方社交登录服务,处理OAuth二维码生成/授权回调/单点登录地址获取 | R:AuthRequestFactory,SourceSystemService,LoginResponse,ResponseUtil,I18nUtil | A:- | S:JustAuth-AuthRequest,授权码state校验,QrCodeUtil生成二维码(local文件/流输出),SSO地址appKey/redirectUri占位替换

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/log/===
LogExceptionInfoApplicationService.java[SAU5T]: F:异常日志应用服务,封装公共字段填充并持久化 | R:LogExceptionInfoService,SequenceService,IpUtil,CurrentUserHolder,LogExceptionInfo | A:- | S:雪花ID生成requestId,填充sysCode/IP/用户/会话信息,委托领域服务save
LoginLogApplicationService.java[SAU5M]: F:登录日志应用服务,记录登录成功/失败日志并解析操作系统/浏览器/IP/会话信息 | R:LoginLogService,LoginLog,IpUtil,StringUtil | A:- | S:saveSuccessLog/saveFailLog,UserAgentUtil解析UA,优先sec-ch-ua-platform头取OS,status标识成败,记录sessionId
TrackLogApplicationService.java[SA5BM]: F:埋点日志应用服务,单条/批量/URLEncode-GET方式保存前端埋点 | R:TrackLogService,SequenceService,CurrentUserHolder,IpUtil,BatchTrackLogDto,TrackLog | A:- | S:雪花ID生成,提取IP/UA/OS,当前用户隔离,URLDecode+JSON解析批量入库

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/memory/===
MemoryLibraryApplicationService.java[SKN7M]: F:记忆库应用服务,数字员工记忆库创建/获取及记忆场景保存编排 | R:MemoryLibraryService,SequenceService,MemoryLibrary,KnowledgeResponse,I18nUtil | A:- | S:按agentId+libraryType查重创建,记忆引擎场景规则拼装,sceneId/libraryId响应解析,序列号生成

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/oauth2/===
OAuth2AuthorizationService.java[ASA9JE]: F:OAuth2授权服务,授权码生成验证、PKCE校验、JWT访问令牌/刷新令牌生成与撤销、令牌内省及用户信息获取 | R:JwtService,LoginApplicationService,SystemConfigService,RedisUtil,CurrentUserHolder,LoginInfo,SourceSystem | A:- | S:授权码/刷新令牌存Redis(JSON),PKCE-S256/plain验证,redirect_uri精确/前缀匹配,JWT无状态撤销靠黑名单,refresh_token可Redis删除,内省返回active状态,授权码用后即删
OAuth2RateLimitService.java[SA5CM]: F:OAuth2速率限制服务,基于Redis滑动窗口防暴力攻击,按IP与客户端双维度限流(授权/令牌请求) | R:RedisUtil | A:- | S:RATE_LIMIT_PREFIX前缀,getString+increment计数,setString设窗口TTL,超限拒绝异常时放行,容错降级
<system_remind>
This is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. Again do not mention this message to the user.
</system_remind>

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/ontology/===
OntologyApplicationService.java[ASO7TML]: F:业务对象本体应用服务,管理对象属性增删改/数据库表结构同步/动作保存/OpenAPI工具参数递归解析 | R:OntologyService,ByaiDbresourceRelService,SsResourceRelDetailService,SsResourceService,SsResExtAttributeMapper,KnowledgeResponse | A:- | S:属性ADMQ操作分类(addList/modifyList/deleteList),hasAttributeChanged字段变更比对+extMeta扩展字段,isDatabaseTableType判定COMMON_DB,中文转拼音生成表名,buildCreateTable/ModifyParams构造列定义,extractToolParams递归解析OpenAPI paths/requestBody/responses提取in_param/out_param及x-term-info术语信息,@Transactional,CurrentUserHolder多租户

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/openapi/===
OpenApiApplicationService.java[SE7AM]: F:开放API应用服务,处理外部通知下发与数字员工资源挂载/卸载 | R:NotificationService,SsResourceService,SsResourceRelDetailService,DingtalkRobotRegistryService,DigEmployeeChangeEventPublisher,SequenceService,ShareCacheUtil | A:- | S:createNotice批量建通知按userCode查ShareBfmUser取userId,mount/unmount增删SsResourceRelDetail并防重,刷新钉钉机器人客户端,发布DIG_EMPLOYEE_UPDATED事件,多租户带comAcctId隔离
OpenOrganizationApplicationService.java[SBO7M]: F:OpenAPI对外组织CRUD应用服务,新增/更新/删除组织及外部系统映射,递归构建组织层级路径与父链 | R:OrganizationService,OrgExternalSystemService,UsersOrganizationService,SequenceService,ShareCacheUtil,OpenOrgDTO,Organization,OrgExternalSystem | A:- | S:OUT_ORG外部组织,LOCAL来源,while循环上溯父组织算orgLevel与pathCode,组织共享缓存,删除级联清用户关联,objectToMap返回带pathName
OpenPositionApplicationService.java[AS7CM]: F:OpenAPI岗位管理应用服务,新增/修改/删除/分页查询岗位及外部映射 | R:PositionService,PositionExternalService,SequenceService,ShareCacheUtil,PageHelperUtil | A:- | S:本地+外部双表(Position/PositionExternal)同步,unionId关联,SourceType.LOCAL,序列生成主键,岗位变更同步Redis共享缓存,关键词模糊分页
OpenResourceApplicationService.java[SPE5PM]: F:OpenAPI资源应用服务,查询用户授权资源(自建/被授权)并扩展DOC知识库类型 | R:AuthApplicationService,SsResourceService,PrivilegeGrant,CurrentUserHolder | A:- | S:OWNER_CREATE按创建人查,否则经授权列表取resourceIds过滤,DOC扩展KG_DOC/KG_TERM/KG_QA,分页查询带用户隔离
OpenStationApplicationService.java[SO7MS]: F:外部接口驻地(站点)增删改查应用服务,递归构建驻地层级路径 | R:StationService,SequenceService,CurrentUserHolder,OpenStationDTO,Station,PageHelperUtil | A:- | S:递归buildStationPath拼-1.父.子路径,序列生成主键,租户comAcctId隔离,关键字分页查询
OpenUserApiApplicationService.java[SAU5ME]: F:开放API员工管理应用服务,新增/更新/删除员工及组织岗位关联 | R:BaseUserApplicationService,UserService,UserExternalSystemService,UsersOrganizationService,OrgExternalSystemService,PositionExternalService,UserBucketProvisioningService,SequenceService,Sm4Util,MD5Utils | A:- | S:Sm4手机号加密+MD5默认密码,unionId映射本系统orgId/positionId,删除为软删除置DISABLED,新增后异步初始化MinIO桶,多租户外系统映射
**修正标签[SAU5ME]→[SAU5ME]**: A=S(Service) B=AU(AUTH偏弱,实为用户管理→无ORG专属,取AUTH) C=5 D=ME(多租户+加密) E=M

OpenUserApiApplicationService.java[SAU5ME]: F:开放API员工管理应用服务,新增/更新/删除员工及组织岗位关联 | R:BaseUserApplicationService,UserService,UserExternalSystemService,UsersOrganizationService,OrgExternalSystemService,PositionExternalService,UserBucketProvisioningService,SequenceService,Sm4Util,MD5Utils | A:- | S:Sm4手机号加密+MD5默认密码,unionId映射本系统orgId/positionId,删除为软删除置DISABLED,新增后异步初始化MinIO桶

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/operations/===
EvaluationManager.java[SEM7L]: F:数字员工评估管理器,立即评估并按基准值比对各项指标(测试集准确率/对话异常率/首词响应时长/人设规范度/能力岗位匹配/实际准确率)判定是否合格上岗 | R:SsResExtEvaluateService,OperationsQueryService,SystemConfigService,ByaiMessageRelObjService,SsResExtTestSetService,MonitorTargetMapper,SsResourceMapper,I18nUtil | A:- | S:getEvaluateConfigMap读系统配置基准,ES指标查询计算异常率/准确率,评估值入库SsResExtEvaluate,六项checkXxxMatch比对生成i18n不合格详情
OperationsDigEmployeeService.java[SAE7FL]: F:数字员工运营数据分析,含基本信息/使用-技术-准确率指标计算/资质评估/测试集上传与批次结果回传 | R:SsResourceMapper,ByaiMessageRelObjService,OperationsQueryService,SsResExtEvaluateService,SsResExtTestSetService,EvaluationManager,FilesApplicationService,FeignPythonToolService via feign:python | A:- | S:ES指标查询满意度/Token速率/准确率换算,Feign调python上传Excel提交任务/查批次进度/下载报告,MinIO存测试报告,任务指派卡片构建,事务NOT_SUPPORTED

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/organization/===
OrganizationApplicationService.java[SS7PAM]: F:组织应用服务,组织树查询/CRUD/从组织选成员添加,含权限校验与事件发布 | R:OrganizationService,UserService,UsersOrganizationService,OrganizationMapper,ShareCacheUtil,CurrentUserHolder,OrganizationCreatedEvent | A:- | S:getOrgTree按myFlag取当前用户组织/pathCode回溯上级,addUserByOrg按ORG/USER类型批量挂载,batchHandle校验平台管理员/组织管理员/平台角色权限,增删改发布领域事件并刷新ShareCache,多租户隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/permissiongroup/===
PermissionGroupApplicationService.java[SSP5PM]: F:权限组应用层编排,封装权限组/授权对象/排除对象/数据权限/资源权限的增删改查与平台管理员校验 | R:PermissionGroupService,CurrentUserHolder,ResponseUtil,PageHelperUtil,BaseException | A:- | S:统一try-catch转BaseException,checkPermission仅平台管理员可操作,分页查询委托domain层,租户/用户隔离查权限组目录与维度权限校验
PermissionGroupCategoryApplicationService.java[SPE7PM]: F:权限组目录应用服务,编排目录增删改查与树形/分页查询并做平台管理员权限校验 | R:PermissionGroupCategoryService,CurrentUserHolder,ResponseUtil,PageHelperUtil,AddResultVO | A:- | S:queryCategoryPage/queryCategoryTree/getCategoryDetail/addCategory/updateCategory/deleteCategory,checkPermission仅平台管理员,统一异常转BaseException

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/position/===
DigitalPositionApplicationService.java[MP5PM]: F:数字岗位应用服务,管理数字岗位CRUD及岗位-用户绑定/解绑、岗位领域关联、岗位管理员分页查询 | R:PositionService,OrganizationService,SequenceService,UserApplicationService,PositionMapper,PositionExtCatalogMapper,PositionUserRelationMapper,ResourcePositionRelationMapper,SsResourceCatalogMapper,UsersMapper,CurrentUserHolder | A:- | S:平台管理员权限校验,领域内岗位名重复校验,批量插入岗位领域/用户关系,删除前校验用户/资源关联,手机号解密脱敏,组织路径名构建,分页
PositionApplicationService.java[ASP7PM]: F:岗位应用服务,岗位增删改查及岗位下用户列表查询 | R:PositionMapper,PositionService,OrganizationService,UserApplicationService,ShareCacheUtil,CurrentUserHolder | A:- | S:平台管理员权限校验,岗位CRUD同步Redis,用户列表手机号解密脱敏与组织路径拼装,分页查询
ResourcePositionRelationApplicationService.java[SAP7PM]: F:数字员工与数字岗位绑定关系应用服务,管理绑定/解绑/上岗/下岗及评估查询 | R:PositionService,ResourcePositionRelationMapper,SsResourceMapper,EvaluationManager,SsResExtEvaluateService,PositionExtCatalogMapper,PositionUserRelationMapper,SequenceService,CurrentUserHolder | A:- | S:平台管理员权限校验,领域catalogId匹配校验,上岗前immediatelyEvaluate评估,状态机ON/OFF/REFUSE_JOB,分页查岗位下数字员工

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/resource/===
AgentResourceService.java[SEM7CBM]: F:数字员工资源信息聚合服务,批量装配Agent对话所需的关联资源(知识库/MCP/视图对象/工具/插件/子智能体)、prologue开场配置与模型运行配置 | R:AgentBuildService,AiModelService,SsResourceRelDetailService,SsResourceMapper,SsResExtDigEmployeeMapper,SsResExtMcpServerMapper,AgentResourceChatInfoDto,AgentPrologueDto,RunConfig,McpServer,ModelDto | A:- | S:批量查询规避N+1,@Cacheable缓存扩展/prologue/模型,按ResourceBizType分组装配,JSON解析RelResourceInfo/prologue,coreCompetencies优先兼容历史intro,generateRunConfig容错不报错,租户资源隔离OwnerType个人默认放行未上架

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/staticdata/===
PropertyApplicationService.java[ASYS5T]: F:查询env开头的环境配置项(单个/批量) | R:ApplicationContextUtil,ResponseUtil,PropertyDTO,BatchPropertyDTO | A:- | S:仅放行env前缀key,ApplicationContextUtil.getEnvProperty取值,批量遍历填Map
StaticDataQueryApplicationService.java[ASYS5CT]: F:前端静态参数查询应用服务,按编码查单项配置及按分组查配置列表 | R:SystemConfigService,ByaiSystemConfigListService,RedisUtil,I18nUtil,RedisConfig | A:- | S:优先Redis缓存读取再落库,中英文按language切换显示名,结果映射为兼容旧接口的Map列表
SystemConfigApplicationService.java[SS5CM]: F:系统配置应用服务,CRUD并同步Redis哈希缓存 | R:SystemConfigService,SequenceService,RedisUtil,RedisConfig,SystemConfigQo,SystemConfigVo,ByaiSystemConfig | A:- | S:分页查回填cacheJson,新增/更新校验paramCode唯一,删除清缓存,clearOne/loadAll刷缓存,SYSTEM_CONFIG_CODE_KEY
SystemConfigListApplicationService.java[ASS5CM]: F:系统配置列表应用服务,分组CRUD与Redis缓存同步 | R:ByaiSystemConfigListService,SequenceService,RedisUtil,RedisConfig,SystemConfigListDTO,SystemConfigListGroupVo | A:- | S:分页查分组并附缓存JSON,新增/更新重复校验,update按paramId diff增删改,删除清缓存,单组/全量刷缓存groupingBy

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/superassist/===
SuasSuperassistApplicationService.java[SES7M]: F:超级助手编排服务,登录时初始化用户默认个人知识库与默认超级助手数字员工(幂等复用) | R:SuasSuperassistService,SsResourceService,SsResourceMapper,DatasetApplicationService,DigitalEmployeeApplicationService,CurrentUserHolder | A:- | S:createDatasetIfNotExists入口,resource_code={userCode}_main锚点反查防重建,owner_type=PERSONAL_DEFAULT校验,WHALE_AGENT跳过知识库初始化,不覆盖用户手选默认助理,throwExceptions兜底

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/system/===
SystemFeedbackApplicationService.java[SS5OM]: F:系统反馈应用服务,保存反馈及上传反馈附件文件 | R:SystemFeedbackService,AttachFileService,SequenceService,CommonFileStorage,CommonFilePathResolver,CurrentUserHolder,IpUtil | A:- | S:BeanUtils拷贝DTO,记录IP/UA/邮箱,pending状态,附件关联tablePkValue,MinIO写入feedback路径,按用户code隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/template/===
TemplateRuleInfoApplicationService.java[SS5TM]: F:模板规则与场景应用服务,管理记忆模板/超级助手场景与资源模板关联关系的增删改查 | R:TemplateRuleInfoService,ResourceTemplateRelationService,MemoryLibraryApplicationService,SequenceService,TemplateRuleInfoMapper,CurrentUserHolder | A:- | S:创建模板写记忆库与场景,resourceId分页查询带memoryRuleId,增量同步场景到记忆引擎,删除/修改场景级联Feign,事务+用户隔离权限校验,I18n异常

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/token/===
UserAccessTokenApplicationService.java[STK5MS]: F:用户访问令牌应用服务,提供令牌列表查询/创建/移除 | R:UserAccessTokenService,CurrentUserHolder,PageHelperUtil,I18nUtil,Constants | A:- | S:UUID生成令牌,有效期100年,名称查重,列表脱敏不返token,移除校验userId归属,租户comAcctId隔离,分页LambdaQueryWrapper

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/user/base/===
BaseUserApplicationService.java[SAU8AM]: F:用户保存/更新后置处理基类(缓存刷新+超级助手初始化+事件发布) | R:ShareCacheUtil,SuasSuperassistService,EnterpriseInfoService,RoleService,OrganizationService,PositionService,SystemConfigService,RsaDecrypt,UsersCreatedEvent,UsersUpdatedEvent | A:- | S:saveUserAfter/updateUserAfter写共享缓存,补全UsersOrganizationVo角色岗位组织名,RSA解密默认密码,initSuasSuperassist按userId建超级助手,publishEvent发布创建/更新事件,多租户enterpriseId隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/application/service/user/===
FileStorageUserSpaceProvisioner.java[SFI5MM]: F:为挂载文件系统存储模式按用户创建个人空间目录(by私有工作区) | R:- | A:- | S:fileRoot配置注入,路径规范化与防穿越校验,Files.createDirectories创建by子目录,数据随人走多租户隔离
UserApplicationService.java[SCO9PEM]: F:用户应用服务,负责用户CRUD/密码管理/手机号/CAS/苹果登录注册/桶初始化/批量手机号重加密 | R:UserService,UsersOrganizationService,OrganizationService,SuasSuperassistService,UserBucketProvisioningService,SequenceService,UsersMapper,MD5Utils,Sm4Util,CurrentUserHolder | A:- | S:三层授权校验(平台/组织管理员),用户类型多选,SM4解密+MD5加盐加密,手机号脱敏,Base62生成iOS用户码,事件发布(UsersUpdated/Deleted),分页批量手机号重加密,MinIO桶静默初始化,多租户隔离
UserBucketNamingService.java[SF5OT]: F:统一生成用户默认桶名byclaw-{userCode}的命名服务 | R:UserBucketNameResolver | A:- | S:委托UserBucketNameResolver,集中桶名算法避免多处重复,按用户隔离MinIO存储
UserBucketProvisioningService.java[SF5OM]: F:用户默认存储桶初始化,按存储类型(MinIO/本地文件)映射用户编码到桶名并存在即跳过创建 | R:ObjectStorage,UserBucketNamingService,FileStorageUserSpaceProvisioner,StorageType | A:- | S:ensureUserBucketQuietly静默包装不阻断用户创建主流程,三态存储分支(minio调objectStorage.init/local调ensureUserSpace),按用户隔离数随人走,存储类型由file.storage.type配置切换
UserMailAccountApplicationService.java[SAU8ECM]: F:用户个人邮箱账号CRUD与默认账号管理,授权码SM4加密存储并同步运行时配置到Redis | R:UserMailAccountMapper,SequenceService,Sm4Util,CurrentUserHolder,StringRedisTemplate,UserMailAccountDTO,UserMailAccountVO | A:- | S:软删除deleteFlag,默认账号唯一性clearOtherDefault,首账号自动设默认,删默认后ensureOneDefault补位,授权码last4脱敏与hasAuthCode回显,缓存key byai:user:mail_account:{userCode}存解密授权码,@Transactional,事务,用户隔离baseQuery

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/aimodel/enums/===
ModelStatusEnum.java[KMO3S]: F:模型状态枚举,API状态(ENABLED/DISABLED/TESTING)与库表状态码(OOA/OOX/OOD)双向映射 | R:- | A:- | S:toDbCode/toApiStatus双向转换,isEnabledDb判定启用态(OOA)需写Redis

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/aimodel/service/===
AiModelService.java[SM5CT]: F:AI模型查询服务,从Redis缓存读取模型列表/单个/按类型/默认对话模型 | R:ModelManagementApplicationService,ByaiAimodelDomainService,RedisUtil,JsonUtil,ModelDto | A:- | S:hmGetAll/hmGet读AI_MODEL_KEY与AI_MODEL_TYPE_KEY,JSON反序列化为ModelDto,默认模型经ApplicationService取modelId
AiPromptService.java[SMO5T]: F:智能体提示词模板查询服务,按分组编码查提示词列表 | R:AiPromptMapper,AiPrompt | A:- | S:LambdaQueryWrapper按promptGroupCode等值查询,selectList返回模板集合
AIService.java[SM5FT]: F:OpenAI规范文本生成服务,封装chat/completions调用 | R:AiModelService,ModelDto,I18nUtil | A:- | S:RestTemplate直连默认对话模型,system/user消息组装,Bearer鉴权X-CHANNEL=BYAI,enable_thinking=false,解析choices返回content
ByaiAimodelDomainService.java[SS5CM]: F:模型定义领域服务,分页查询/CRUD/状态切换并联动Redis缓存 | R:ByaiAimodelMapper,SequenceService,RedisUtil,Sm4Util,ModelDto,ModelStatusEnum,RedisConfig | A:- | S:PageHelper分页,upsert按id判增改,启用同步Redis停用移除,按modelType分组重建TYPE_KEY,SM4解密authToken,toModelDto格式兼容消费者

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/auth/enums/===
Color.java[KAUTH1T]: F:红黑名单颜色常量枚举 | R:- | A:- | S:RED红名单,BLACK黑名单,final私有构造
GrantStatusCd.java[KAUT1T]: F:授权状态码常量(有效A/挂起S/失效X) | R:- | A:- | S:final工具类私有构造,三态字符串常量
GrantToObjType.java[KAU1T]: F:授权目标对象类型常量(人员/组织/岗位/驻地/角色/管理组织/管理用户) | R:- | A:- | S:final工具类私有构造,USER/ORG/POST/STATION/ROLE/MAN_ORG/MAN_USER字符串常量
GrantToObjTypeMapping.java[KPER3S]: F:授权对象类型映射枚举,内部类型与外部系统类型互转 | R:GrantToObjType | A:- | S:USER→PERSON/ORG→ORGANIZATION等映射,getTargetType/getSourceType双向查找,isSupported校验,大小写不敏感
GrantType.java[KAUTH1S]: F:授权类型常量定义(使用/强制/管理/分享/归属授权) | R:- | A:- | S:final工具类,私有构造,5个String授权类型常量AVAILABLE_USE/FORCE_USE/ALLOW_MANAGE/SHARE_USE/OWNER
GrantTypeRangeMapping.java[KPER5T]: F:授权类型到权限范围标识的双向映射枚举(使用/强制/管理/分享/归属) | R:GrantType | A:- | S:grantType↔range双向查找,默认range=1,isSupported校验,用于构建权限授权Key的range部分
MessageContentTypeEnum.java[KCH3T]: F:消息内容类型枚举(文本/图表/卡片/思考过程/任务/通知等) | R:- | A:- | S:code-msg双字段,getByCode按code反查,涵盖会话流各类消息类型
OperType.java[KAUTH3PT]: F:权限操作类型常量(读/写) | R:- | A:- | S:final工具类私有构造,READ/WRITE字符串常量,权限校验用
ResourceTypeValueMapping.java[KPERM3PT]: F:资源类型到权限授权Value前缀映射枚举,构建{RESOURCE_TYPE}_{resourceId}格式 | R:ResourceBizTypeEnum | A:- | S:覆盖数字员工/知识库/MCP/工具/对象视图等资源类型,getValuePrefix忽略大小写匹配返回前缀,isSupported校验支持性

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/auth/service/===
PrivilegeGrantService.java[SP9PML]: F:权限授予核心服务,管理红黑名单授权/资源成员/数字员工三层授权及Redis权限缓存同步 | R:PrivilegeGrantMapper,SsResourceMapper,SequenceService,CurrentUserHolder,RedisUtil,PageHelperUtil | A:- | S:save/remove/update授权,removePriv撤权写黑名单并同步redis(DATASET:AUTHORITY前缀),addBlackPriviledge,buildPriv按OWNER/USE/MANAGE构建红黑DTO,findAllowManagePrivilegeGrant按用户查可管资源,queryManPrivMap聚合管理员,分页查授权资源/数字员工
ResourcePermissionScopeService.java[SPE8PML]: F:资源权限范围分析服务,基于红黑名单授权记录计算资源可见范围(仅个人/部分/全公司)并支持单条与批量分析 | R:PrivilegeGrantMapper,OrganizationMapper,UsersMapper,UsersOrganizationMapper,PrivilegeGrant,PrivilegeGrantWithOrgPath,PermissionDto | A:- | S:红黑名单分离,组织/岗位/驻地路径pathCode子级前缀匹配判黑名单,批量UNION查询用户减少DB访问,全公司判定parent_org_id=-1,多租户隔离,PermissionScope枚举(1/2/3)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/conversation/feedbackenum/===
FeedbackField.java[KCH3T]: F:会话反馈字段名枚举 | R:- | A:- | S:定义反馈类型/内容/评分/标记/标签字段名,提供全部字段名与点踩字段名列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/conversation/service/===
FeedbackMsgInfoService.java[SS5BT]: F:会话反馈消息信息CRUD服务,按反馈ID查询及批量保存 | R:FeedbackMsgInfoMapper,FeedbackMsgInfo | A:- | S:LambdaQueryWrapper按feedbackMsgId查列表,saveBatch批量插入,单条save/updateById

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/customer/model/===
CustomerLeadDto.java[DV5M]: F:客户线索列表数据传输对象,封装ByaiCustomerLeads集合

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/customer/service/===
CustomerLeadsService.java[SCO5BT]: F:客户线索新增与批量导入服务 | R:ByaiCustomerLeadsMapper,SequenceService,CurrentUserHolder,CustomerLeadDto | A:- | S:序列号生成ID,自动填充创建时间与当前用户手机号,批量空校验抛BaseException,i18n错误提示
FilesService.java[ESM7S]: F:文件元数据CRUD与上传文件记录创建,支持按标签匹配查询 | R:FilesMapper,SequenceService,CurrentUserHolder,Files,UploadFilesRespDto | A:- | S:selectByMatchTags按会话标签匹配,createUploadFile分配序列ID并填充上传人/类型/时间,MyBatisPlus单表操作

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/datacloud/enums/===
DataCloudPublishStatusEnum.java[KOB1T]: F:数据云发布状态枚举(未发布/已发布/草稿) | R:- | A:- | S:value整型映射,2/1/0三态

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/datacloud/service/===
DatacloudLoginTypeService.java[SDS7TMM]: F:数据云登录类型CRUD服务,JSON配置校验、状态启停、批量删除与脚本关联校验、统计查询 | R:DatacloudLoginTypeMapper,DatacloudLoginTypeDTO,DatacloudLoginTypeQueryDTO,DatacloudLoginTypeBatchDeleteQO,PageHelperUtil,ResponseUtil | A:- | S:LambdaQueryWrapper分页,雪花ID,enterpriseId企业隔离,fastjson配置解析,@Transactional,countScriptsByLoginType删除前置校验
DatacloudScriptCategoryService.java[SDS7TKM]: F:数据云脚本分类管理服务,树形分类CRUD/批量删除/统计 | R:DatacloudScriptCategoryMapper,DatacloudScriptCategoryDTO,DatacloudScriptCategoryBatchDeleteQO,ResponseUtil,PageHelperUtil | A:- | S:雪花ID主键,分类编码唯一校验,删除前校验子分类与关联脚本,批量删除按企业隔离防越权,@Transactional事务,分页统计childCount/scriptCount
DatacloudScriptExecutionService.java[SOB7TM]: F:数据云脚本执行记录CRUD与统计服务,管理执行状态/时长/JSON参数解析 | R:DatacloudScriptExecutionMapper,DatacloudScriptExecutionDTO,ResponseUtil,PageHelperUtil | A:- | S:分页/按脚本ID查询,增改删及批量删,取消运行中脚本,执行状态文本化,时长格式化,JSON字段校验解析,企业隔离,雪花ID,事务
DatacloudScriptScenarioConfigService.java[SS7TBM]: F:数据云脚本场景配置服务,保存/管理脚本步骤与目标脚本配置及分页查询 | R:DatacloudScriptMapper,DatacloudScriptStepMapper,DatacloudTargetScriptMapper,DatacloudScriptScenarioConfigDTO,CurrentUserHolder,PageHelperUtil | A:- | S:事务保存先更新脚本未发布状态再清旧配置重建步骤/目标,雪花ID,JSON序列化脚本内容/元信息,企业ID隔离,分页按stepOrder排序
DatacloudScriptScenarioService.java[SDS7MTL]: F:数据云脚本场景管理服务,提供场景树形结构/分页查询及增删改与级联删除关联脚本 | R:DatacloudScriptScenarioMapper,DatacloudScriptMapper,DatacloudScriptService,CurrentUserHolder,PageHelperUtil,ResponseUtil | A:- | S:雪花ID生成,场景编码租户内唯一校验,删除前校验子场景/关联脚本,批量删除联动DatacloudScriptService,@Transactional,enterpriseId多租户隔离
DatacloudScriptService.java[SO7IM]: F:数据云脚本采集管理服务,脚本CRUD/复制/发布及同步工具信息到ES供MCP检索 | R:DatacloudScriptMapper,DatacloudScriptStepMapper,DatacloudTargetScriptMapper,DatacloudLoginTypeMapper,ElasticsearchOperationsFactory,SystemConfigService,CurrentUserHolder | A:- | S:雪花ID,发布时构建SyncDataCloudToolInfo含code/input_schema/auth_config索引ES(upsert),取消发布删ES文档,租户用户隔离,metaInfos生成JSONSchema与Python代码,ES异常不阻断主流程
DatacloudScriptTemplateApplicationService.java[SOB7TM]: F:数据云脚本模板应用服务,封装模板增删改查/启停/重名校验等业务编排 | R:DatacloudScriptTemplateService,CurrentUserHolder,PageHelperUtil,ResponseUtil | A:- | S:分页/详情/保存/更新/删除/批量删/可用模板/状态切换/名称查重,参数校验,DTO实体互转,租户企业ID与创建人注入,事务保护
DatacloudScriptTemplateService.java[ASO7BM]: F:脚本模板业务接口,管理DataCloud脚本模板CRUD与状态/查重 | R:DatacloudScriptTemplate,DatacloudScriptTemplateQueryDTO | A:- | S:继承IService,分页查询,可用模板按类型/框架/企业过滤,启用禁用,名称重复校验,企业ID隔离
DataCloudScriptViewService.java[SOB7TML]: F:数据云脚本视图管理(分页查询/增改删/发布为MCP服务/取消发布) | R:DataCloudScriptViewMapper,SystemConfigService,CurrentUserHolder,AgtResource,AgtResourceDelete,ResponseUtil,MapParamUtil | A:- | S:租户+创建者双隔离查询,发布构建AgtResource调createMcpService绑定resourceId并置publishStatus=1,取消发布删MCP服务置0,事务回滚,雪花ID,权限校验仅改自己视图,MCP-URL取自系统参数UI_DATA_CLOUD_MCP
DatacloudTargetScriptService.java[ASO5KS]: F:数据云目标脚本场景配置分页查询 | R:DatacloudTargetScriptMapper,DatacloudTargetScript,DatacloudScriptScenarioConfigQueryDTO,PageHelperUtil,ResponseUtil | A:- | S:MyBatisPlus-LambdaQuery按scriptId过滤,targetOrder倒序,Page分页

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/datacloud/service/impl/===
DatacloudScriptTemplateServiceImpl.java[SOB7TML]: F:数据云脚本模板CRUD服务,分页查询/增删改/状态切换/名称查重 | R:DatacloudScriptTemplateMapper,DatacloudScriptTemplate,DatacloudScriptTemplateQueryDTO,I18nUtil,BaseException | A:- | S:MyBatisPlus ServiceImpl,雪花ID,事务回滚,企业ID隔离查询,名称唯一校验排除自身,可用模板自定义SQL查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/datacloud/service/vo/===
DatacloudScriptScenarioVo.java[DOBD5S]: F:数据云脚本场景VO,场景主键ID(Long转String序列化)
DatacloudScriptVo.java[DOB5S]: F:数据云脚本VO,封装脚本ID(Long转String序列化)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/enterprise/service/===
EnterpriseInfoService.java[SS5PM]: F:企业信息管理服务,提供企业信息增改查与Logo图片读写 | R:EnterpriseInfoMapper,EnterpriseInfo,CurrentUserHolder,ResponseUtil,I18nUtil | A:- | S:getEnterprise默认企业ID为1,editEnterprise需平台管理员权限,Logo以byte[]存库并以image/png流式输出,getEnterpriseId返回企业标识

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/event/===
AbstractDomainEvent.java[EC5AT]: F:领域事件抽象基类,封装事件类型(CREATE/UPDATE/DELETE) | R:ApplicationEvent | A:- | S:继承Spring ApplicationEvent,eventType标识增删改,Lombok生成读写器

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/event/catalog/===
ResourceCatalogCreatedEvent.java[ECB3AT]: F:资源目录创建领域事件 | R:SsResourceCatalog | A:- | S:继承ApplicationEvent,携带资源目录实体,事件驱动异步处理
ResourceCatalogDeletedEvent.java[EOB3AT]: F:资源目录删除领域事件,携带catalogId用于异步通知监听器 | R:ApplicationEvent | A:- | S:继承Spring ApplicationEvent,@Getter,构造传source与catalogId,事件驱动解耦目录删除
ResourceCatalogUpdatedEvent.java[ECOAT]: F:资源目录更新领域事件 | R:SsResourceCatalog | A:- | S:继承ApplicationEvent,携带资源目录信息,Spring事件发布

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/event/organization/===
OrganizationCreatedEvent.java[ESOAT]: F:组织新增领域事件,携带组织信息用于事件发布 | R:AbstractDomainEvent.java,Organization.java | A:- | S:继承AbstractDomainEvent,封装Organization,Lombok@Getter,事件溯源source
OrganizationDeletedEvent.java[ESO3AT]: F:组织删除领域事件 | R:ApplicationEvent | A:- | S:Spring事件,携带orgId,删除后异步通知
OrganizationUpdatedEvent.java[EORG3AT]: F:组织更新领域事件,封装组织信息用于事件发布 | R:Organization, ApplicationEvent | A:- | S:继承ApplicationEvent,Getter暴露organization,Spring事件机制异步通知

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/event/resource/===
ResourceShelfEvent.java[ECOAT]: F:资源上架领域事件,封装资源对象用于Spring事件发布订阅 | R:SsResource | A:- | S:继承ApplicationEvent,@Getter,构造传入SsResource,异步解耦上架后续处理
ResourceUnShelfEvent.java[ECO3AT]: F:资源下架领域事件 | R:SsResource,ApplicationEvent | A:- | S:Spring ApplicationEvent,携带SsResource,触发资源下架异步处理

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/event/user/===
UsersCreatedEvent.java[EAU3AT]: F:用户创建领域事件,携带用户及关联组织岗位信息 | R:Users,UsersOrganization,ApplicationEvent | A:- | S:继承Spring ApplicationEvent,@Getter,构造注入source/users/usersOrganizations,事件驱动异步处理
UsersDeletedEvent.java[EAUTH3AT]: F:用户删除领域事件,携带userId供监听器异步处理用户删除后续逻辑 | R:ApplicationEvent | A:- | S:Spring ApplicationEvent,@Getter,userId字段,事件源+用户标识构造
UsersUpdatedEvent.java[EAU3AT]: F:用户更新领域事件,携带用户及关联组织岗位信息 | R:Users,UsersOrganization | A:- | S:继承ApplicationEvent,@Getter,Spring事件机制,异步事件发布

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/file/service/===
CommonFilePathResolver.java[SFI5OS]: F:解析通用上传文件(图标/反馈附件)的存储位置定位符 | R:StorageLocation,WhaleAgentStorageService,Constants | A:- | S:NAMESPACE=common-file,icon公开分享类型,feedback/arbitrary按桶名定位,三态存储抽象
CommonFileStorage.java[SF5OT]: F:通用文件存储门面,封装对象存储读写 | R:ObjectStorage,StorageLocation | A:- | S:write字节流put到存储位置,read按location获取流,null字节防御,委托ObjectStorage三态兼容

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/login/model/===
ValidateCode.java[UAU3ET]: F:图形验证码生成器,绘制随机数字干扰线图片并输出PNG | R:- | A:- | S:SecureRandom随机数,160x40画布5位数字150条干扰线,SANS_SERIF逻辑字体,ImageIO写PNG流,createCode生成code字符串

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/login/service/===
LoginService.java[SAU5TT]: F:登录服务,获取系统登录类型配置 | R:SystemConfigService,Constants,ResponseUtil | A:- | S:依赖系统配置查询LOGIN_TYPE参数,非空返回登录类型否则空响应
SafeAccountMsgService.java[SA5M]: F:短信验证码消息持久化与查询服务,保存/更新短信记录、按手机号查未过期验证码及间隔时间内重复发送校验 | R:SafeAccountMsgMapper,SafeAccountMsg,DateUtils | A:- | S:LambdaQueryWrapper按phone+msgType+state+expireDate过滤,createDate倒序,间隔校验用addMinute负数

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/log/service/===
LogExceptionInfoService.java[SAU3T]: F:异常日志信息持久化保存 | R:LogExceptionInfo,LogExceptionInfoMapper | A:- | S:封装insert写入异常日志单方法服务
LoginLogService.java[SAUDIC5T]: F:登录日志记录与登出时间更新 | R:LoginLogMapper,LoginLog,SequenceService,StringUtil | A:- | S:saveLoginLog雪花ID插入,按sessionId更新logoutTime,空值跳过

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/memory/service/===
MemoryLibraryService.java[SE7M]: F:记忆库CRUD服务,按数字员工/用户隔离管理记忆库 | R:MemoryLibraryMapper,MemoryLibrary | A:- | S:save/findById/findByUserIdAndAgentId/update/findByAgentId/deleteByAgentId,按agentId隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/operations/service/===
OperationsQueryService.java[SCO7KS]: F:运营看板动态SQL查询服务,按query_config配置执行动态SQL/ES查询并分页 | R:QueryConfigMapper,OperationsQueryRequest,QueryConfig,PageHelper,BaseException,I18nUtil | A:- | S:占位符${}替换防注入校验condition_fields覆盖,驼峰下划线互转,CASE语句语法修复,PageHelper分页,ES模板JSON构建,SQL值格式化转义单引号

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/organization/service/===
OrganizationService.java[SOR8PCM]: F:组织CRUD与树形管理,组织管理员权限校验,删组织级联清理(缓存/权限授权/外部系统映射) | R:OrganizationMapper,UsersOrganizationService,OrgExternalSystemService,PrivilegeGrantMapper,SequenceService,ShareCacheUtil,RedisUtil,CurrentUserHolder,OrganizationUpdatedEvent,OrganizationDeletedEvent | A:- | S:pathCode层级路径构建,countDuplicate去重校验,isOrganizationManManager父子组织授权,事件发布,Redis用户组织/权限/数据集授权缓存清理,PrivilegeGrant软删除statusCd=X,递归CTE路径名查询
OrgExternalSystemService.java[SO5S]: F:外系统组织映射关联表CRUD,本系统orgId与外系统unionId/depId双向映射 | R:OrgExternalSystemMapper,OrgExternalSystem | A:- | S:save/update/deleteById,finByDepId按sourceDepId查,findOrgIdByUnionId按unionId查orgId,findByOrgId反查映射

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/permissiongroup/enums/===
AuthorizedObjectTypeEnum.java[KPER3T]: F:权限组授权对象类型枚举(用户/组织/角色/岗位) | R:- | A:- | S:code-name映射,getByCode按编码反查
DataScopeTypeEnum.java[KPER1T]: F:数据范围类型枚举(本人/组织/岗位/驻地) | R:- | A:- | S:code-name映射,getByCode按编码查枚举,权限组数据范围
PermissionTypeEnum.java[KPERM3T]: F:权限类型枚举(查看/编辑/删除/导出/执行/管理) | R:- | A:- | S:code-name双字段,getByCode编码反查

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/permissiongroup/service/===
PermissionGroupCategoryService.java[SS7TM]: F:权限组目录领域服务,目录树构建与CRUD及循环依赖校验 | R:PermissionGroupCategoryMapper,SequenceService,CurrentUserHolder,PermissionGroupCategoryDTO,PermissionGroupCategoryVO | A:- | S:分页/树形查询,buildCategoryTree父子映射,新增改名编码同级重复校验,isDescendant防循环,删除前查子目录及权限组,雪花ID,@Transactional,orgId隔离
PermissionGroupService.java[SI9PCL]: F:权限组领域服务,管理权限组CRUD/授权对象/排除对象/功能权限/数据权限及多维度(用户/组织/岗位/驻地)数据权限校验与扩展权限覆盖 | R:PermissionGroupMapper,PermissionGroupResourceMapper,DefaultDataPermissionMapper,AuthorizedObjectDataPermissionMapper,PermissionGroupAuthorizedObjectMapper,SsResourceMapper,SsResourceRelDetailMapper,SequenceService:state,ShareCacheUtil,CurrentUserHolder,RedisUtil | A:- | S:事务先删后增,视图资源级联VIEW_REL_OBJECT权限,Redis缓存PER_GROUPS_OBJECT同步,默认数据范围self/org/position/station判定,扩展权限覆盖默认,checkDimensionListPermission批量校验,雪花ID,JSON存permissions

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/pluginmodule/enums/===
EmployeeTypeEnum.java[KEMP1T]: F:数字员工类型枚举(搜问/FunctionCloud/DataCloud) | R:- | A:- | S:code+desc双字段,Lombok-Getter

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/pluginmodule/service/===
PluginModuleRegisterService.java[SEM7TtM]: F:内置数字员工(联网搜索/FunctionCloud/DataCloud)幂等注册,创建资源及扩展配置(角色/性格/核心能力)并授权上架与插入默认菜单权限 | R:SsResourceService,SsResExtDigEmployeeService,AuthApplicationService,ResourceEventService,SequenceService,FunctionMenuPermissionMapper,EmployeeTypeEnum | A:- | S:@Transactional,doRegister按code查重幂等,DuplicateKeyException兜底,grantUsePrivToAll全员可用,sendResourceShelfEvent上架事件,buildBaseUrl拼SSE地址,CurrentUserHolder取租户/用户,BadSqlGrammarException容错菜单表缺失

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/position/enums/===
DigEmployeePositionStatusEnum.java[KPOS1T]: F:数字员工岗位状态枚举 | R:- | A:- | S:下岗/上岗/申请上岗/拒绝上岗,code-name映射,getByCode反查

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/position/service/===
PositionExtCatalogService.java[SPO5T]: F:岗位与领域(知识)关联关系的增删查服务 | R:PositionExtCatalogMapper,PositionExtCatalog | A:- | S:按positionId查询关联领域,save新增关联,removeByPositionId删除,LambdaQueryWrapper条件构造
PositionExternalService.java[SPOS5S]: F:岗位外系统标识扩展信息CRUD及按unionId查询岗位ID | R:PositionExternalMapper,PositionExternal | A:- | S:MyBatisPlus,LambdaQueryWrapper按unionId查询,save/update/deleteById,findPositionIdByUnionId外系统映射
PositionService.java[SPO7CS]: F:岗位增删改查与缓存查询服务,含重名校验、占用校验、数字岗位判断 | R:PositionMapper,SequenceService,ShareCacheUtil,PositionDTO | A:- | S:countPosition重名拦截,countUsed占用拦截,getCachePositionName先缓存后DB,isDigitalPosition按标志查询,序列生成主键
PositionUserRelationService.java[SPO5S]: F:岗位与管理员用户关系服务,保存关系及校验审核人是否为数字岗位管理员 | R:PositionUserRelationMapper,UsersMapper,PositionUserRelation,Users | A:- | S:LambdaQueryWrapper按岗位ID查关系集,审核人ID交集校验,批量查Users验存在性
ResourcePositionRelationService.java[ASPOS5M]: F:岗位与数字员工关系管理,含申请上岗/状态流转/按岗位或员工查询关联 | R:ResourcePositionRelationMapper,SequenceService,DigEmployeePositionStatusEnum,CurrentUserHolder,BaseException | A:- | S:LambdaQueryWrapper查询,Sequence生成主键,在职校验抛异常,APPLY_JOB状态更新或新增

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/resource/enums/===
ExtDocType.java[KKN1T]: F:扩展文档类型常量(本地知识库dataset/第三方external)
OperationTypeEnum.java[KOB1T]: F:资源操作类型枚举 | R:- | A:- | S:create/update/delete/publish/online/offline/auditPass/auditFail,code-desc映射,Lombok
OptimizeTypeEnum.java[KEMP7GM]: F:智能体配置项AI优化类型枚举,内置各字段中英文优化提示词模板及拼装逻辑 | R:- | A:- | S:14种优化类型(名称/描述/人设/开场白/标签/核心能力等),ZH/EN双语prompt常量,getPrompt按type+lang选模板替换${description},内嵌OptimizeField静态类
ResourceArtifactTypeEnum.java[KCO1T]: F:资源产物类型枚举(标准JSON/导入ZIP/导入Bundle目录) | R:- | A:- | S:三值枚举,资源导入导出场景
ResourceBizTypeEnum.java[KK1ST]: F:资源业务类型枚举(数字员工/智能体/知识库/插件/MCP/对象/视图等) | R:- | A:- | S:DIG_EMPLOYEE/AGENT/KG_DOC/TOOLKIT/MCP/OBJECT/VIEW/TAG等资源分类枚举
ResourceStatus.java[KOB3T]: F:资源状态枚举(草稿/待上架/已上架/已下架/审核/发布) | R:- | A:- | S:七态枚举映射num,isExist单值校验,arrIsExist批量校验
ResourceTypeEnum.java[KPER1T]: F:资源业务类型枚举(组合/原子) | R:- | A:- | S:COMBIN/ATOM双值,code-desc映射,isValid静态校验

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/resource/request/===
DigEmployeeRelResourceQo.java[DEM5M]: F:数字员工关联资源查询请求,含资源ID/目录ID及展开的子目录ID列表
ResourceUseAuthQo.java[DP5PM]: F:我能使用的资源列表查询请求,含资源类型/目录/授权对象/权限归属筛选/个人默认资源/租户隔离扩展字段

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/resource/service/===
AiModelDbService.java[SMO5S]: F:AI模型数据库查询服务 | R:AiModelMapper,AiModel | A:- | S:查询status=1的启用模型列表,authToken置空脱敏防泄露,LambdaQueryWrapper
OntologyOpenService.java[SO7VM]: F:对象本体开放服务,批量保存对象(新建/更新)及属性动作虚拟动作 | R:OntologyService,SsResourceService,OperationLogService,SequenceService,SsResExtOntologyMapper,SsResourceMapper,CurrentUserHolder | A:- | S:saveBatchOpen按resourceId判新建或更新,createOntologyResourceFromRequest建表带同名校验,setDateUserInfo填充创建人/企业ID多租户,写扩展表记操作日志
OntologyService.java[SOB7BL]: F:业务对象/视图本体管理服务,对象CRUD、属性与动作增删改、关联关系维护、虚拟动作自动生成、对象详情聚合查询 | R:SsResourceMapper,SsResExtAttributeMapper,SsResExtOntologyMapper,SsResourceRelDetailMapper,SequenceService,OperationLogService,OntologyOpenService,CurrentUserHolder | A:- | S:sourceType↔resourceType互转,extMeta(JSON)存relInfos/isBizId/权限/术语,双向rel_detail关联,文档/通用DB虚拟动作生成(查改增删),前端全量diff增删改,批量insert/update/delete,扩展表SsResExtOntology记pid,内部record/类封装操作列表
OperationLogService.java[SSA5MT]: F:记录资源操作日志,封装操作类型/用户/企业/版本号写入日志表 | R:SsResourceOperLogMapper,SsResourceOperLog,SsResource,OperationTypeEnum,CurrentUserHolder | A:- | S:从CurrentUserHolder取用户/企业ID,带comAcctId租户隔离,记录资源版本号versionNo
ResourceAuthApplicationService.java[SSP7PM]: F:资源授权应用服务,组织/数字员工资源授权明细分页查询及三层授权(可见/可用/可执行)权限判定与授权来源构建 | R:PrivilegeGrantService,ResourceAuthContextService,IndexService,SsResourceCatalogService,SsResourceMapper,UserService,OrganizationService,AuthApplicationService | A:- | S:三层授权黑白名单判定,buildGrantSourceVo授权来源溯源,catalog目录树递归填充,publishOrgIds企业组织过滤,PageHelper分页,GrantType(FORCE_USE/ALLOW_MANAGE/AVAILABLE_USE)
ResourceEventService.java[SOB7AM]: F:资源变更事件发布服务,资源上架/下架/审核通过/驳回事件构建并异步发送至Kafka resource-events主题 | R:ZlogAdapter,ResourceEventMessage,SsResExtDigEmployeeMapper,SsResource,CurrentUserHolder,ObjectMapper | A:- | S:CompletableFuture异步发送,JSON序列化,UUID事件ID,补充数字员工terminal/prologue,BaseException+I18n国际化,租户ComAcctId填充
ResourceRuntimeInfo.java[ECORE3T]: F:资源运行时注册信息值对象,承载implType与workerAgentType推导结果 | R:- | A:- | S:不可变值对象,final字段封装ss_resource.impl_type与worker_agent_type
ResourceRuntimeInfoResolver.java[SS5M]: F:资源运行时注册信息解析器,按资源类型/实现方式/数字员工类型推导impl_type与worker_agent_type | R:SsResource,ImplType,WorkerAgentType,DigitalEmployType,ResourceBizType | A:- | S:resolveToolJson按API/SSE/ASK分支,resolveKnowledge/ObjectView/DigitalEmployee映射BYCLAW_QA/DATA/CODE/EXE,DEBUG拼resourceId,fillResource回填主表
ResourceTargetJsonBuilder.java[SOB5S]: F:资源标准JSON根节点构建器,为targetContent补齐resourceId与implType/workerAgentType等公共运行时字段 | R:SsResource, ResourceRuntimeInfo | A:- | S:buildWithResourceIdFirst保证resourceId首位有序JSONObject,enrichRoot补运行时字段,不接管fields/objects业务节点,resourceIdAsString控制ID类型
SsResExtAgentService.java[SEMP5S]: F:数字员工资源扩展表CRUD及按资源ID查询智能体扩展信息 | R:SsResExtAgentMapper,SsResExtAgent,ResourceExtAgentDto,ListUtil | A:- | S:insert/updateById/deleteById/selectById增删改查,findResourceExtAgentByIds批量查,单查包装singleton集合取首元素
SsResExtDbDatasetService.java[SO7M]: F:数据库数据集资源管理服务,处理数据集配置/入参出参/SQL执行的增删改查与字段校验 | R:SsResExtDbDatasetMapper,SsResourceMapper,SsResExtAttributeMapper,SsResourceRelDetailMapper,OntologyApplicationService,SequenceService,DatasetSqlBuilder,CurrentUserHolder | A:- | S:tableJoinInfo解析提取字段,JSON存储execute_sql构建,入参出参与动作Ontology同步保存,主表变化检测删参,执行时matchType/必填/类型多维校验,resourceCode生成,租户企业ID隔离
SsResExtDigEmployeeService.java[SEM7KM]: F:数字员工资源扩展表服务,提供分页/个人/全量查询、详情、CRUD及已上架数字员工查询 | R:SsResExtDigEmployeeMapper,ShareCacheUtil,PageHelperUtil,DigitalEmployeeQo | A:- | S:PageHelper分页,manUserId拆分查用户名拼接,owner/authorize/manager权限区分,findOnline按渠道,personal个人空间隔离
SsResExtDocService.java[SKN7S]: F:文档库扩展表服务,管理知识库资源扩展记录CRUD并按JSON模板生成targetContent(含QA服务的知识库API清单) | R:SsResExtDocMapper,ResourceExtDocDto,SsResExtDoc,ResourceRuntimeInfoResolver,ResourceTargetJsonBuilder,kg-doc-template.json | A:- | S:fastjson构建resourceService列表(create_kb/write_index/search_chunk等14个QA接口),qADomainName注入域名,模板懒加载双检锁缓存,clearUrlRecursively递归清空url,更新时仅覆盖名称描述保留sourceContent
SsResExtEvaluateService.java[SEM5K]: F:数字员工评估旧数据表CRUD与分页查询服务 | R:SsResExtEvaluateMapper,SequenceService,SsResExtEvaluateQO,PageHelperUtil,PageInfo | A:- | S:查最新评估记录,序列号生成主键,saveOrUpdate按evaluateId判存更,MyBatisPlus分页
SsResExtMcpServerService.java[ASO5S]: F:MCP服务资源扩展表的增删改查服务 | R:SsResExtMcpServerMapper,SsResExtMcpServer,ResourceExtMcpDto,ListUtil | A:- | S:insert/updateById/selectById,按资源ID集合批量查MCP扩展信息,单值查询包装singleton集合取首条
SsResExtMcpService.java[ASTFL]: F:MCP扩展资源服务,管理MCP工具CRUD及连通性校验,封装MCP同步客户端调用工具 | R:SsResExtMcpMapper,SsResExtMcp,CallMcpParamsDto,ResourceIdDto,McpSyncClient,HttpClientSseClientTransport,I18nUtil | A:- | S:SSE传输构建带headers定制,listTools/callTool工具调用,JSON写入前校验优选读类tool按动词关键词判断,inputSchema生成最小必填参数(example/default/enum采样),3s连接5s请求超时
"
SsResExtMcpToolService.java[SS5T]: F:MCP服务工具扩展表的增改查服务 | R:SsResExtMcpTool,SsResExtMcpToolMapper | A:- | S:insert/updateById/selectById三方法封装,MyBatis-Plus
SsResExtObjectService.java[SOB5T]: F:业务对象扩展资源CRUD服务 | R:SsResExtObjectMapper,SsResExtObject | A:- | S:增删改查封装,insert/updateById/deleteById/selectById
SsResExtTestSetService.java[SE5KS]: F:数字员工测试集上传临时表CRUD与分页查询服务 | R:SsResExtTestSetMapper,SsResExtTestSet,SsResExtTestSetQo,CurrentUserHolder,PageHelperUtil | A:- | S:save/update/saveOrUpdate按testSetId判增改,按resourceId+batchId/最新查询,MyBatisPlus分页toPageInfo,CurrentUserHolder填createBy
SsResExtToolKitService.java[SS5M]: F:工具集扩展表资源服务,CRUD及工具集与工具关联查询 | R:SsResExtToolKitMapper,SsResExtToolKit,ResourceExtToolKitDto,ListUtil | A:- | S:insert/updateById/deleteById/selectById,findResourceExtToolKitByIds批量查含关联工具列表,findToolKitIdByToolsId反查工具集ID
SsResExtToolService.java[STO5S]: F:工具扩展资源CRUD及按资源ID批量查询工具扩展信息 | R:SsResExtToolMapper,SsResExtTool,ResourceExtToolDto | A:- | S:MyBatis单表增删改查,findResourceExtToolByIds批量查询工具DTO
SsResExtViewService.java[SVIEW3T]: F:业务视图扩展资源CRUD服务 | R:SsResExtView,SsResExtViewMapper | A:- | S:insert/updateById/deleteById/selectById基础增删改查封装
SsResourceArtifactService.java[SOB7MS]: F:资源产物映射服务,管理资源与MinIO存储路径的关联记录CRUD与失效 | R:SsResourceArtifactMapper,ResourceArtifactPathResolver,SequenceService,CurrentUserHolder,ResourceArtifactTypeEnum | A:- | S:upsert按resourceId+type+path唯一键存在则更新否则插入,replaceArtifacts先失效后重建,A/X状态位逻辑删除,路径归一化去反斜杠与前导斜杠,失效前清理同唯一键X记录,comAcctId企业隔离
SsResourceCatalogService.java[SOB7M]: F:资源目录CRUD与目录树构建,支持多级路径/层级限制/平铺转树/排序 | R:SsResourceCatalogMapper,SequenceService,ByaiSystemConfigService,CurrentUserHolder | A:- | S:catalogPath点分路径构建,层级深度校验,同名目录去重,buildTree平铺转树形,递归orderIndex排序,findSelfAndDescendantCatalogIds子树查询
SsResourceRelDetailService.java[SE7TM]: F:资源关联明细Service接口,数字员工与技能/资源关联查询及OpenAPI技能列表 | R:SsResourceRelDetail,SsResourceRelDetailDTO,IService | A:- | S:findByResourceId,removeAllByResourceIdOrRelResourceId级联删除,querySkillsForOpenApi返技能资源基础字段及ext扩展数据,find双向关联查询
SsResourceService.java[SCO5MTM]: F:资源主表领域服务,提供资源CRUD、分页查询、重名校验、目录树/文档库/数字员工扩展查询及创建默认字段补齐 | R:SsResourceMapper,SsResExtDigEmployeeMapper,SequenceService,CurrentUserHolder,ResourceStatus,SystemCode,ImplType,WorkerAgentType | A:- | S:PageHelper/MyBatisPlus双分页,生成不重名资源名,fillCreateDefaults补齐systemCode/orgId/comAcctId多租户,resourceCode=systemCode_bizType_id,personal_default数字员工查询,REMOVED过滤全量同步
SuperassistSubAgentService.java[SEM7S]: F:超级助手子智能体授权订阅服务,处理订阅/取消订阅及记录维护 | R:SuasSuperassistSubAgentMapper,SuasSuperassistSubAgent,SequenceService,CurrentUserHolder | A:- | S:handleSubscription存在即更新否则插入,handleDirectUnsubscribe权限撤销同步取消,findExistingRecord按userId+agentId唯一匹配,序列生成主键,状态码00A

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/resource/service/impl/===
SsResourceRelDetailServiceImpl.java[SVB5MT]: F:资源关联明细服务,构建视图-主-从对象关联关系并查询数字员工技能列表(含文档/工具/工具包/数据集扩展数据) | R:SsResourceRelDetailMapper,SsResourceMapper,SsResExtDocMapper,SsResExtToolMapper,SsResExtToolKitMapper,SsResExtDbDatasetMapper,SequenceService,CurrentUserHolder,SsResourceRelDetailDTO,SaveViewResourceRelRequest | A:- | S:MyBatisPlus批量查询,relResourceInfo JSON构建合并viewResourceId,bizType分组KG_DOC/TOOL/TOOLKIT/KG_DB填充扩展,enterpriseId租户隔离,事务删除重建关联

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/resource/service/ontology/===
ByaiDbresourceRelService.java[ASS7TBS]: F:数据库资源关联关系增删改查服务,管理对象(用户)与库资源的绑定 | R:ByaiDbresourceRelMapper,ByaiDbresourceRel,BaseException,I18nUtil | A:- | S:按objId/recordId/objType多维查询,事务保存更新删除,批量insertBatch,objType默认USER,参数空校验抛BaseException

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/resource/util/===
DatasetSqlBuilder.java[UQE5M]: F:数据集SQL构建工具,根据tableJoinInfo生成SELECT/JOIN语句及安全WHERE子句 | R:DatasetExecuteRequest,SsResExtAttribute,SsResExtDbDataset,ByAiArgumentException,I18nUtil,StringUtil | A:- | S:解析tableJoinInfo Map构建SELECT/FROM/JOIN,字段名唯一性与危险字符校验,按matchType构建条件(=/like/between/in等),类型转换校验(整数/数字/布尔/日期),SQL注入防护单引号转义与危险关键字过滤
DigEmployeeRedisKeys.java[UEM1CT]: F:数字员工及资源Redis键命名约定工具 | R:- | A:- | S:技能缓存前缀RESOURCE_DIG_EMPLOYEE_,configJsonKey配置快照键,resourceConfigJsonKey按bizType+resourceId生成键与开放资源目录JSON基名一致,私有构造

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/resource/validator/===
AbstractResourceValidator.java[HEH5VM]: F:资源校验器抽象基类,模板方法定义校验流程与参数/URL通用校验 | R:ResourceDto,ByAiArgumentException,I18nUtil | A:- | S:模板方法validate→doValidate,validateParamNotEmpty/validateUrl,convertToMap基于FastJSON,i18n错误消息

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/resource/validator/impl/===
AgentResourceValidator.java[HEM5P]: F:数字员工资源校验器,校验agentType非空及SSE/Admin URL格式 | R:AbstractResourceValidator,ResourceDto | A:- | S:继承抽象校验器,doValidate实现,convertToMap参数转换,validateParamNotEmpty+validateUrl
DbResourceValidator.java[DDB3VT]: F:数据库资源校验器,校验chatbiBaseId参数非空 | R:AbstractResourceValidator,ResourceDto | A:- | S:继承抽象校验器,convertToMap转换param,validateParamNotEmpty校验
DocResourceValidator.java[HKN5VT]: F:文档库资源校验器,无特殊校验逻辑 | R:AbstractResourceValidator,ResourceDto | A:- | S:继承抽象校验器,doValidate空实现,@Component
McpResourceValidator.java[HToTT]: F:MCP服务资源参数校验,验证mcpServiceId非空与mcpServiceUrl格式 | R:AbstractResourceValidator,ResourceDto | A:- | S:继承抽象校验器,doValidate校验mcpServiceId非空和mcpServiceUrl合法性,Spring组件
McpToolResourceValidator.java[HTL5VT]: F:MCP工具资源参数校验,校验inputSchema/outputSchema非空 | R:AbstractResourceValidator.java,ResourceDto | A:- | S:继承抽象校验器,convertToMap转换param,validateParamNotEmpty校验
PluginResourceValidator.java[DToVT]: F:插件资源校验器,校验headers非空及tools为数组类型 | R:AbstractResourceValidator,ResourceDto,ByAiArgumentException,I18nUtil | A:- | S:继承抽象校验器实现doValidate,convertToMap转参,validateParamNotEmpty校验headers,tools类型校验抛i18n异常
TagsResourceValidator.java[HVO5VS]: F:资源Tags字段格式校验器,校验JSON数组格式/非空/元素为非空字符串 | R:AbstractResourceValidator,ResourceDto,ByAiArgumentException,I18nUtil | A:- | S:三段校验basicFormat正则查尾逗号与冒号,jsonFormat解析数组非空,content逐元素查null/类型/空白,fastjson解析
ToolResourceValidator.java[ST5VS]: F:工具资源参数校验,校验inputSchema/outputSchema非空 | R:AbstractResourceValidator.java,ResourceDto | A:- | S:继承抽象校验器,convertToMap转参数,validateParamNotEmpty校验,@Component

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/role/service/===
RoleService.java[SR5T]: F:根据用户类型映射角色名称 | R:UserType,StringUtil | A:- | S:switch表达式匹配UserType常量返回中文角色名,空值返回null

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/scheduletask/service/===
ScheduleTaskInstService.java[SST5S]: F:定时任务执行实例服务,按周期保存/查询/清理任务实例 | R:ScheduleTaskInstMapper,SequenceService,ScheduleTaskInst | A:- | S:save生成taskInstId入库,clearTaskInstByCycle按taskId+cycleVal删除,findTaskInstByCycle条件查询,deleteScheduleTaskInstByTaskId按任务清空
ScheduleTaskService.java[ASS5MS]: F:定时任务增删改查服务,按资源/节点查询并转换执行频率分隔符 | R:ScheduleTaskMapper,ScheduleTask,ScheduleTaskVo,CurrentUserHolder,StringUtil | A:- | S:MyBatisPlus-LambdaQueryWrapper,按executorId当前用户隔离,executionFrequency逗号拆分,BeanUtils转VO

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/session/service/===
ByaiSessionService.java[SC75M]: F:会话主表领域服务,提供会话查找/删除及按数字员工查调试会话 | R:ByaiSessionMapper,ByaiSession,CurrentUserHolder,DebugModeEnum | A:- | S:MyBatisPlus LambdaQueryWrapper,按当前用户隔离查询,ObjectType=DigEmployee+isDebug过滤调试会话

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/source/service/===
SourceSystemService.java[SAU5S]: F:源系统配置查询服务,按编码/appKey查OAuth2配置及系统列表 | R:SourceSystemMapper,SsResourceMapper,SourceSystem,SystemQo | A:- | S:LambdaQueryWrapper按systemCode/appKey+enabled='Y'查询,getSourceSystemListByTypes按类型筛选

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/staticdata/service/===
ByaiSystemConfigListService.java[SSY5KM]: F:系统静态配置列表分组CRUD与分页查询服务 | R:ByaiSystemConfigListMapper,PageHelperUtil,QueryObject,ByaiSystemConfigList | A:- | S:MyBatisPlus-LambdaQuery,PageHelper分组分页,按paramGroupCode增删查,paramSeq排序,组编码/组名计数
SystemConfigService.java[ASS5CM]: F:系统配置CRUD与按编码取值,缓存优先查库兜底并替换环境变量占位符 | R:ByaiSystemConfigMapper,RedisUtil,RedisConfig,ApplicationContextUtil,PageHelperUtil | A:- | S:findCacheOrDbByParamCode读Redis哈希缓存miss落库回填,environmentReplace正则${XXX}匹配ApplicationContextUtil取env替换,getString/Long类型转换,分页countByCode去重校验

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/station/service/===
StationService.java[ESO5M]: F:驻地信息CRUD及驻地树/层级查询服务 | R:StationMapper,Station,StationTreeQo,StringUtil | A:- | S:按ID/父级/用户查驻地,分页查询,基于station_id_path路径递归查上级驻地树和子驻地ID列表,save/update自动填充时间

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/superassist/domain/===
AssistPrologue.java[ECE5T]: F:数字助理开场白配置领域对象(头像/名称/简介/昵称/记忆)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/superassist/service/===
SsSuperassistKwCatalogService.java[SKNW5S]: F:超级助手知识库会话目录的保存与按助手ID移除 | R:SsSuperassistKwCatalogMapper,SsSuperassistKwCatalog,SequenceService,CurrentUserHolder | A:- | S:save生成序列ID并填充创建人/时间insert,remove按superassistId条件删除,MyBatisPlus LambdaQueryWrapper
SuasSuperassistService.java[SEM7MM]: F:超级助手CRUD,创建/查询/更新/删除及按默认数字员工查询受影响记录 | R:SuasSuperassistMapper,SequenceService,CurrentUserHolder,SuasSuperassist | A:- | S:序列号生成主键,默认状态00,注入createUser/comAcctId租户隔离,按defaultDigEmployeeId查回退,LambdaQueryWrapper

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/system/service/===
AttachFileService.java[SSF5T]: F:附件文件CRUD服务 | R:AttachFileMapper,AttachFile | A:- | S:save插入,update按ID更新,selectById查询
SystemFeedbackService.java[ASYS5T]: F:系统反馈保存服务 | R:SystemFeedbackMapper,SystemFeedback | A:- | S:依赖注入Mapper,insert保存反馈

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/tag/service/===
ByaiTagRelationService.java[SO5BL]: F:标签关系服务,管理对象与标签关联(保存/删除/查询/模型能力批量绑定) | R:ByaiTagRelationMapper,SequenceService,CurrentUserHolder,Constants | A:- | S:save生成序列ID插入关系,saveAimodelAbilities先删后批量插模型能力关联,findTagRelation按objType+tagId查询,removeById删除

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/template/service/===
ResourceTemplateRelationService.java[SOB5BM]: F:资源模版关联关系CRUD,按资源/模板/用户维度增删查改 | R:ResourceTemplateRelationMapper,ResourceTemplateRelation | A:- | S:insert/batchInsert批量保存,按resourceId/templateId删除,LambdaQueryWrapper条件删,按模板+资源查唯一记录,带userId隔离查询
TemplateRuleInfoService.java[SSO5KS]: F:模版规则信息增删改查服务,支持分页与按资源/用户查询 | R:TemplateRuleInfoMapper,TemplateRuleInfo,TemplateRuleInfoQueryQo | A:- | S:MyBatisPlus自动分页,resourceId+userId过滤,selectByCondition条件查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/token/service/===
UserAccessTokenService.java[SS7KM]: F:用户访问令牌CRUD服务,按令牌/ID/名称查询及保存更新 | R:UserAccessTokenMapper,SequenceService,UserAccessToken,Constants | A:- | S:LambdaQueryWrapper按accessToken查用户,序列生成主键,tokenStatus状态过滤,按userId统计令牌名计数,分页selectList

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/domain/users/service/===
UserExternalSystemService.java[SAU5S]: F:用户外部系统绑定信息CRUD,支持按unionId/userId查询绑定关系 | R:UserExternalSystemMapper,UserExternalSystem | A:- | S:MyBatisPlus LambdaQueryWrapper,sourceType区分来源,钉钉等外系统账号关联
UserService.java[SAU8EM]: F:用户管理领域服务,提供用户CRUD/编码工号唯一性校验/手机号SM4加密查询/苹果账号绑定/组织邮箱名称查询 | R:UsersMapper,SequenceService,Sm4Util,Users,UserState,IsLocked,TempQo | A:- | S:LambdaQueryWrapper按State=ACTIVE过滤,手机号Sm4Util.encrypt后查询,逻辑删除置DISABLED,appleUserId唯一性绑定校验,countUsers去重
UsersOrganizationExternalSystemService.java[SOR5T]: F:用户组织外部系统关联表的增删操作 | R:UsersOrganizationExternalSystemMapper,UsersOrganizationExternalSystem | A:- | S:insert保存关联,deleteById,按usersOrganizationId条件删除,LambdaQueryWrapper
UsersOrganizationService.java[SOR5BM]: F:用户-组织-岗位关联关系CRUD服务,管理用户在组织内的角色与岗位绑定 | R:UsersOrganizationMapper,SequenceService,UsersOrganization,UsersOrgPostVo | A:- | S:关联前先按userId+orgId删除再批量重建,findGroupByOrgId按组织分组,批量查询/移除,序列生成ID,按orgId级联移除

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/aimodel/===
ModelDebugRequest.java[DD5MS]: F:模型调试请求入参(先试再保存,含端点/Token/超时/温度等可选调用参数)
ModelDebugResponse.java[DAB5S]: F:模型调试响应数据类，含输出内容、耗时、请求ID、成功标识
ModelDefault.java[DM5VS]: F:设置默认模型入参
ModelIdRequest.java[DMO5S]: F:按模型ID操作请求(删除/详情)
ModelListRequest.java[DM5MS]: F:模型列表分页查询请求,含状态/能力/系统/关键字过滤
ModelListResponse.java[DH5KS]: F:模型列表分页响应,含rows/分页字段(列表仅返回apiTokenMasked脱敏)
ModelRequest.java[DH5M]: F:模型查询请求参数(标签ID/状态)
ModelSetStatusRequest.java[DG5ST]: F:模型启停请求入参(模型ID+状态ENABLED/DISABLED/TESTING)
ModelUpsertRequest.java[DI5ML]: F:模型新增/更新请求入参
ModelVO.java[DMO5S]: F:模型详情VO,列表行与详情编辑回显,含脱敏token与高级参数

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/auth/===
AuthDTO.java[DA5PM]: F:授权对象数据传输,含授权对象ID/类型(USER/ORG/POST)/名称及授权类型(使用/强制/管理/分享)
AuthManOrgDTO.java[DAU3M]: F:组织授权数据传输对象,含授权类型/目标对象/红名单组织列表
AuthRedBlackDTO.java[DA5PM]: F:红黑名单授权请求,含授权类型/资源对象/红黑名单及组织维度
AuthResourceType.java[DAU3M]: F:授权资源类型数据载体,含资源ID与业务类型
ManOrgDTO.java[DAUT5T]: F:组织授权对象DTO,含授权对象ID/类型/名称
PriviledgeQo.java[DROK1S]: F:权限授权分页查询参数(授权对象/类型/资源类型/红黑名单/关键字)
SmsCaptchaRequest.java[DA3VT]: F:短信验证码请求参数(加密手机号/业务类型/图形验证码)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/conversation/===
FeedbackMsgInfoDto.java[DA5CT]: F:反馈消息信息扩展DTO,含指派人和处理人名称
FeedbackTypeDto.java[DC5M]: F:会话反馈类型数据传输对象,含参数名称/取值/编码
MessageDto.java[DCH5S]: F:会话消息DTO,含问答内容/用户反馈/请求状态/处理指派等字段
Message.java[DD5CM]: F:会话消息索引DTO,含提问/回复内容及向量、反馈评分、问答状态、耗时统计等字段
FeedbackDto.java: F:会话反馈数据传输对象(类型/内容/分数/标注/标签)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/datacloud/===
DatacloudLoginTypeDTO.java[DD5VM]: F:数据云登录类型管理DTO,含编码/名称/配置JSON及Add/Mod分组校验
DatacloudLoginTypeQueryDTO.java[DD5KS]: F:数据云登录类型查询参数,支持模糊查询、分页、排序及关联脚本统计
DatacloudScriptCategoryDTO.java[DD5OM]: F:数据云脚本分类管理DTO,含树形父子关系/排序/企业租户隔离及显示扩展字段
DatacloudScriptCategoryQueryDTO.java[DD5KS]: F:数据云脚本分类查询DTO,支持模糊查询/企业租户隔离/分页/排序
DatacloudScriptDTO.java[DD5VM]: F:数据云脚本采集管理DTO,含playwright/api脚本内容、状态、版本及执行统计字段
DatacloudScriptExecutionBatchDeleteQO.java[DOB5M]: F:数据云脚本执行记录批量删除入参(执行记录ID列表+企业ID隔离)
DatacloudScriptExecutionDTO.java[DD5SS]: F:数据云脚本执行记录管理DTO,含执行状态/参数/结果及显示扩展字段
DatacloudScriptQueryDTO.java[DO5KT]: F:数据云脚本查询参数DTO(名称/类型/状态/场景/分页/排序)
DatacloudScriptScenarioBatchDeleteQO.java[D]: F:数据云脚本场景批量删除查询参数,含场景ID列表与企业ID
DatacloudScriptScenarioConfigDTO.java[DD5AM]: F:数据云录制脚本场景配置保存DTO,含脚本步骤/目标脚本/参数变量定义等嵌套结构
DatacloudScriptScenarioDTO.java[DD5M]: F:数据云脚本场景管理DTO,扩展实体含登录类型名、子场景数、关联脚本数
DatacloudScriptScenarioQueryDTO.java[DD7KS]: F:数据云脚本场景查询参数DTO,含模糊查询/分页/排序字段
DatacloudScriptStepDTO.java[DD3ST]: F:数据云脚本步骤管理DTO,含脚本内容/参数变量/步骤顺序及显示扩展字段
DatacloudScriptStepQueryDTO.java[DDP5KS]: F:数据云脚本步骤查询参数(支持名称模糊、模板/脚本/企业/创建人过滤、分页排序)
DatacloudScriptTemplateBatchDeleteDTO.java[DD5BT]: F:数据云脚本模板批量删除参数,模板ID列表非空校验
DatacloudScriptTemplateDTO.java[DD5S]: F:脚本模板DTO,含Python/NodeJS模板内容、框架类型、参数元信息及企业隔离字段
DataCloudScriptViewQueryDTO.java[DV5K]: F:数据云脚本视图分页查询参数(视图ID列表/项目空间ID/分页/关键字)
DatacloudTargetScriptDTO.java[DD5M]: F:数据云目标脚本DTO,含Python/NodeJS脚本内容与目标选择器
DataCloudViewScriptDTO.java[DV5T]: F:数据云视图脚本DTO,扩展脚本实体含登录类型名与场景信息
DatacloudLoginTypeBatchDeleteQO.java: F:数据云登录类型批量删除请求参数
DatacloudScriptBatchDeleteQO.java: F:数据云脚本批量删除请求参数
DatacloudScriptCategoryBatchDeleteQO.java: F:数据云脚本分类批量删除入参(分类ID列表+企业ID)
DatacloudScriptExecutionQueryDTO.java: F:数据云脚本执行记录查询参数(状态/脚本/时间范围/时长/分页排序多条件)
DatacloudScriptScenarioConfigQueryDTO.java: F:数据云脚本场景配置分页查询参数
DatacloudScriptStepBatchDeleteQO.java: F:数据云脚本步骤批量删除请求参数,含步骤ID列表与脚本ID
DatacloudScriptTemplateQueryDTO.java: F:数据云脚本模板分页查询参数(名称模糊/类型/框架/启用状态/企业/创建人)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/digitemploy/===
AgentPromptDto.java[DEM5T]: F:智能体提示词生成请求参数
DigEmployeeInfo.java[DEMP5S]: F:数字员工信息DTO(归属组织/业务领域/管理人员/关联资源)
DigitalEmployeeDetailsDTO.java[DE5M]: F:数字员工详情DTO,含发布组织/用户、关联资源列表、记忆配置列表
DigitalEmployeeDTO.java[DEMP5M]: F:数字员工扩展信息DTO,含资源基础字段+定时任务+记忆配置+关联技能/工具/提示词
EmployeeIdDTO.java[DEM5M]: F:数字员工资源ID传参DTO
MetaPromptGenerateResult.java[DEM5L]: F:元提示词生成结果DTO,含字段映射与上下文统计(工具/MCP/知识/智能体/技能数量)
RelResourceInfo.java[DEMP5S]: F:数字员工关联资源信息DTO,含关联资源ID与可用资源ID列表
SetDefaultDigitalEmployeeDTO.java[DEM5S]: F:设置默认数字员工入参DTO,含资源ID校验
SsResourceDTO.java[DE5ST]: F:数字员工资源DTO,扩展SsResource含关联资源信息与可用数量
MetaPromptGenerateRequest.java: F:元提示词生成请求,聚合数字员工各维度描述字段并提供语言/描述解析

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/ecosystem/===
EcosystemRunStartRequest.java[DC5T]: F:生态采集运行启动请求,含任务ID与触发来源类型
EcosystemTaskCreateRequest.java[DK5BT]: F:生态采集任务创建请求,含连接器/调度/知识库入库/业务对象信号参数
EcosystemAgentHeartbeatRequest.java: F:浏览器登录态能力心跳请求体,含采集运行时/Bridge状态/站点登录态列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/email/===
EmailDTO.java[DCO1T]: F:邮件发送参数数据类(主题/收件人/正文)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/file/===
UploadFilesRespListDto.java[DFI5M]: F:批量上传文件响应列表DTO,封装UploadFilesRespDto集合
UploadFilesRespDto.java: F:文件上传响应DTO,含文件ID/名称/URL/标签/上传时间/数据集ID/消息

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/men/===
ButtonStatusDto.java[DC5ST]: F:按钮状态数据传输对象(key/text/disabled)
MenButtonStatusDto.java[DCO5M]: F:菜单/任务按钮状态DTO,含任务扩展ID、系统编号及按钮状态列表
MenResComQueryQo.java[DCORE5M]: F:批量查询资源组件请求参数(资源组件ID列表)
MenTaskApprovalQo.java[DI5VT]: F:待办任务审批请求对象,含任务ID/审批状态(PASS/REJECT)/审批意见
MenTaskOpenApiQo.java[D]: F:待办任务开放API请求对象,操作类型/来源系统/收发用户/内容卡片校验
MenTaskSessionQo.java[DA5TM]: F:待办任务会话创建查询对象,继承ByaiSession含任务主键
NoticeDetail.java[DC5VS]: F:通知详情DTO,含标题/内容/优先级/收发者及参数校验注解
Notices.java[DC5VS]: F:通知列表DTO,封装通知详情列表
NotifyResultDto.java[DA5M]: F:通知结果数据类,含成功标识与会话/消息ID
UsersDetailVo.java[DAU3M]: F:用户详情VO,含用户标识/名称/编码/工号/邮箱/电话/角色/组织/职位/驻地
MenTaskDeleteQo.java: F:删除待办任务请求对象(支持单个/批量删除,按任务ID/外部ID/资源ID删除)
MenTaskQueryByResourceQo.java: F:根据资源ID查询待办任务请求对象,含状态分类筛选逻辑

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/message/===
MessageShareLinkStatusDto.java[DCH1S]: F:消息分享链接状态DTO,继承MessageShareLink增加是否成功标识

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/mode/===
ModeDto.java[DV5M]: F:模式DTO含关联关系列表
ModeRelationDto.java[DB5VS]: F:模式与数字员工关联关系DTO,继承ByaiModeDigRel扩展资源名称字段

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/notification/===
NotificationDto.java[DC5SM]: F:通知数据传输对象,含标题/内容/类型/优先级/资源/收发方/过期时间/扩展信息
NotificationQueryDto.java[DCO5K]: F:通知查询参数,支持标题/内容/类型/优先级/已读状态/时间范围分页过滤
NotificationReadDto.java: F:通知标记已读DTO,通知ID列表/接收者ID/全部已读标识

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/ontology/===
AttributeCreateRequest.java[DOB5S]: F:批量创建本体函数属性请求DTO,含函数及属性嵌套结构
AttributeUpdateRequest.java[DOB5M]: F:批量更新本体函数属性请求(先删后增),含函数属性与属性信息嵌套类
ObjectDto.java[DOBJ5M]: F:本体对象DTO,含对象基本信息及属性、动作列表
OntologyActionSaveRequest.java[DOB5S]: F:对象动作保存请求DTO,含对象信息与动作及属性列表
OntologyBatchSaveRequest.java[Request]: F:业务对象本体批量保存请求,含对象/属性/函数/动作/关联对象嵌套结构
OntologyCreateRequest.java[DOB5V]: F:业务对象创建请求DTO,含名称/目录/数据来源类型/属性列表
OntologyDeleteRequest.java[DOB5S]: F:本体对象删除请求,含资源ID与关联对象ID
OntologyDetailResponse.java[DOBST]: F:对象详情查询响应DTO,含对象基本信息、属性、动作列表及动作属性
OntologyQueryByIdRequest.java[DOB5M]: F:本体对象按ID查询请求DTO,含资源ID非空校验
OntologyQueryRequest.java[DOB5KT]: F:对象本体分页查询请求参数(名称模糊/目录/来源类型/分页)
OntologyUpdateRequest.java[DOB5T]: F:业务对象更新请求,含资源ID/名称/描述/文档库/目录/类型/数据来源类型
TermInfo.java[DOB5S]: F:术语信息DTO,存储参数关联的术语库及术语类型信息
ToolInfo.java[DTOL5S]: F:工具信息DTO,存储从工具集提取的工具编码/描述/名称/ID及参数列表
ToolkitInfo.java[DTO7S]: F:工具集信息DTO,含工具集ID/名称/介绍及工具列表
ToolParam.java[DTOL5S]: F:工具参数DTO,含参数代码/类型/子参数树/术语信息
OntologyAttributeSaveRequest.java: F:对象函数与属性保存请求DTO(对象基本信息/属性/函数/关联对象)
OntologyCreateRelationRequest.java: F:创建对象关联请求DTO

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/openapi/===
BelongOrgManagerDTO.java[DD5M]: F:归属组织管理员授权对象DTO,含授权对象ID
MountResourceDto.java[DE7TM]: F:挂载资源数据传输对象,含智能体ID与关联资源编码
OpenDelUserDTO.java[DAU5M]: F:OpenAPI删除用户入参,含userId非空校验
OpenOrgDTO.java[DD5VM]: F:开放API组织数据传输对象,含校验分组
OpenPositionDTO.java[DPOSM]: F:OpenAPI岗位数据传输对象,含岗位编码/名称/描述及外系统主键映射标识
OpenStationDTO.java[DC5VT]: F:外部接口新增/修改驻地数据传输对象
OpenUserDTO.java[DAU5M]: F:开放API用户数据传输对象,含校验分组(新增/修改)
OpenUserOrgDTO.java[DON7S]: F:开放接口用户组织关系数据传输对象,含组织ID/岗位ID/用户类型
PrivilegeQueryDTO.java[DPER1S]: F:权限对象批量查询入参,含授权对象ID列表
UserOrganizationDTO.java[DOR3T]: F:用户组织信息DTO,含用户ID与组织路径代码/名称(空格分隔多组织)
PublishResponseDTO.java: F:OpenAPI发布操作响应DTO,含成功标志、资源ID/名称/编码、来源主键及错误码信息

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/operations/===
ApplyPostRequest.java[DPO5T]: F:数字员工申请上岗请求参数(资源/审核人/目录/岗位/理由)
MessageRelObjMetricsJsonRequest.java[DV5T]: F:消息引用对象指标查询JSON请求参数,含指标内容JSON及非空校验
MessageRelObjMetricsRequest.java[DVO5M]: F:消息引用对象使用指标/技能指标查询请求DTO
OperationResourceIdRequest.java[DEM5S]: F:运营资源ID请求体,数字员工资源ID参数封装
OperationResourceTestSetRequest.java[DEM5T]: F:获取批次上传测试集请求对象(数字员工ID+批次relId)
OperationsQueryRequest.java[DCO5M]: F:运营看板查询请求DTO,含查询编码与动态SQL参数
PortraitMemoryResponse.java[DEM5M]: F:场景画像记忆响应DTO
QueryConfigListDTO.java[DV5M]: F:查询配置列表DTO,返回查询配置信息(编码/名称/维度/度量/条件字段)不含SQL模板
MessageFeedbackAssignRequest.java: F:消息反馈指派请求对象(数字员工ID/消息ID/反馈类型/指派人列表/指派理由)
SceneMemoryQueryRequest.java: F:场景记忆查询请求DTO,含场景ID与数字员工ID

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/organization/===
AddUserByOrgDTO.java[DOR_T]: F:向组织新增用户的请求DTO(含组织ID、用户列表、岗位ID、用户类型校验)
DelOrgDTO.java[DD5VS]: F:删除组织入参,组织ID非空校验
UserOrOrgDTO.java[DOR1M]: F:用户或组织目标对象传参,含objectId与USER/ORG类型校验

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/permissiongroup/===
AuthorizedObjectDataPermissionDetailQueryDTO.java[DPER5M]: F:授权对象数据权限详情查询DTO,含权限组ID与用户ID
AuthorizedObjectDataPermissionListQueryDTO.java[DPER5M]: F:授权对象数据权限列表查询DTO,含权限组ID
BatchDeleteAuthorizedObjectDataPermissionDTO.java[DPER5T]: F:批量删除授权对象数据权限请求参数,含权限组ID与授权对象ID列表
BatchDeleteAuthorizedObjectDTO.java[DPER5B]: F:批量删除授权对象的关联ID列表入参
BatchDeleteExcludedObjectDTO.java[DPER5B]: F:权限组批量删除排除对象入参DTO
BatchDeleteResourcePermissionDTO.java[DPE5BS]: F:批量删除权限组资源的请求参数
CategoryDetailQueryDTO.java[DPERM5M]: F:查询目录详情入参DTO,目录ID非空校验
DataPermissionDTO.java[DD5PM]: F:数据权限配置传输对象(数据范围/字段/行级权限)
DeleteAuthorizedObjectDataPermissionDTO.java[DD5T]: F:删除授权对象数据权限入参
DeleteAuthorizedObjectDTO.java[DD5VS]: F:删除权限组授权对象的请求参数,含关联ID及非空校验
DeleteCategoryDTO.java[DD5ST]: F:删除权限组目录请求参数,含目录ID非空校验
DeletePermissionGroupDTO.java[DD5VT]: F:删除权限组请求DTO,携带权限组ID
DimensionListPermissionQueryDTO.java[DPP5VM]: F:维度列表权限查询DTO,校验用户对数据实例列表的访问权限
ExcludedObjectDTO.java[DPE1S]: F:权限组排除对象传输,含权限组ID与排除对象项列表(对象ID/类型/名称/生效时间区间)
PermissionGroupAndCatalogQueryDTO.java[DPER5M]: F:权限组与目录联合查询请求DTO,含模糊匹配查询条件
PermissionGroupBasicInfoDTO.java[DPER5T]: F:权限组基本信息更新DTO（ID/编码/名称/描述/状态，带校验）
PermissionGroupCategoryDTO.java[DPER5T]: F:权限组目录数据传输对象,含目录名/父级/编码/排序/状态/组织ID及校验注解
PermissionGroupDetailQueryDTO.java[DP5ST]: F:查询权限组详情入参DTO,权限组ID非空校验
PermissionGroupDTO.java[DPER5V S]: F:权限组新增/修改数据传输对象,含编码名称状态层级及功能/数据权限配置
PermissionResourceDTO.java[DPER5S]: F:权限资源配置数据传输对象,封装资源ID/类型与权限类型列表(查看/编辑/删除/导出/执行/管理)
ResourceAssociatePermissionGroupsDTO.java[DPER5T]: F:资源关联多个权限组的请求参数
ResourceAttributePermissionByResourceQueryDTO.java[DPM3S]: F:按资源ID查询资源属性权限列表的查询参数
ResourceAttributePermissionDTO.java[DPER5M]: F:资源属性与数据权限范围映射配置项
ResourceAttributePermissionQueryDTO.java[DPER5D]: F:查询资源属性权限列表入参,含资源ID必填校验
ResourceQueryAssociatedPermissionGroupsDTO.java[DD5TT]: F:查询资源关联权限组信息的DTO,含资源ID
UpdateAuthorizedObjectDataPermissionDTO.java[DPE5VS]: F:更新权限组中某用户的授权对象数据权限配置DTO,含数据范围类型与对象列表
UpdateDataPermissionDTO.java[DPER5M]: F:更新权限组数据权限配置(数据范围/字段/行级权限)的传输对象
UpdateResourceAttributePermissionDTO.java[DPER5M]: F:更新资源属性权限请求体,按"资源+属性"粒度配置数据权限范围映射
UpdateResourcePermissionDTO.java[DPER5M]: F:更新权限组功能权限配置入参,含权限组ID与功能权限列表
AuthorizedObjectDTO.java: F:权限组授权对象DTO,含权限组ID与授权对象列表(对象ID/类型user-org-role-position/名称/授权起止时间)
BatchUpdateAuthorizedObjectDataPermissionDTO.java: F:批量更新权限组授权对象数据权限的请求DTO,含数据范围/字段/行级权限配置项

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/pluginmodule/===
RegisterRequest.java[DT5VS]: F:插件模块注册请求,含IP和端口号字段
RegisterResponse.java[DEM5T]: F:插件模块注册响应DTO,含成功标志/消息/数字员工编码与ID/是否新建

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/position/===
CatalogWithPositionsDTO.java[DPO5S]: F:领域及其关联岗位列表DTO,含内部PositionInfo岗位信息类
DigitalPositionCreateDTO.java[DD5VM]: F:创建数字岗位请求DTO(领域ID集合/岗位名/描述,含校验)
DigitalPositionDTO.java[DD5SS]: F:数字岗位DTO,含关联领域信息列表
DigitalPositionUpdateDTO.java[DPO5T]: F:更新数字岗位请求DTO
PositionDelDTO.java[DPO3VT]: F:岗位删除入参,校验岗位ID非空
PositionDTO.java[DPOS5S]: F:岗位信息数据传输对象,含岗位编码/名称/描述/负责人名称
PositionUserBindDTO.java[DPO5V]: F:岗位与用户绑定请求DTO,含岗位ID与用户ID列表及参数校验
ResourcePositionApprovalDTO.java[DPO5T]: F:数字员工岗位资源审批请求参数(岗位/资源/任务ID+审批状态PASS/REJECT+审批意见)
ResourcePositionBindDTO.java[DPO5VT]: F:资源岗位绑定请求DTO

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/resource/===
CallMcpParamsDto.java[DD7TS]: F:MCP工具调用参数(资源ID/工具名/参数Map)
DatasetBuild.java[DD5KM]: F:数据集构建参数,含资源ID与目录路径
DatasetDto.java[DD5KS]: F:数据集资源DTO,区分本地/第三方知识库类型,继承SsResource
DatasetExecuteRequest.java[DD5KS]: F:数据集执行请求DTO,含分页/入参出参/匹配条件
DatasetIdDto.java[DD5TM]: F:数据集ID与路径参数传输对象
DatasetParamQueryResponse.java[DV5M]: F:数据集参数查询响应DTO,含入参/出参字段列表及内部字段信息类
DBDatasetQueryDto.java[DD5VS]: F:资源数据集查询DTO,封装数据集资源ID查询参数
DBDatasetSaveRequest.java[DDR5M]: F:数据集保存请求,含资源ID/画布布局/表关系/数据源ID
DeleteResourcesRequest.java[DD5VS]: F:批量删除资源请求DTO,含资源ID列表非空校验
DigEmployeeDto.java[DED5S]: F:数字员工资源DTO,含智能体类型/头像/授权类型/置顶状态等字段
DigitalEmployeePublishCheckRequest.java[DEM5M]: F:数字员工发布/授权检查请求参数(资源ID、类型、组织与人员ID列表)
MessageDto.java[DC5HM]: F:消息实体DTO,含消息内容/结构/引用/向量/关联对象/会话归属等会话消息核心字段
PermissionDto.java[DAP7M]: F:资源权限授权数据传输对象,含资源ID列表/资源类型/授权类型列表
PublishChannel.java[DEMP5S]: F:发布渠道DTO,含目录ID/组织ID/管理员用户ID/备注
RemoveFileDto.java[DAF5M]: F:删除文件请求参数(资源ID+目录路径)
ResourceCatalogDto.java[DOB5T]: F:资源目录DTO,承载资源标识/类型/名称/归属组织/状态/上下架时间等
ResourceCountDto.java[D7M]: F:资源计数DTO,数字员工各业务类型资源数量统计
ResourceDatasetSaveDto.java[DOB5T]: F:数据集保存请求DTO,含资源名称/描述/类型/外系统编码/实现方式/Worker注册类型,带校验注解
ResourceDetailDto.java[DD5M]: F:资源关联明细数据类,含资源ID/关联资源ID/源主键
ResourceDto.java[DO7TS]: F:资源DTO,承载资源元数据/发布渠道/管理组织/版本/集成方式等字段
ResourceExtAgentDto.java[DEMS]: F:外部智能体资源DTO,继承SsResource并扩展智能体扩展信息
ResourceExtDbDto.java[D]: F:资源扩展数据库DTO,继承SsResource并组合外部数据库扩展信息
ResourceExtDigEmployeeDto.java[DE5M]: F:数字员工资源扩展DTO,继承资源基类聚合数字员工扩展信息
ResourceExtDocDto.java[DK5M]: F:资源扩展文档DTO,继承SsResource并组合扩展文档信息
ResourceExtMcpDto.java[DT5TS]: F:资源扩展MCP服务器DTO,继承SsResource并附带MCP服务器配置
ResourceExtToolDto.java[DT5OM]: F:外部工具资源DTO,继承SsResource并组合SsResExtTool
ResourceExtToolKitDto.java[DTOL5S]: F:工具集扩展DTO,含认证信息headers与关联工具列表
ResourceIdDto.java[DPER3ST]: F:资源ID与编码传输对象
ResourcePageDto.java[D]: F:资源分页查询返回DTO,继承SsResource含上架目录/归属组织/审批用户/权限/置顶/集成方式等扩展字段
ResourcePkIdDto.java[DB1ES]: F:资源下架批量参数DTO,含系统编码与下架资源明细列表
ResourcePublishResult.java[DCORE5T]: F:资源发布结果DTO,含成功/失败资源ID列表与错误消息
ResourceQueryRequest.java[DOB5KM]: F:资源查询请求参数(分页/类型/状态/归属/排序/权限多租户)
ResourceRelationDto.java[DP5ST]: F:资源关联数据传输对象,含资源名称/业务类型/描述/类型及ID(Long序列化为String)
SaveViewResourceRelRequest.java[DVi2S]: F:保存视图与选中对象关系请求,含主从对象关联及重置标志
SsResExtPluginToolDto.java[DToT]: F:插件工具资源扩展DTO,封装插件资源ID与请求头
SsResourceRelDetailDTO.java[DOB5M]: F:资源关联明细DTO,含关联查询的资源类型/业务类型字段及文档/工具/插件/数据集扩展信息。
TestSetResultDTO.java[DK5TM]: F:测试集结果数据传输对象,含提问/回复内容、结果判断与原因
UploadItem.java[DI5OM]: F:上传文件项数据类,含fileId/fileName/filePath/fileUrl
UploadResult.java[DF5O]: F:资源上传结果DTO,含资源ID/编码/名称及上传项列表
DatasetImportDto.java: F:知识库JSON导入数据传输对象
DatasetParamSaveRequest.java: F:数据集入参/出参保存请求DTO,含参数项内部类
DatasetResponse.java: F:数据集响应DTO,含库表关联关系/画布布局/执行SQL等字段
ResourceCatalogTreeVO.java: F:资源目录关联树查询结果VO,含目录/资源信息及子节点树形结构
ResourceEventMessage.java: F:资源变更事件Kafka消息DTO,含载荷/资源信息/元数据嵌套结构
ResourcePkIdDetailDto.java: F:资源主键与业务类型明细数据类
ResourceReferenceDto.java: F:资源引用信息数据类(被引用资源ID/名称/类型/引用配置/时间/状态)
ResourceTypeCount.java: F:资源类型统计详情(知识库/智能体/MCP/工具/对象/视图数量,含知识总数与技能总数计算)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/scheduletask/===
ScheduleTaskCreateRequest.java[DTA3T]: F:定时任务创建请求,任务名称/资源ID/状态/执行周期/频率/时间/内容校验
ScheduleTaskDto.java[DB5TM]: F:定时任务更新请求DTO,继承ScheduleTask扩展执行频率列表字段
ScheduleTaskQueryRequest.java[DT5M]: F:定时任务查询请求,按资源id(数字员工/智能体)查询并转换为ScheduleTaskQo领域参数
ScheduleTaskUpdateRequest.java[DA5VM]: F:定时任务更新请求参数

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/searchask/===
SelectedDatasetDto.java[DB5M]: F:智能问答已选数据集参数,含资源ID列表/会话/智能体/知识库目录类型
SelectedDto.java[DD5TS]: F:搜索问答选中数据传输对象(会话/目录类型/空间数据列表/智能体)
SpaceDataDto.java[DKNOW5M]: F:空间数据传输对象,含数据类型与数据ID

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/session/===
ByaiSessionDto.java[DD5CT]: F:会话DTO,继承ByaiSession含图标与扩展属性列表
SessionUploadResult.java[DH5FM]: F:会话文件上传结果DTO,继承UploadResult携带sessionId
TemplateSessionQueryRequestDto.java[DCH5KT]: F:模板会话分页查询请求参数(类型/终端/关键字/排序/分页)
TemplateSessionQueryResponseDto.java[DCH5T]: F:模板会话查询响应DTO

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/staticdata/===
BatchPropertyDTO.java[DON7S]: F:静态数据批量属性键查询入参DTO,含keys列表非空校验
ConfigListByStandTypeDTO.java[DC5VS]: F:按标准类型查询静态配置列表的入参DTO
DcSystemConfigDTO.java[DD5VS]: F:系统配置参数查询DTO,paramCode必填校验
ParamIdDTO.java[DC5VT]: F:参数ID请求DTO,paramId非空校验
PropertyDTO.java[DD5TT]: F:静态数据属性键DTO,key非空校验
SystemConfigClearCacheRequest.java[DSY5CM]: F:系统配置缓存清除请求,按参数类型/代码清缓存
SystemConfigListDTO.java[DSY5VS]: F:系统配置批量新增/修改入参DTO,含分组编码名称及配置项列表与分组校验
SystemConfigListResponse.java[DH5S]: F:系统配置列表响应,含去重的参数类型与参数代码列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/system/===
SystemFeedbackDTO.java[DB5SM]: F:系统反馈DTO,继承SystemFeedback并附带附件文件ID列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/template/===
MemoryConfigDTO.java[DEM5S]: F:记忆配置DTO,数字员工编辑接口回显场景规则
SceneOperationRequest.java[DD5VS]: F:模板场景操作请求,含模板类型/ID/资源ID/规则名与内容
TemplateRuleInfoCreateRequest.java[DOBC1V T]: F:模版规则信息创建请求,含规则名称/内容/模版类型及校验

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/token/===
RemoveTokenDTO.java[DTO7M]: F:移除访问令牌请求参数,含令牌ID非空校验
TokenDTO.java[DA7TT]: F:访问令牌创建/更新请求参数,含令牌名称校验

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/users/===
AppRefreshTokenLoginRequest.java[DTO]: F:APP端刷新Token登录请求,含refreshToken字段
BatchDelUserDTO.java[DAU5M]: F:批量删除用户请求参数,含待删用户列表
DelUserDTO.java[DD5VS]: F:删除用户请求参数,含用户ID与组织ID且均非空校验
MailServerConfigDTO.java[DA5ST]: F:邮箱服务器配置DTO,兼容前端imap/smtp嵌套结构
ResetPasswordDTO.java[DAU5VS]: F:重置用户密码请求参数
UpdatePasswordDTO.java[DA5M]: F:用户修改密码请求参数(用户ID/旧密码/新密码,带校验)
UserMailAccountDTO.java[DCO5M]: F:用户个人邮箱账号保存/删除/设默认请求DTO,含IMAP/SMTP配置与授权码
UsersDTO.java[DD5VM]: F:用户DTO,含组织/岗位/用户类型校验及SM4加密密码

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/dto/workspace/===
SaveWorkspaceToShowcaseBatchRequest.java[DFI5BM]: F:批量将会话工作区文件保存到成果空间请求
SaveWorkspaceToShowcaseRequest.java[DFI5VT]: F:会话工作区文件保存到成果空间请求参数
SessionWorkspaceCreateRequest.java[DFI5M]: F:会话工作区文件新增请求体
SessionWorkspaceDeleteRequest.java[DCH1T]: F:会话工作区删除请求,含工作区记录主键ID参数校验
SessionWorkspaceFileItem.java[DFI1T]: F:会话工作区单条文件项DTO(批量新增用),含文件名/ID/链接/图标
SessionWorkspaceListRequest.java[DI5TS]: F:会话工作区列表查询请求,按会话维度查询含关键词过滤
SessionWorkspaceResponse.java[DFI5T]: F:会话工作区文件列表项响应DTO
SessionWorkspaceUpdateNameRequest.java[DCH5FT]: F:会话工作区修改名称请求体,含工作区ID与文件名称及校验
SessionWorkspaceBatchCreateRequest.java: F:会话工作区批量新增请求(sessionId/relCount公用+文件列表)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/aimodel/===
AiPrompt.java[AE5M]: F:智能体提示词模板表实体,中英文模板内容/分组编码/模型关联
ByaiAimodel.java[EBM5S]: F:模型定义表实体,模型管理列表编辑调试启停详情

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/auth/===
PrivilegeGrant.java[EPERM1S]: F:授权信息表实体,描述资源对象对授权对象的权限授予记录(使用/管理/强制授权,红黑名单)
PrivilegeGrantWithOrgPath.java: F:带组织/驻地路径的权限授权记录实体,含全公司可见与子驻地判定逻辑

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/contract/===
ChildOrderDto.java[DB5ST]: F:子订单数据传输对象,含子订单号与子订单名称
ContractChunkData.java[EK5TM]: F:合同文档分块数据实体,含文档ID/页码/分块ID/标题链/内容/URL/描述
ContractData.java[DOB1T]: F:合同数据模型,含合同基本信息/发票/子订单信息
InvoiceDto.java[DOB5S]: F:发票数据传输对象,含金额/日期/发票号/不含税金额字段

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/customer/===
CustomerLeadDto.java[DCOML]: F:客户线索列表DTO,封装线索集合
ByaiCustomerLeads.java: F:客户留资实体,记录云栖大会及阿里云环境客户留资信息(byai_customer_leads表)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/datacloud/===
DatacloudLoginType.java[EOBM1S]: F:数据云登录类型表实体,管理登录方式配置信息
DatacloudScriptCategory.java[EOB1S]: F:数据云脚本分类表实体,树形分类含编码/排序/企业隔离
DatacloudScriptExecution.java[EOB5M]: F:数据云脚本执行记录实体,记录脚本执行历史/状态/结果/时长,含企业租户隔离
DatacloudScriptHistory.java[EOB5M]: F:数据云脚本版本历史表实体,记录脚本版本变更历史
DatacloudScript.java[E]: F:数据云脚本主表实体(playwright/api采集脚本管理,含类型/状态/版本/步骤数/发布状态)
DatacloudScriptScenario.java[EOB1M]: F:脚本场景表实体,管理脚本分类目录与场景信息(名称/编码/目标URL/归属系统/父场景/登录类型/排序/企业隔离)
DatacloudScriptStepHistory.java[EDA5M]: F:脚本步骤变更历史记录表实体,记录步骤增删改及顺序变更
DatacloudScriptStep.java[EOB5T]: F:数据云脚本步骤表实体,记录分步采集详情
DatacloudScriptTemplate.java[EOB5M]: F:脚本模板表实体,管理Python/NodeJS脚本模板内容及参数变量定义
DataCloudScriptView.java[EVI3T]: F:数据云脚本视图实体,绑定MCP服务资源与插件引擎资源对象,含发布状态及租户/创建人隔离字段
DatacloudTargetScript.java[EOB5M]: F:数据云录制目标脚本表实体,管理录制脚本的目标选择器脚本(Python/NodeJS脚本内容、选择器、翻页配置、企业租户隔离)
SyncAuthConfig.java[DBO5M]: F:数据云同步鉴权配置实体,含鉴权类型/登录URL/回调/参数位置/鉴权参数
SyncToolProperties.java[DObTS]: F:同步工具属性数据类(类型/描述/示例)
LoginTypeConfig.java: F:数据云登录类型配置(认证方式/登录URL/回调/参数位置/认证参数)
SyncDataCloudToolInfo.java: F:同步给DataCloud MCP服务的工具信息数据类
SyncToolInputSchema.java: F:数据云同步工具入参Schema实体(type/required/properties)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/enterprise/===
EnterpriseInfo.java[EO5M]: F:企业信息领域模型(企业名称/编码/系统名/Logo/版本/数据源切换)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/event/===
Placeholder.java[ECORE1T]: F:占位类,保持event目录结构 | R:- | A:- | S:空类,无逻辑,仅维持目录

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/login/===
SafeAccountMsg.java[EAU1T]: F:短信验证码记录实体(po_safe_account_msg,SM4加密验证码/状态/有效期)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/log/===
ManageLog.java[EAU3M]: F:管理操作审计日志实体(po_manage_log表)
TrackLog.java[ESA1T]: F:前端埋点日志实体,对应表byai_track_log
LogExceptionInfo.java: F:异常日志实体,对应表log_exception_info
LoginLog.java: F:登录日志实体,对应po_login_log表,记录登录登出时间/IP/状态/设备/浏览器/会话等

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/men/===
MenResCom.java[ECE8S]: F:资源组件表实体,资源卡片(动态解释/ui-agent/图表)定义
MenTaskCatalog.java[ETC5T]: F:任务目录实体,任务树形分类管理
MenTask.java[EAT5M]: F:待办任务表实体,审批/输入/授权任务及重派/会话/优先级字段
TaskListResponse.java[DT5KS]: F:监控服务列表查询分页响应
MenTaskRecObj.java: F:待办任务接收对象实体(任务接收方人/智能体/助手映射,含企业隔离)
MenTaskStatusLog.java: F:待办任务状态变更日志实体

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/mode/===
ByaiMode.java[EEM5M]: F:模式与数字员工关联表实体(模式编码/名称/是否默认/前端展示)
ByaiModeDigRel.java: F:模式与数字员工关联实体

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/notification/===
ByaiNotification.java[ECOR5E]: F:通知表实体,对应byai_notification表,含标题/内容/类型/优先级/已读状态/收发者/过期时间等字段

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/ontology/===
ByaiDbresourceRel.java[EOBJ1T]: F:数据库资源关联表实体,映射用户与库的关联关系
SsResExtOntology.java[EOBR1T]: F:资源扩展本体实体,关联资源ID与项目ID

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/operations/===
QueryConfig.java[ECOSL]: F:运营看板动态SQL查询配置实体,定义SQL模板/维度度量条件字段/查询类型与方式(DB/ES)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/organization/===
Organization.java[EORATL]: F:组织实体(po_organization),含编码/名称/类型/父级/层级/路径,带校验注解
OrgExternalSystem.java: F:组织外部系统绑定实体(部门来源映射钉钉/外部组织)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/permissiongroup/===
AuthorizedObjectDataPermission.java[EPER5S]: F:授权对象数据权限实体,为权限组中每个授权对象单独配置数据权限
DefaultDataPermission.java[EPERM1S]: F:默认数据权限实体,映射default_data_permissions表
PermissionGroupAuthorizedObject.java[EPRM1T]: F:权限组授权对象关联实体(用户/组织/角色/岗位)
PermissionGroupCategory.java[EPERM1S]: F:权限组目录实体,支持层级结构与多租户分类管理权限组
PermissionGroupExcludedObject.java[EPERM1S]: F:权限组排除授权对象关联实体,含对象类型与排除生效时段
PermissionGroup.java[EPER5S]: F:权限组实体,映射permission_groups表,支持层级结构与组织隔离
PermissionGroupResourceAttribute.java[EPE5S]: F:资源属性与数据权限范围映射实体(本人/组织/岗位/驻地数据范围)
PermissionGroupResource.java[EPER5S]: F:权限组资源关联实体,映射permission_group_resources表,定义资源ID/类型与权限类型(read/write/delete/export/execute/manage)关联
AuthorizedObject.java: F:授权对象实体(用户/组织/角色/岗位)对应authorized_objects表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/pluginmodule/===
DigitalEmployee.java[EEMP5T]: F:数字员工实体类,映射digital_employee表
FunctionMenuPermission.java[EPER5M]: F:功能菜单权限实体,数字员工菜单可见/可用授权映射
PluginModule.java[ETOOL5S]: F:插件模块实体含host字段

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/position/===
Placeholder.java[EPO1T]: F:岗位entity目录占位类,保持目录结构
PositionExtCatalog.java[EPO5S]: F:数字岗位与领域绑定关系表实体
PositionExternal.java[EPO5M]: F:职位外部系统映射实体,关联岗位与外部系统统一标识
Position.java[EPO5T]: F:岗位实体(po_position表),含名称/描述/数字岗位标识及增改校验
PositionUserRelation.java[EPO5S]: F:数字岗位与管理员用户绑定关系实体
ResourcePositionRelation.java: F:数字岗位与数字员工绑定关系实体(上岗状态/审批)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/resource/===
AiModel.java[AML]: F:AI模型实体,映射byai_aimodel表(模型类型/名称/URL/认证令牌/最大Token等)
SsResExtAttribute.java[ETO5E]: F:资源扩展属性表实体,描述工具/对象动作的入参出参脚本提示词等属性元数据
SsResExtDb.java[EOB5S]: F:数据库扩展资源实体(chatbi知识库映射)
SsResExtDigEmployee.java[EEM5M]: F:数字员工扩展信息表实体,含智能体类型/对接地址/人设/技能/MinIO镜像等字段
SsResExtDoc.java[E]: F:文档库扩展表实体,关联智能体/知识库/插件机器及源目标内容
SsResExtEvaluate.java[EEM5T]: F:数字员工评估旧数据表实体,含准确率/异常率/响应时长/匹配度等评估指标
SsResExtMcp.java[EToS5T]: F:MCP扩展表实体类,存储MCP资源原始与转换后JSON内容
SsResExtMcpServer.java[ETC1S]: F:MCP服务扩展表实体(传输类型/服务地址/命令/参数/环境变量)
SsResExtObject.java[EOB1T]: F:对象扩展表实体(MCP服务URL/传输类型/源目标内容)
SsResExtTestSet.java[EEMP3T]: F:数字员工测试集上传临时表实体,含批次/文件/处理状态/准确率字段
SsResExtTool.java[ETOOL5S]: F:插件工具扩展表实体,存储工具入出参JSON Schema/调用方法/URL/源目标内容
SsResExtView.java[EVE5T]: F:业务视图资源扩展表实体,含MCP服务URL/传输类型与源/目标内容
SsResourceArtifact.java[Eo5sM]: F:资源产物映射表实体(资源ID/产物类型/存储类型/路径/状态/租户comAcctId)
SsResource.java[EOB5M]: F:统一资源主表实体,承载数字员工/智能体/知识库/MCP/工具等所有资源类型的元数据与发布授权状态
SsResourceOperLog.java[EAUDIT5T]: F:资源操作日志表实体类
SsResourceVersion.java[ETOO5L]: F:资源版本表实体,记录智能体/文档库/插件/MCP等资源的版本信息及授权归属
SsResExtAgent.java: F:智能体扩展表实体,记录数字员工类型/SSE对接地址/集成方式/模型配置JSON
SsResExtDbDataset.java: F:数据集扩展表实体(库表关联/画布布局/执行SQL)
SsResExtMcpTool.java: F:MCP工具扩展表实体,存储工具入参JSON Schema
SsResExtToolKit.java: F:插件扩展工具表实体,存储MCP/扩展工具认证头与JSON配置内容
SsResourceCatalog.java: F:资源发布目录表实体(智能体/文档库/插件/数据库/MCP多类型树形目录)
SsResourceRelDetail.java: F:资源关联明细表实体,主从资源关联关系及状态租户隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/sandbox/===
LaunchSandboxQo.java[DB5ST]: F:启动沙箱请求参数(用户/资源ID/环境变量)
SandboxReconcileGroup.java[ESs0T]: F:沙箱对账分组实体,按用户与沙箱类型聚合记录数
SsSandboxRecord.java: F:沙箱记录实体,记录用户沙箱创建/状态/访问/租约生命周期信息

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/scheduletask/===
ScheduleTaskInst.java[ETC5S]: F:定时任务执行实例表实体(byai_schedule_task_inst)
ScheduleTask.java[ECO5S]: F:定时任务元数据表实体(byai_schedule_task),含调度ID/节点/类型/状态/执行周期频率时间内容

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/searchask/===
SpaceDir.java[EKN5S]: F:空间目录表实体byai_space_dir(导入/联网检索/个人企业知识库/钉钉/收藏夹分类树)
SpaceDirRel.java[EKNOWM]: F:空间目录关联关系表实体,对应byai_space_dir_rel,关联目录与业务数据(请求/成果/资源/文件)
WebCrawlArchiveDoc.java: F:联网搜索文档归档表实体(byai_web_crawl_archive_doc)
WebCrawlRequest.java: F:联网搜索归档请求表实体(byai_web_crawl_request),一次DocChain搜索一条记录,request_id为主键

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/session/===
ByaiSession.java[ECC5M]: F:会话主表实体,映射byai_session,含父子会话/关联对象/企业租户/调试标记/状态字段
ByaiSessionExt.java: F:会话扩展参数表实体(键值对扩展)
ByaiSessionMember.java: F:会话成员表实体(群聊成员信息)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/showcase/===
ByaiShowcase.java[EOB5S]: F:成果空间表实体,关联会话/任务/数字员工与对象存储文件

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/source/===
SystemQo.java[DCORE5M]: F:系统数据源查询参数(类型/目录/关键词/状态/组织过滤)
SourceSystem.java: F:外部系统集成配置实体(po_source_system),含SSO/OAuth2/AppKey/Secret等第三方对接信息

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/staticdata/===
ByaiSystemConfig.java[ES5ST]: F:系统静态配置参数实体(text/json类型)
ByaiSystemConfigList.java: F:系统配置列表实体,映射byai_system_config_list表(参数分组/键值/排序)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/station/===
Station.java[EOR3M]: F:驻地信息表实体(po_station,树形层级)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/superassist/===
SuasSuperassist.java[E]: F:超级助理实体类(数字员工/会话知识库/企业归属)
SuasSuperassistResourcePrivilege.java[]: F:超级助手资源授权使用明细DO,记录与规格不一致的单独授权数据(知识库/数据库资源,内部/外部授权)
SuasSuperassistSubAgent.java[EEMP5T]: F:超级助手与子智能体(数字资源)授权关联实体,含订阅/置顶/状态及多租户企业账户隔离字段
SsSuperassistKwCatalog.java: F:会话关联文档库目录关系表实体

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/system/===
AttachFile.java[EFI5S]: F:附件文件实体,映射byai_attach_file表,记录源文件/文件位置/关联表元数据/批次状态
SequenceId.java[ESS5T]: F:序列ID实体,封装自增主键Long id
SysAppVersion.java[ESY5S]: F:应用版本表实体(sys_app_version),含设备类型/版本号/升级策略/强制更新标识
SystemFeedback.java[ESYS1S]: F:系统反馈实体,映射byai_system_feedback表
Sequence.java: F:序列管理表实体,对应byai_sequence,管理系统各类序列生成配置

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/tag/===
ByaiTagRelation.java[EOB5S]: F:标签关系实体,记录对象与标签关联关系

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/template/===
TemplateRuleInfo.java[ECJ5T]: F:模版规则信息实体(超级助手/数字员工规则内容)
ResourceTemplateRelation.java: F:资源模版关联关系表实体,关联模版ID与资源ID并含记忆引擎规则映射

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/temp/===
TempQo.java[DCORE5S]: F:临时组织查询参数对象,含orgName与names列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/users/===
UserExternalSystem.java[EAUTH1T]: F:用户外部系统绑定实体(钉钉/企业微信账号映射)
Users.java[EE5OM]: F:用户实体po_users映射,含账号/邮箱/手机/工号/密码/状态/锁定/苹果登录等字段及校验注解 | R:- | A:- | S:清单层数据类
UsersOrganizationExternalSystem.java[EBO5M]: F:用户组织外部系统映射实体(钉钉等外部系统用户-组织关联)
UsersOrganization.java[EOR5M]: F:用户-组织-岗位关联实体,含用户类型枚举(组织管理/业务管理/平台管理/普通用户/平台运维)
UserMailAccount.java: F:用户个人邮箱账号配置实体(IMAP/SMTP连接及授权码密文)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/workspace/===
ByaiSessionWorkspace.java[EFI5M]: F:会话工作区文件信息实体,映射byai_session_workspace表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/infrastructure/cache/===
ShareCacheUtil.java[UAU8CS]: F:Redis共享缓存读写工具,管理用户/组织/岗位/驻地共享信息 | R:RedisUtil,ShareBfmUser,Constants,Organization,Position,Station,Users,UserStation | A:- | S:静态工具类,SHARE_BFM_USER/ORGANIZATION/POSITION/STATION键前缀,JSON序列化,userCode→userId映射,setShareBfmUser写企业关联

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/infrastructure/config/===
AliyunSmsConfig.java[GA3T]: F:阿里云短信服务配置,封装AccessKey/签名/各业务场景模板代码 | R:- | A:- | S:ConfigurationProperties绑定aliyun.sms前缀,内嵌Templates静态类含登录/注册模板,Lombok-Data
SmsRateLimitConfig.java[GAUTH3T]: F:短信验证码限流配置(IP窗口/手机号重复间隔/过期时间) | R:- | A:- | S:@ConfigurationProperties(sms.rate.limit),intervalMinutes/maxCount/repeatedInterval/smsExpireTime

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/infrastructure/embedding/config/===
FaasConfig.java[GKN3S]: F:FAAS embedding服务相关URL与认证配置(知识切分/向量/召回/重排) | R:- | A:- | S:segmentation/embedding/rerank等多URL,token校验,POJO配置类

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/infrastructure/embedding/request/===
CallMaasEmbeddingQo.java[DEM5S]: F:调用MaaS向量化嵌入服务请求参数(模型+待嵌入数据列表)
CallEmbeddingQo.java: F:调用向量化嵌入接口的请求参数

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/infrastructure/embedding/response/===
Data.java[DE5VM]: F:Embedding向量响应数据项,含object/embedding向量/index
EmbeddingResult.java[DEMB5VS]: F:向量嵌入接口返回结果数据类(类型/data列表/模型名)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/infrastructure/enums/===
MetaDataEnum.java[KCO1T]: F:元数据类型枚举(智能体/文档库/数据库/插件/目录) | R:- | A:- | S:code+name双字段,@AllArgsConstructor

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/infrastructure/exception/===
OAuth2ExceptionHandler.java[HAU5M]: F:OAuth2异常全局处理,授权端点错误重定向/其他端点返回JSON错误响应 | R:OAuth2Exception.java | A:- | S:@ControllerAdvice,授权端点错误重定向带error/state参数URL编码,错误码映射HTTP状态(invalid_request→400/invalid_client→401/access_denied→403),通用异常兜底server_error
OAuth2Exception.java[EAUTH5M]: F:OAuth2异常体系,符合RFC6749标准错误响应 | R:- | A:- | S:继承RuntimeException,error/errorDescription/errorUri三字段,内置11类标准错误静态子类(InvalidRequest/InvalidClient/InvalidGrant/UnauthorizedClient/UnsupportedGrantType等)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/infrastructure/kafka/===
ZlogAdapter.java[USA5AS]: F:Zlog日志Kafka适配器,初始化连接并异步发送消息到指定topic | R:ZlogKafkaAdapter.java,ZlogKafkaConfig.java | A:- | S:InitializingBean,ConditionalOnProperty条件装配,afterPropertiesSet加载配置初始化,CompletableFuture异步send
ZlogKafkaAdapter.java[USYS5M]: F:Kafka消息生产者适配器,封装多认证模式(SCRAM/PLAIN/SSL/Kerberos)的Producer构建与发送 | R:KafkaTemplate,DefaultKafkaProducerFactory | A:- | S:Properties构造配置,send发送topic消息,支持sasl_ssl/kerberos系统属性配置,protobuf字节序列化,审计日志投递
ZlogKafkaConfig.java[GAU5T]: F:Kafka审计日志配置读取,从Environment取zlog.adapter.kafka前缀属性 | R:Environment | A:- | S:继承Properties重写getProperty加固定前缀,重写equals/hashCode消FindBugs告警

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/infrastructure/sms/===
AliyunSmsService.java[SAU5S]: F:阿里云短信发送服务,支持登录/注册验证码模板 | R:AliyunSmsConfig.java,BaseException.java,I18nUtil.java | A:- | S:dysmsapi20170525-Client,手机号验证码数字校验,模板按类型路由,签名名ISO-8859-1转UTF-8修正,响应码OK判定

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/aimodel/===
ModelManagementController.java[CMO8WL]: F:模型管理控制器,提供模型CRUD/分页/状态切换/默认模型设置及Chat/Rerank/Embedding调试流式代理 | R:ModelManagementApplicationService,GptProxyChatCompletionsStreamApplicationService,ModelDebugRerankApplicationService,ResponseUtil | A:/new/model/{getModelListByPage,getModelDetail,upsertModel,deleteModel,setModelStatus,debugModelStream,debugModelRerank,debugModelEmbedding,listModel,getDefaultModelId,setDefaultModel} | S:SseEmitter流式调试,debug成功OOA失败OOD并同步Redis,@ManageLogAnnotation审计,@Valid校验

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/app/===
AppAuthController.java[CAU8JT]: F:APP端刷新Token静默登录认证 | R:AppAuthApplicationService,AppRefreshTokenLoginRequest,ResponseUtil | A:POST /app/auth/refreshTokenLogin | S:冷启动RefreshToken静默登录,try-catch兜底返回fail
AppleLoginController.java[CAU7EM]: F:苹果Sign In with Apple登录,绑定/注册已有用户并直接建会话,短信验证码校验 | R:AppleLoginService,AppleLoginSessionService,SafeAccountMsgService,AesUtils,Sm4Util,LoginResponse | A:/login/apple/verify,/public-keys,/bind/existing,/bind/register,/bind/verify-token | S:identityToken验证,SM4验证码加密,AES手机号解密,验证码状态置过期,登录会话创建

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/auth/===
AuthController.java[CBP9PM]: F:授权管理控制器,资源使用/管理/分享/归属/组织授权及红黑名单、使用申请审批、资源成员设置、数字员工与资源权限查询、管理员校验 | R:AuthApplicationService,ResourceAuthApplicationService,OrganizationService,SsResourceService,DigitalEmployeeApplicationService,CurrentUserHolder | A:/auth/privilegeGrant/{availableUseAuth,shareUseAuth,allowManageAuth,ownerAuth,batchHandleAuth,applyUse,approveUseApply,rejectUseApply,queryResourceMembers,setResourceManagers,setResourceUsers,queryResourceOperationPermissions,listResourceUseAuth,...} | S:GrantType分流(FORCE_USE/SHARE_USE/ALLOW_MANAGE/OWNER/AVAILABLE_USE),validateResourceForAuthorization校验publish_portal,平台/组织管理员权限校验,enrichResourceListScope个人默认资源与企业全量口径补齐,多租户隔离,ManageLogAnnotation审计
AuthSearchController.java[CAU7KS]: F:授权对象综合搜索控制器,分页查找组织/用户/岗位/驻地及按用户ID查组织 | R:AuthSearchApplicationService,QueryObject,ResponseUtil,PageInfo | A:/auth/privilegeGrant/{findAll,findOrg,findUser,findPosition,findStation,findUserOrganizationsByUserIds} | S:POST入口,分页查询授权候选对象,委托应用服务
ResourcePermissionScopeController.java[CAU7PBM]: F:资源权限范围分析,单/批量分析资源权限范围及用户权限校验 | R:ResourcePermissionScopeService,PermissionDto,ResponseUtil | A:/api/v1/auth/permission-scope/analyze,/analyze-batch,/check-permission,/analyze-code,/analyze-batch-codes | S:GET单资源分析,POST批量分析,用户权限检查,返回数字代码map

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/conversation/===
ConversationController.java[CC7M]: F:对话消息管理控制器,提供对话列表查询/接入终端/反馈处理/导出 | R:ConversationService,ConversationExportService,MessageQo,FilterQo,HandleFeedbackMsgQo,I18nUtil | A:/system/message/{list,accessTerminalList,projectIdList,getContentFeedbackType,getSuassList,handleFeedbackMsg,export} | S:Excel导出走HttpServletResponse,反馈类型支持多语言,统一ResponseUtil封装

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/customer/===
CustomerLeadsController.java[CC7BS]: F:客户线索新增与批量导入接口 | R:CustomerLeadsService,ByaiCustomerLeads,CustomerLeadDto,ResponseUtil | A:/customer/leads/add,/customer/leads/batchAdd | S:单条addLead返回id,batchAdd批量返回计数

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/datacloud/===
DatacloudLoginTypeController.java[CO7BM]: F:数据云登录类型管理控制器,提供增删改查/批量删除/启用禁用/统计 | R:DatacloudLoginTypeService,ResponseUtil,ManageLogAnnotation | A:/datacloud/loginType/{queryLoginTypeList,queryActiveLoginTypes,queryLoginTypeById,addLoginType,updateLoginType,deleteLoginType,batchDeleteLoginTypes,updateLoginTypeStatus,queryLoginTypeStatistics} | S:企业级隔离enterpriseId,操作日志注解,参数校验Validated,批量删除QO
DatacloudScriptCategoryController.java[COB7NKM]: F:数据云脚本分类管理控制器,支持分页/树形/详情查询、增删改、批量删除及分类统计 | R:DatacloudScriptCategoryService,ResponseUtil,ManageLogAnnotation | A:/datacloud/scriptCategory/{queryScriptCategoryList,queryScriptCategoryTree,queryScriptCategoryById,addScriptCategory,updateScriptCategory,deleteScriptCategory,batchDeleteScriptCategories,queryCategoryStatistics} | S:企业ID树形结构,@Validated参数校验,操作日志审计,批量删除QO,分类统计
DatacloudScriptController.java[CDC5KM]: F:数据云脚本采集管理控制器,脚本增删改查/复制/发布/统计 | R:DatacloudScriptService,ResponseUtil,ManageLogAnnotation | A:/datacloud/script/{queryScriptList,queryScriptDesc,addScript,updateScript,deleteScript,batchDeleteScripts,copyScript,queryPopularScripts,queryRecentScripts,queryScriptStatistics,publish,unPublish} | S:分页查询,热门/最近脚本,企业ID维度统计,操作日志注解,参数校验
DatacloudScriptExecutionController.java[CDB7KM]: F:数据云脚本执行记录管理控制器,提供执行记录CRUD/批量删除/取消执行/多维统计 | R:DatacloudScriptExecutionService,ResponseUtil,ManageLogAnnotation | A:/datacloud/scriptExecution/{queryScriptExecutionList,queryExecutionsByScriptId,queryScriptExecutionById,addScriptExecution,updateScriptExecution,deleteScriptExecution,batchDeleteScriptExecutions,cancelScriptExecution,queryExecutionStatistics,queryExecutionStatusStatistics,queryScriptExecutionStatistics,queryRecentExecutions} | S:按enterpriseId企业隔离,分页查询,操作审计日志,统计接口默认limit=10
DatacloudScriptScenarioConfigController.java[COB7KS]: F:数据云脚本场景配置保存与分页查询 | R:DatacloudScriptScenarioConfigService,DatacloudScriptScenarioConfigDTO,DatacloudScriptScenarioConfigQueryDTO | A:POST /datacloud/scenarioConfig/save,/list | S:RestController,参数校验Validated,分页查询委托Service
DatacloudScriptScenarioController.java[COB7NS]: F:数据云脚本场景管理控制器,提供场景增删改查与树形结构查询 | R:DatacloudScriptScenarioService,DatacloudScriptScenarioQueryDTO,DatacloudScriptScenarioDTO,DatacloudScriptScenarioBatchDeleteQO,ResponseUtil | A:/datacloud/scenario/{queryScenarioList,queryScenarioTree,queryScenarioById,addScenario,updateScenario,batchDeleteScenarios} | S:分页/树形/详情查询,参数校验Validated,操作日志ManageLogAnnotation,批量删除
DatacloudScriptScenarioTargetScriptController.java[CO7KM]: F:数据云脚本场景目标组件配置分页查询 | R:DatacloudTargetScriptService,DatacloudScriptScenarioConfigQueryDTO,ResponseUtil | A:POST /datacloud/targetScript/list | S:场景配置列表分页,委托service查询,参数校验
DatacloudScriptTemplateController.java[CDS7KM]: F:数据云脚本模板管理控制器,提供模板增删改查/批量删除/状态切换/可用列表/名称查重 | R:DatacloudScriptTemplateApplicationService,ResponseUtil,DatacloudScriptTemplateDTO,DatacloudScriptTemplateQueryDTO,DatacloudScriptTemplateBatchDeleteDTO | A:/api/datacloud/scriptTemplate/{list,save,update,batch-delete,available,check-name,{id},{id}/status} | S:REST控制器,分页查询,企业ID维度多租户隔离,模板类型/框架过滤,启用禁用
DatacloudScriptViewController.java[CVE7BKM]: F:数据云脚本采集视图管理控制器,提供视图分页查询、脚本视图增改删及场景发布/取消发布 | R:DataCloudScriptViewService,DatacloudScriptQueryDTO,DataCloudScriptViewQueryDTO,DataCloudScriptView,ManageLogAnnotation,ResponseUtil | A:/datacloud/scriptView/{queryViewList,queryViewScriptList,addScriptView,updateScriptView,batchDeleteView,publish,unPublish} | S:全POST,@ManageLogAnnotation记审计,@Validated校验,委托service,分页查询双入口

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/digitemploy/===
DigitalEmployeeController.java[CEM9SW]: F:数字员工CRUD/详情/默认设置/一键生成/调试对话(SSE)/技能目录树/状态统计/调试消息清理 | R:DigitalEmployeeApplicationService,SsResourceCatalogService,ChannelServiceFactory,CompletionsUtils,AssistantChatDto | A:/digitalEmployeeController/{selectDigitalEmployeeByQo,queryAllDigitalEmployeeList,saveDigitalEmployee,updateDigitalEmployee,setDefaultDigitalEmployee,deleteDigitalEmployee,checkEmployeeAudit,findDetailsById,queryRelResourceInfo,queryCatalogTree,v2/generate,debugSession,debugChat,getMessageList,queryResourceListByDefaultType,getStatusNumStatics,cleanupDebugMessages} | S:渠道工厂按accessTerminal分流,调试模式DEBUG_1,流式输出OutputStream,synOpenClawWorkSpace同步运行期字段,ManageLogAnnotation审计
MetaPromptController.java[CEM7WS]: F:数字员工/技能元提示词生成控制器,支持同步与SSE流式生成 | R:MetaPromptService,MetaPromptGenerateRequest,MetaPromptGenerateResult,CompletionsUtils,ResponseUtil,I18nUtil | A:POST /meta/prompt/v3/digitalmploy,/digitalmploy/stream,/skill | S:generateV3同步返回扁平字段Map含contextSummary,generateV3Stream走text/event-stream输出流,@Valid参数校验,LLM调用

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/enterprise/===
EnterpriseController.java[CORG7VS]: F:企业信息管理(查询/编辑企业信息及系统名称、Logo上传与读取) | R:EnterpriseInfoService,ResponseUtil | A:/system/enterprise/getEnterprise,/editEnterprise,/getEnterpriseLogoData | S:POST查询/编辑,@Size参数校验,MultipartFile上传Logo,GET直写HttpServletResponse输出Logo流

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/files/===
FilesController.java[CFC5OM]: F:通用文件上传/下载/预览/查看,支持图标上传与未登录重定向登录页 | R:FilesApplicationService,SessionFilter,ByaiSystemConfigService,CurrentUserHolder,Files | A:/commonFile/uploadIcon,/preview,/download,/view | S:MultipartFile上传图标,MinIO桶预览下载,fileId下载,view检查session登录态未登录跳mobile/login,URLEncode回跳URL

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/login/===
LoginController.java[CAU8JM]: F:登录认证控制器,当前用户/登出/登录类型/SSO令牌/图形验证码/短信验证码/系统配置 | R:LoginApplicationService,LoginService,SsoTokenService,CaptchaService,SmsCaptchaRequest,LoginInfo | A:/system/session/{currentUser,logout,getLoginType,createIwhaleToken,captcha,sms/send,getDcSystemConfigValueByCode(s)} | S:Session会话认证,SSO单点令牌,图形+短信双验证码,环境配置免登查询
SocialController.java[CAU8GS]: F:第三方/社交登录控制器,处理二维码登录、SSO单点、微信公众号验证 | R:SocialApplicationService,ResponseUtil,LoginResponse | A:GET /system/social/{getQrCodeUrl,loginBySocial,{socialType}/callback,wechatMp/check,getSSOUrl} | S:扫码登录,OAuth回调code/state,微信echostr签名校验,SSO地址生成
WeiXinController.java[CA5TM]: F:微信开放平台OAuth登录(授权跳转/回调/服务器校验) | R:JustAuth AuthWeChatOpenRequest | A:GET /system/weixin/check,/authorize,/loginByWeiXin | S:check回显echostr做服务器认证,authorize返回授权URL,loginByWeiXin凭code换AuthUser,AuthConfig硬编码占位待配置

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/log/===
LogExceptionInfoController.java[CAU5S]: F:异常日志信息保存接口,接收前端上报的异常实体并落库 | R:LogExceptionInfoApplicationService,LogExceptionInfo,ResponseUtil | A:/logExceptionInfoController/saveLogExceptionInfo | S:POST单接口,委托ApplicationService处理,try-catch吞异常仅记日志,恒返成功响应
TrackLogController.java[CAU5BS]: F:埋点日志采集接口,单条/批量/URL编码三种方式保存埋点 | R:TrackLogApplicationService,BatchTrackLogDto,TrackLog,ResponseUtil | A:/trackLogController/{saveTrackLog,batchSaveTrackLog,saveTrackLogByURLEnCode} | S:POST单条与批量,GET接收URI编码JSON,异常仅记录日志统一返回成功

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/memory/===
MemoryLibraryController.java[CC7MS]: F:记忆库管理,按用户+数字员工查询记忆库ID(超级助手则agentId=userId) | R:MemoryLibraryService,CurrentUserHolder,ResponseUtil,MemoryLibrary | A:POST /memoryLibrary/getMemoryLibraryId | S:从当前用户取userId,Map参数解析agentId/libraryType,多租户用户隔离,Map取Long工具方法

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/oauth2/===
OAuth2AuthorizationServerController.java[CAU9JL]: F:OAuth2授权服务器,实现标准授权码流程含PKCE/速率限制 | R:OAuth2AuthorizationService,OAuth2RateLimitService,SourceSystemService,CurrentUserHolder,SourceSystem | A:GET /oauth2/authorize,POST /oauth2/token,POST /oauth2/refresh,GET /oauth2/userinfo,POST /oauth2/revoke,POST /oauth2/introspect,GET /oauth2/.well-known/oauth-authorization-server | S:授权码生成与回调重定向,access/refresh令牌签发,Bearer用户信息,令牌撤销内省,PKCE校验S256/plain,client_secret校验,X-Forwarded-For取真实IP,服务器元数据

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/openapi/===
OpenApiController.java[CCO7FL]: F:系统内部统一对外OpenAPI,对象动作保存/通知创建/挂载目录查询/数字员工资源挂载与取消挂载并同步OpenClaw工作空间 | R:OpenApiApplicationService,DigitalEmployeeApplicationService,OntologyOpenService,SsResourceCatalogService,ResponseUtil | A:POST /open/api/createOrUpdateOntology,/notice/create,/v1/queryCatalogTree,/v1/mountDigEmployeeResource,/v1/unMountDigEmployeeResource | S:Feign跨服务调用入口,挂载后透传原始入参同步沙箱工作空间,catalogType=6领域目录,@ManageLogAnnotation审计
OpenFileController.java[CFL8OM]: F:开放API智能体文件管理(上传/查询/下载/元信息/删除/批量标签增删) | R:FilesApplicationService,OpenFileQueryDTO,OpenFileTagDTO,UploadFilesRespDto,ManageLogAnnotation | A:/open/api/v1/{uploadFiles,queryFiles,downloadFiles,queryFileMeta,deleteFiles,addFileTags,deleteFileTags} | S:multipart上传带标签会话隔离,标签any/all匹配模式校验,MinIO下载流式响应,审计日志注解
OpenOrganizationController.java[CRG7M]: F:开放API组织管理控制器,提供组织树查询/增删改/详情/发布组织管理员业务员查询 | R:OpenOrganizationApplicationService,OrganizationApplicationService,OrganizationService,OpenOrgDTO,DelOrgDTO,OrgTreeQo,OrgManagerQo | A:/open/api/{getOrgTree,addOrg,updateOrg,delOrg,qryOrgById,getPublishByOrgId} | S:POST全量,ManageLogAnnotation审计,Add/Mod分组校验,I18nUtil国际化提示,租户隔离
OpenPositionController.java[CPO7VS]: F:开放API岗位管理(列表/新增/修改/删除) | R:OpenPositionApplicationService,OpenPositionDTO,PositionDelDTO,Position,ResponseUtil | A:/open/api/{listPosition,addPosition,updatePosition,removePosition} | S:POST统一入口,Add/Mod分组校验,ManageLog审计,I18n国际化消息,分页返回
OpenStationController.java[CO7VS]: F:OpenAPI驻地(Station)增删改查Controller | R:OpenStationApplicationService,OpenStationDTO,Station,QueryObject | A:/open/api/{listStation,addStation,updateStation,delStation} | S:POST统一,分组校验Add/Mod/Del,ManageLogAnnotation审计,分页PageInfo,I18n提示
OpenUserController.java[CAU7VL]: F:OpenAPI开放接口用户管理,提供员工增删改查及按组织/编码查询用户信息 | R:UserApplicationService,OpenUserApiApplicationService,LoginApplicationService,OpenUserDTO,OpenDelUserDTO,UsersByOrgIdQo | A:/open/api/{listUser,addUser,updateUser,delUser,getUsersByOrgId,getAllUserInfoByUserCode} | S:对外API,ManageLogAnnotation操作日志,Add/Mod分组参数校验,i18n国际化提示,分页查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/operations/===
OperationsDashboardController.java[CV7KM]: F:运营看板控制器,动态执行SQL查询与查询配置列表 | R:OperationsQueryService,OperationsQueryRequest,QueryConfigListDTO,ResponseUtil | A:POST /operations/dashboard/query,GET /operations/dashboard/config/list | S:queryCode/queryType动态SQL,日期范围参数,分页结果,维度/度量/条件字段配置
OperationsDigEmployeeController.java[CEM7KM]: F:数字员工运营数据分析接口,基础信息/使用指标/评估详情/立即评估/测试集上传与批次结果分页 | R:OperationsDigEmployeeService,ResponseUtil,I18nUtil | A:/operations/digEmployee/{getOperationsInfo,getMetrics,getEvaluateDetail,immediatelyEvaluate,uploadTestSet,getTestSetResult,getTestSetResultPage} | S:GET基础信息,POST指标/评估,MultipartFile上传测试集,分页查询批次结果,多租户运营分析

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/organization/===
OrganizationController.java[CORG7VM]: F:组织管理控制器,组织树CRUD/成员添加/归属管理员查询/权限校验 | R:OrganizationApplicationService,OrganizationService,Organization,OrgManagerQo,OrgTreeQo,SearchOrgQo,AddUserByOrgDTO,DelOrgDTO,OrgManagerVo | A:/system/organization/{addOrg,updateOrg,delOrg,getFirstOrgId,searchOrg,getOrgTree,addUserByOrg,getOrgManager,getPublishByOrgId,isOrgManager} | S:Add/Mod分组校验,ManageLogAnnotation审计,I18nUtil国际化,多租户隔离,组织树查询,发布组织管理员/业务员查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/permissiongroup/===
PermissionGroupCategoryController.java[CPER7VM]: F:权限组目录管理REST控制器,提供目录分页/树/详情查询及增删改 | R:PermissionGroupCategoryApplicationService,ResponseUtil,ManageLogAnnotation | A:/system/permissionGroupCategory/{queryPage,queryTree,detail,add,update,delete} | S:POST接口,@Valid参数校验,操作日志注解,树形目录,增删改委托应用服务
PermissionGroupController.java[CPE8PVL]: F:权限组管理控制器,提供权限组CRUD/授权对象/排除对象/资源权限/数据权限/属性权限/维度校验/资源关联权限组全套REST端点 | R:PermissionGroupApplicationService,ResponseUtil,ManageLogAnnotation | A:/system/permissionGroup/{queryPage,detail,add,update,delete,authorizedObject/*,excludedObject/*,resourcePermission/*,updateResourcePermissions,updateDataPermission,authorizedUser/queryPage,availableObject/queryPage,resourceAttributePermission/*,authorizedObjectDataPermission/*,checkDimensionListPermission,resource/associatePermissionGroups,resource/queryAssociatedPermissionGroups} | S:全POST,@Valid参数校验,@ManageLogAnnotation审计写操作,批量删除,可见可用可执行三层授权数据权限配置

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/pluginModule/===
PluginModuleRegisterController.java[CTO7VS]: F:插件模块注册控制器,提供搜问/FunctionCloud/DataCloud三类插件注册端点 | R:PluginModuleRegisterService,RegisterRequest,RegisterResponse,ResponseUtil,ManageLogAnnotation | A:POST /pluginModule/register/{searchQuery,functionCloud,dataCloud} | S:构造注入Service,@Valid参数校验,操作日志注解,统一ResponseUtil响应

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/position/===
DigitalPositionController.java[CCP5VM]: F:数字岗位管理控制器,提供岗位CRUD及用户绑定/解绑、管理员查询 | R:DigitalPositionApplicationService,ResponseUtil,ManageLogAnnotation | A:/system/digitalPosition/{create,search,update,delete/{id},bindUser,unbindUser,searchAdmins} | S:岗位绑定领域多选,按领域过滤分页,用户关联绑定,审计日志注解,参数校验
PositionController.java[CPOS7VM]: F:岗位管理REST控制器,岗位列表/岗位用户查询/增删改 | R:PositionApplicationService,Position,PositionQo,PositionUsersQo,PositionUsersVo,PositionDelDTO | A:/system/position/{searchPositionList,searchPositionUsersByQo,addPosition,updatePosition,removePosition} | S:分页PageInfo,Add/Mod分组校验,ManageLogAnnotation审计日志,ResponseUtil统一响应
ResourcePositionRelationController.java[CPO7VKM]: F:数字岗位与数字员工绑定关系控制器,处理上岗/下岗/绑定/解绑及员工评估分页查询 | R:ResourcePositionRelationApplicationService,ResourcePositionBindDTO,PositionResourceSearchQO,SsResExtEvaluateQO,PositionDigitalEmployeeVo | A:/system/resourcePositionRelation/{searchResources,bindPositionResource,unbindPositionResource,onJob,offJob,evaluate/queryPage} | S:POST端点,@Valid参数校验,分页返回员工与评估结果,ResponseUtil统一包装

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/resource/===
AiModelController.java[CMO5L]: F:AI模型管理控制器,查询所有AI模型列表 | R:AiModelDbService,AiModel,ResponseUtil | A:POST /new/aimodel/getAiModels | S:单接口查询全量模型列表,委托AiModelDbService
OntologyController.java[CO7VM]: F:业务对象(本体)管理控制器,提供对象增删改查/关联关系/动作属性批量保存 | R:OntologyService,OntologyApplicationService,OntologyOpenService,ResponseUtil,ManageLogAnnotation | A:/ontology/create,/createRelation,/update,/delete,/deleteRelation,/saveBatch,/saveOntologyFull,/saveOntologyActions,/saveAttributes,/queryRelObjects,/queryDetail | S:11个POST端点,@Validated参数校验,sourceType=4分流到saveAttributes,操作日志注解,SsResource返回
SsResourceCatalogController.java[CVO5KM]: F:资源目录管理控制器,提供目录CRUD及目录树/资源关联树/按目录过滤资源分页查询 | R:SsResourceCatalogService,ResponseUtil,CatalogDto,CatalogQo,ResourceCatalogTreeVO | A:/catalog/create,/update,/delete,/queryById,/queryList,/queryCatalogTree,/queryChildren,/queryResourceListByCatalogId,/queryResourceCatalogTree | S:ManageLogAnnotation审计,PageHelper分页buildPageRes,内部静态Request类,资源领域要素过滤
SsResourceDataSetController.java[CON7VM]: F:数据库数据集资源管理(增删改查及入参出参配置) | R:SsResExtDbDatasetService,ResponseUtil,ResourceBizType,I18nUtil | A:/dataset/createResource,/save,/query,/saveParams,/queryParams,/delete | S:DB_DATASET类型校验,参数回显,级联删除,ManageLog审计,@Valid校验
TemplateRuleInfoController.java[CEM7VM]: F:模版规则与场景管理(数字员工/超级助手关联场景的增删改查) | R:TemplateRuleInfoApplicationService,SceneOperationRequest,TemplateRuleInfoCreateRequest,TemplateRuleInfoQueryQo | A:/templateRuleInfo/{create,query,deleteScene,updateScene,updateMemoryRuleId} | S:创建模版,分页模糊+时间段查询,删场景调智能体Feign,改场景传sceneId,更新memory_rule_id关联,ManageLog审计
< /br>

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/source/===
SourceSystemController.java[CO5M]: F:驻地源系统查询控制器,查询除BYAI外的所有系统及按类型过滤 | R:SourceSystemService,SourceSystem,SystemQo,ResponseUtil | A:/system/sourcesystem/getSourceSystemList,/getSourceSystemListByType | S:GET全量查询,POST按类型过滤,委托service返回列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/staticdata/===
PropertyController.java[CSY5BT]: F:系统配置属性查询接口,支持单个/批量查询配置键 | R:PropertyApplicationService,PropertyDTO,BatchPropertyDTO,ResponseUtil | A:POST /system/property/qryPropertyKey,/bathQryPropertyKey | S:RestController,委派ApplicationService,参数@Validated校验,批量查询
StaticDataQueryController.java[CSY5VT]: F:系统静态参数配置查询控制器,按paramCode获取系统配置 | R:StaticDataQueryApplicationService,DcSystemConfigDTO,ByaiSystemConfig,ResponseUtil | A:POST /system/staticdata/getDcSystemConfig | S:单接口查询系统配置,参数校验@Validated,委托应用服务
SystemConfigController.java[CSY5KCS]: F:系统静态配置增删改查及缓存刷新 | R:SystemConfigApplicationService,ByaiSystemConfig,SystemConfigQo,ResponseUtil,I18nUtil | A:/system/systemConfigController/{selectSystemConfigByQo,getSystemConfigById,saveSystemConfig,updateSystemConfig,deleteSystemConfigById,clearOneSystemConfigCache,clearAllSystemConfigCache} | S:分页查询,按ID增删改,单个/全部缓存刷新,操作日志注解,Add/Mod分组校验,i18n消息
SystemConfigListController.java[CSY5CM]: F:系统静态参数配置CRUD与缓存刷新控制器 | R:SystemConfigListApplicationService,SystemConfigListDTO,SystemConfigListGroupVo,QueryObject,I18nUtil,ManageLogAnnotation | A:/system/systemConfigListController/{selectSystemConfigListByQo,saveSystemConfigList,updateSystemConfigList,deleteByParamGroupCode,getByParamGroupCode,clearOneByParamGroupCode,clearAllSystemConfigListCache} | S:分页分组查询,Add/Mod分组校验,按分组编码增删改查,单个/全部缓存刷新,操作日志注解,i18n消息

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/station/===
StationController.java[CO5N]: F:驻地组织控制器,提供驻地树构建/子驻地列表/驻地详情查询 | R:StationService,ResponseUtil,I18nUtil,StationTreeQo,SearchStationQo | A:/system/station/getStationTree,/getStationsByParent,/getStationById | S:树形层级构建,父ID查子节点,ID查详情,空校验返回i18n错误

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/system/===
SystemFeedbackController.java[CSY5OS]: F:系统反馈提交与反馈附件上传 | R:SystemFeedbackApplicationService,SystemFeedbackDTO,ResponseUtil | A:/system/feedback/save,/system/feedback/uploadFeedbackFile | S:POST保存反馈,multipart批量上传文件至MinIO,Add校验组

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/temp/===
TempController.java[CCC3T]: F:临时接口,按组织和姓名查询用户邮箱/姓名 | R:UserService,TempQo | A:/temp/queryEmail,/temp/queryName | S:两POST端点委托UserService,返回Map<String,List<String>>

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/token/===
UserAccessTokenController.java[CTO7KS]: F:用户访问令牌管理REST入口,提供令牌列表查询/创建/移除 | R:UserAccessTokenApplicationService,ResponseUtil,I18nUtil,AccessTokenQo,TokenDTO,RemoveTokenDTO | A:POST /system/userAccessToken/{list,createToken,removeToken} | S:分页PageInfo,@Validated参数校验,@ManageLogAnnotation操作审计,i18n消息

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/controller/user/===
UserController.java[CCR8PVM]: F:用户人员管理控制器,提供用户增删改查、密码重置/修改、组织员工查询、超级助手信息维护、用户注销及手机号批量加密更新 | R:UserApplicationService,SuasSuperassistService,ResponseUtil,ManageLogAnnotation | A:/system/user/{addUser,updateUser,delUser,searchUser,getUsersByOrgId,resetPassword,batchDelUser,findSimpleUsersById,updatePassword,findUserSuas,getUserSuas,findByUserId,updateBySuperassistId,inactiveUser,batchUpdateUserPhones} | S:全POST/GET,分组校验Add/Mod,分页PageInfo返回,操作日志注解,多租户隔离,手机号加密
UserMailAccountController.java[CCO5MS]: F:个人中心邮箱账号管理,增删查与默认设置 | R:UserMailAccountApplicationService,UserMailAccountDTO,UserMailAccountVO,ResponseUtil | A:/userMailAccount/list,/save,/delete,/setDefault | S:RestController,按用户隔离的邮箱账号CRUD,setDefault设默认账号

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/interfaces/response/===
ResponseUtil.java[UAC3FM]: F:统一响应封装工具,提供成功/失败构造及Feign响应(知识/会话/管理端)转百应格式 | R:KnowledgeResponse,ConversationResponse,ManagerResponse | A:- | S:泛型code/msg/data,SUCCESS=0/FAIL=-1,converResponseUtil重载转换三类Feign响应,resultCode/errorCode不序列化

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/aimodel/===
AiPromptMapper.java[MMD5T]: F:智能体提示词模板表CRUD Mapper接口
ByaiAimodelMapper.java[AMM5KS]: F:模型定义表数据访问,条件查询/统计/同名校验/分页列表 | R:ByaiAimodel,ModelRequest,BaseMapper | A:- | S:MyBatisPlus,selectByCondition配PageHelper分页,countByModelNameExcludeId校验重名,listModel/listModelInner内外区分

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/auth/===
PrivilegeGrantMapper.java[MPE8M]: F:权限授权记录Mapper,查询授权对象/红黑名单/资源授权/数字员工授权/用户管理组织及联表组织路径 | R:PrivilegeGrant,PrivilegeGrantWithOrgPath,PrivilegeGrantVo,AuthVo,ResourceAuthVo,PermissionDto | A:- | S:MyBatis联表查询org_path避免递归,多租户资源成员授权明细,红黑名单grantType/color过滤,分页getAuthList
ResourceAuthContextMapper.java[MM5PT]: F:资源授权上下文Mapper,查询授权资源类型/按ID查资源及数字员工数据集 | R:AuthResourceType,SsResource,AuthContextQo | A:- | S:MyBatis接口,权限校验,多租户隔离,数字员工数据集授权关联

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/conversation/===
FeedbackMsgInfoMapper.java[MCH5BT]: F:反馈消息Mapper,批量保存反馈消息

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/customer/===
ByaiCustomerLeadsMapper.java[MOR5BT]: F:客户线索数据访问,支持单条与批量插入 | R:ByaiCustomerLeads | A:- | S:继承BaseMapper,insertLead/insertBatch自定义批量写入

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/datacloud/===
DatacloudLoginTypeMapper.java[MOB5MKS]: F:数据云登录类型表数据访问,分页/启用查询、编码查重、关联脚本统计、批量删除 | R:DatacloudLoginType,DatacloudLoginTypeDTO,DatacloudLoginTypeQueryDTO | A:- | S:MyBatisPlus BaseMapper,enterpriseId企业隔离,Page分页,批量删除
DatacloudScriptCategoryMapper.java[AOB5NMT]: F:脚本分类表数据访问,支持分页/树形/编码查重/统计/批量删除 | R:DatacloudScriptCategory,DatacloudScriptCategoryDTO,DatacloudScriptCategoryQueryDTO | A:- | S:MyBatisPlus BaseMapper,树形与子分类查询,企业ID多租户隔离,批量删除
DatacloudScriptExecutionMapper.java[MDS5MKM]: F:数据云脚本执行记录Mapper,分页查询/执行统计/状态统计/批量删除 | R:DatacloudScriptExecution,DatacloudScriptExecutionDTO,DatacloudScriptExecutionQueryDTO | A:- | S:MyBatisPlus,按scriptId统计成功失败次数与平均时长,enterpriseId租户隔离,batch批量删除
DatacloudScriptHistoryMapper.java[AMA5T]: F:数据云脚本版本历史表Mapper,管理脚本变更历史 | R:DatacloudScriptHistory | A:- | S:MyBatis-Plus BaseMapper,空接口继承
DatacloudScriptMapper.java[MOB5MKS]: F:数据云脚本主表Mapper,分页/场景/分类/标签/模板/热门查询及执行统计、批量删除 | R:DatacloudScript,DatacloudScriptDTO,DatacloudScriptQueryDTO | A:- | S:MyBatisPlus,企业ID隔离,执行次数统计,批量删除分页
DatacloudScriptScenarioMapper.java[MOB5MKS]: F:脚本场景表Mapper,提供分页/树形/子场景查询、编码查重、脚本与子场景统计、批量删除 | R:DatacloudScriptScenario,DatacloudScriptScenarioDTO,DatacloudScriptScenarioQueryDTO | A:- | S:MyBatisPlus BaseMapper,enterpriseId租户隔离,Page分页,batchDelete批量,checkScenarioCodeExists排他校验
DatacloudScriptStepHistoryMapper.java[MOB5T]: F:脚本步骤变更历史记录表Mapper
DatacloudScriptStepMapper.java[MDC5BKS]: F:数据云脚本步骤Mapper,分页查步骤、按脚本ID/类型查、批量改顺序、删除、步骤统计 | R:DatacloudScriptStep,DatacloudScriptStepDTO,DatacloudScriptStepQueryDTO | A:- | S:MyBatis-Plus BaseMapper,selectScriptStepListByPage分页,batchUpdateStepOrder批量改序,batchDeleteScriptSteps批量删,带enterpriseId租户隔离
DatacloudScriptTemplateMapper.java[MOB5KMT]: F:脚本模板数据访问,分页查询与可用模板按租户隔离查询 | R:DatacloudScriptTemplate | A:- | S:MyBatisPlus BaseMapper,enterpriseId多租户隔离,templateType/framework条件过滤,Page分页
DataCloudScriptViewMapper.java[MVW5KS]: F:数据云脚本视图Mapper,分页查询脚本视图列表 | R:DataCloudScriptView,DataCloudViewScriptDTO,DataCloudScriptViewQueryDTO | A:- | S:继承BaseMapper,selectScriptListByPage分页+条件查询
DatacloudTargetScriptMapper.java[AOB5M]: F:数据云目标脚本表数据访问

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/enterprise/===
EnterpriseInfoMapper.java[MO3TT]: F:企业信息Mapper,查询企业标识ID

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/file/===
FilesMapper.java[MFI5BT]: F:文件记录持久化,批量插入与按标签匹配查询上传文件 | R:Files,UploadFilesRespDto | A:- | S:继承BaseMapper,insertBatch同事务归档,selectByMatchTags按chatId+tags匹配模式查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/index/===
IndexMapper.java[MEM7PMS]: F:数字员工索引查询Mapper,聚合授权员工/常用/最近新增/我创建/发现页及授权文档工具资源查询 | R:AuthDigitEmployVo,DigitEmployMarketVo,MyAuthEmployQo,AuthResourceQo,SessionMemberResourceVo | A:- | S:红黑名单授权过滤,90天使用频次排序,顶级组织查询,部门范围隔离,按会话ID查资源

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/login/===
SafeAccountMsgMapper.java[MAU5M]: F:账号安全信息Mapper

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/log/===
LogExceptionInfoMapper.java[MA3M]: F:异常日志信息Mapper,继承MyBatis-Plus BaseMapper
LoginLogMapper.java[MAU3M]: F:登录日志数据访问Mapper(MyBatis-Plus) | R:LoginLog | A:- | S:继承BaseMapper,登录审计日志CRUD
ManageLogMapper.java[MAD8M]: F:管理操作日志Mapper,审计日志持久化
TrackLogMapper.java[MA3M]: F:埋点日志Mapper,byai_track_log表增删改查

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/memory/===
MemoryLibraryMapper.java[MEM5MS]: F:记忆库数据访问,按用户/员工查询记忆库及增删 | R:MemoryLibrary | A:- | S:MyBatisPlus BaseMapper,selectByUserIdAndAgentId/selectByAgentId/deleteByAgentId,按agentId+libraryType检索
ResourceRuleEnabledMapper.java[MKN5MT]: F:资源规则启用状态CRUD及按资源/模版/用户查询 | R:ResourceRuleEnabled | A:- | S:MyBatis-Plus BaseMapper,insert/updateById/deleteById,selectByResourceIdAndTemplateIdAndUserId,selectDisabledByResourceIdAndUserId按用户隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/men/===
MenResComMapper.java[MM5MS]: F:资源组件表Mapper,查询父任务卡片及固定记忆任务列表 | R:MenResCom,MenTaskVo,FixedMemoryQo,FixedMemoryMemoryTaskVo | A:- | S:BaseMapper继承,getParentResComBySubTaskExtId子查父,selectFixedMemoryMemoryTaskVoByQo多租户
MenTaskCatalogMapper.java[MM5BT]: F:任务目录数据访问,批量插入 | R:MenTaskCatalog | A:- | S:继承BaseMapper,batchInsert批量入库@Param-list
MenTaskMapper.java[MTA5KM]: F:待办任务Mapper,提供外部任务ID/资源ID/组件ID查询、分页条件查询、状态统计及任务级联删除 | R:MenTask,MenTaskQueryQo,MenTaskVo | A:- | S:MyBatisPlus BaseMapper,res_page资源关联,todolist迁移方法,countTasksByStatus分组统计,deleteByTaskId/RecObj/ResCom级联删除,租户隔离
MenTaskRecObjMapper.java[MM5BT]: F:待办任务接收对象表Mapper,按任务ID查询/批量插入/删除接收对象 | R:MenTaskRecObj,MenTaskRecObjVo | A:- | S:BaseMapper,selectByTaskId,insertBatch,deleteByTaskId,selectTaskResUserByTaskId
MenTaskStatusLogMapper.java[MT5MT]: F:待办任务状态变更日志Mapper | R:MenTaskStatusLog | A:- | S:继承BaseMapper,deleteByTaskId按任务ID删除状态日志

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/message/===
ByaiMessageMapper.java[MAH8BKM]: F:会话/任务消息持久化Mapper,支持消息热度CRUD与分页查询(替代ES) | R:ByaiMessage,ByaiMessageHotDto,MessageHotPageQo,MessageHotQo,MessageHotDelQo | A:- | S:MyBatisPlus,selectBySessionId/TaskId/MessageId,insertBatch批量写入,selectByQo替代ES,countPositionInSession定位,deleteByQo
ByaiMessageRelMapper.java[MCH5BK]: F:消息关联对象数据访问,增删改查及反馈更新与记忆检索分页 | R:ByaiMessageRel,MemRelSearchRequestDto,MessageRelObjQo | A:- | S:继承BaseMapper,insertOne/insertBatch批量插入,updateFeedbackByRelId/updateFeedbackByMessagePair反馈置空更新,countSearchMem+selectSearchMemPage记忆检索分页
MessageShareLinkMapper.java[MM5KT]: F:消息分享链接表持久化,按token查询及访问计数更新 | R:MessageShareLink,BaseMapper | A:- | S:MyBatisPlus,selectByLinkToken,incrementAccessCountAndUpdateTime
MessageShareLinkMessageMapper.java[MM5BT]: F:消息分享链接与消息关联表持久化,按链接ID查消息ID/批量插入 | R:MessageShareLinkMessage | A:- | S:继承BaseMapper,selectMessageIdsByLinkId,insertBatch批量

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/mode/===
ByaiModeMapper.java[MC5M]: F:模式与数字员工关联数据访问 | R:ByaiMode,ModeRelationDto | A:- | S:MyBatisPlus BaseMapper,按modeCode查关联,查全量列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/monitor/===
MonitorTargetMapper.java[MM5BL]: F:监控目标数据访问,按数字员工ID查询/清理失效记录/按质量等级筛选 | R:MonitorTarget,BaseMapper | A:- | S:MyBatisPlus,selectByAgentId,deleteByTargetTypeExcludeAgentIds批量清理,selectLtTargetQuality质量评级筛选

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/notification/===
ByaiNotificationMapper.java[MCO5BS]: F:通知表数据访问,批量插入/分页查询/批量已读/全部已读 | R:ByaiNotification,NotificationVO,NotificationQueryDto | A:- | S:MyBatisPlus BaseMapper,batchInsert走XML,selectNotificationPage分页,batchSetNotificationRead按targetId

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/ontology/===
ByaiDbresourceRelMapper.java[MDS5BS]: F:数据库资源关联表Mapper,按对象/库ID增删查及批量插入 | R:ByaiDbresourceRel | A:- | S:MyBatisPlus BaseMapper,findByObjId/findByRecordId/deleteByObjId/insertBatch批量
SsResExtOntologyMapper.java[AOJ5BM]: F:本体资源扩展表Mapper,按资源ID/项目ID查询及批量增删本体扩展信息 | R:SsResExtOntology | A:- | S:继承BaseMapper,selectByResourceId/Ids,selectByPid,insertBatch批量插入,deleteByResourceIds批量删除

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/operations/===
QueryConfigMapper.java[MV5BL]: F:查询配置数据访问,按编码查询配置/执行动态SQL/列出启用配置 | R:QueryConfig,QueryConfigListDTO | A:- | S:继承BaseMapper,selectByQueryCode/selectByQueryCodeAndType按编码查,executeDynamicSql动态SQL模板执行,selectAllConfigList启用列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/organization/===
OrganizationMapper.java[MOR5MS]: F:组织机构数据访问层,支持组织树查询/归属管理员/下属组织/路径名称构建 | R:Organization,OrgTreeQo,OrgManagerVo,UsersOrganization | A:- | S:MyBatisPlus BaseMapper,pathCode构建组织路径,@MapKey按orgId映射,多租户隔离查询,下属及自身组织递归
OrgExternalSystemMapper.java[AM5OM]: F:组织外部系统数据访问Mapper

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/permissiongroup/===
AuthorizedObjectDataPermissionMapper.java[MPER5BT]: F:授权对象数据权限Mapper,按权限组/用户查询删除及批量增删 | R:AuthorizedObjectDataPermission,AuthorizedObjectDataPermissionVO | A:- | S:继承BaseMapper,selectByPermissionGroupId,batchInsert,batchDeleteByPermissionGroupIdAndUserIds
AvailableObjectMapper.java[MPER5KS]: F:可用授权对象Mapper,查询可加入权限组的用户/组织列表 | R:AvailableObjectQueryQO,AvailableObjectVO | A:- | S:分页/非分页查询可用用户与组织,@Param query,IPage
DefaultDataPermissionMapper.java[MPER5T]: F:默认数据权限Mapper,按权限组ID查询/删除数据权限 | R:DefaultDataPermission,DataPermissionVO | A:- | S:MyBatisPlus BaseMapper,selectByPermissionGroupId,deleteByPermissionGroupId
PermissionGroupAuthorizedObjectMapper.java[MPP5KBM]: F:权限组授权对象关联Mapper,分页/批量CRUD及授权用户去重查询 | R:PermissionGroupAuthorizedObject,AuthorizedObjectQueryQO,AuthorizedUserQueryQO,AuthorizedObjectVO,AuthorizedUserVO | A:- | S:selectAuthorizedObjectPage分页,batchInsert/batchDeleteByIds批量,countByObject去重校验,selectAuthorizedUserPageByPermissionGroupIds权限组IN查询去重过滤
PermissionGroupCategoryMapper.java[MPM5KL]: F:权限组目录Mapper,提供目录分页/列表/详情查询、编码名称唯一性校验、子目录与权限组计数、递归子目录ID查询及按名称模糊查目录 | R:PermissionGroupCategory,PermissionGroupCategoryQueryQO,PermissionGroupCategoryVO,CatalogSimpleVO | A:- | S:BaseMapper,IPage分页,递归selectChildrenIds,countByCode/Name唯一校验
PermissionGroupExcludedObjectMapper.java[MPE7BKS]: F:权限组排除授权对象关联Mapper,管理权限组中被排除的用户/组织/岗位 | R:PermissionGroupExcludedObject,AuthorizedObjectVO,AuthorizedObjectQueryQO | A:- | S:分页查询排除对象,按类型查排除用户/组织/岗位ID,批量增删,存在性校验countByObject
PermissionGroupMapper.java[MPER7KS]: F:权限组数据访问层,提供权限组增删改查、编码/名称查重、含目录联合查询 | R:PermissionGroup,PermissionGroupQueryQO,PermissionGroupVO,PermissionGroupWithCatalogVO | A:- | S:继承BaseMapper,分页查询selectPermissionGroupPage,详情查询,countByGroupCode/Name唯一性校验,模糊查询含目录信息
PermissionGroupResourceAttributeMapper.java[MPER5BT]: F:资源属性权限数据访问,按资源ID查询/删除及批量插入 | R:PermissionGroupResourceAttribute,ResourceAttributePermissionVO | A:- | S:继承BaseMapper,selectByResourceId,deleteByResourceId,batchInsert批量插入
PermissionGroupResourceMapper.java[MPER7BKS]: F:权限组资源关联数据访问,资源授权增删查改 | R:PermissionGroupResource,PermissionResourceVO,ResourcePermissionQueryQO | A:- | S:按权限组ID查/删资源,分页查授权资源,batchInsert批量插入,batchDeleteByIds/批量删除,按资源ID反查权限组

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/pluginmodule/===
DigitalEmployeeMapper.java[MEM3M]: F:数字员工数据访问Mapper,按编码查询/校验存在
FunctionMenuPermissionMapper.java[MPER5BT]: F:功能菜单权限Mapper,批量插入与按数字员工查询 | R:FunctionMenuPermission | A:- | S:MyBatis-Plus BaseMapper,batchInsert批量,selectByEmployeeId按员工查权限

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/position/===
PositionExtCatalogMapper.java[MPO7BT]: F:岗位-领域关系数据访问,校验岗位名重复/批量插入关系/按领域查数字岗位 | R:PositionExtCatalog,CatalogWithPositionsDTO,DigitalPositionDTO | A:- | S:继承BaseMapper,countPositionNameInCatalogs去重校验,saveBatch批量插入,关联查询领域与岗位
PositionExternalMapper.java[MPO5M]: F:岗位外部关联数据访问Mapper
PositionMapper.java[MPO5KS]: F:岗位数据访问层,岗位分页查询、用户岗位关联查询、岗位名称重复与使用统计 | R:Position,PositionQo,PositionUsersQo,PositionUsersVo,PositionDTO | A:- | S:继承BaseMapper,searchPositionList分页,searchPositionUsersByQo用户岗位分页,countPosition名称去重校验,countUsed占用统计,findPositionByUserId按用户查岗位
PositionUserRelationMapper.java[MPO5KS]: F:数字岗位与管理员用户关系Mapper,分页查询岗位下管理员、批量保存关系 | R:PositionUserRelation,PositionAdminSearchQO,PositionUsersVo | A:- | S:MyBatisPlus BaseMapper,selectUsersByPositionIdPage分页,saveBatch批量插入
ResourcePositionRelationMapper.java[AMP5KS]: F:数字岗位与数字员工关系Mapper,分页查询岗位下数字员工 | R:ResourcePositionRelation,PositionResourceSearchQO,PositionDigitalEmployeeVo | A:- | S:继承BaseMapper,selectDigitalEmployeesByPositionIdPage分页查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/resource/===
AiModelMapper.java[MAM5M]: F:AI模型数据访问Mapper
SsResExtAgentMapper.java[MEM5KS]: F:数字员工扩展表Mapper,按资源ID批量查智能体扩展信息 | R:SsResExtAgent,ResourceExtAgentDto | A:- | S:继承BaseMapper,findResourceExtAgentByIds批量查询,Collection入参
SsResExtAttributeMapper.java[MOB7S]: F:资源扩展属性表数据访问,支持按资源ID单查/批量查/按类型查及批量增改 | R:SsResExtAttribute,BaseMapper | A:- | S:MyBatisPlus,selectByResourceId(s),selectByResourceIdAndType,insertBatch,updateBatch
SsResExtDbDatasetMapper.java[MOB5BS]: F:数据集扩展表Mapper,按资源ID单查/列表/批量查数据集信息 | R:SsResExtDbDataset | A:- | S:MyBatisPlus BaseMapper,selectByResourceId,selectListByResourceIds批量
SsResExtDbMapper.java[MOB5BM]: F:数据库扩展资源表Mapper,按资源ID批量查询数据库知识库扩展信息 | R:SsResExtDb,ResourceExtDbDto | A:- | S:继承BaseMapper,findResourceExtDbByIds批量查询返回DTO列表,租户隔离
SsResExtDigEmployeeMapper.java[MEM7KM]: F:数字员工扩展信息表Mapper,分页/个人归属/详情/按模型/开放接口查询 | R:SsResExtDigEmployee,DigitalEmployeeQo,DigitalEmployeePageVo,ResourceExtDigEmployeeDto,DigitalEmployeeDetailsDTO | A:- | S:MyBatisPlus BaseMapper,owner_type=personal三类资源,已上架过滤,modelId反查,开放接口按类型/名称模糊查,多租户隔离
SsResExtDocMapper.java[MK5BL]: F:文档库扩展表Mapper,按资源ID批量查询文档库扩展信息 | R:SsResExtDoc,ResourceExtDocDto | A:- | S:继承BaseMapper,findResourceExtDocByIds按资源标识集合查DTO,selectListByResourceIds批量查实体
SsResExtEvaluateMapper.java[AME7KS]: F:数字员工评估旧数据表Mapper,支持按资源ID查最新评估及条件分页查询 | R:SsResExtEvaluate,SsResExtEvaluateQO | A:- | S:MyBatisPlus BaseMapper,selectLatestByResourceId,selectPageByQO分页
SsResExtMcpMapper.java[MM5T]: F:MCP扩展资源表数据访问
SsResExtMcpServerMapper.java[MM5BL]: F:MCP服务扩展表Mapper,按资源ID批量查询MCP服务扩展信息 | R:SsResExtMcpServer,ResourceExtMcpDto | A:- | S:继承BaseMapper,findResourceExtMcpByIds批量查询,Collection入参
SsResExtMcpToolMapper.java[MM5T]: F:MCP工具扩展表Mapper接口
SsResExtObjectMapper.java[MO5M]: F:对象扩展表Mapper接口
SsResExtTestSetMapper.java[MEMP5KS]: F:数字员工测试集上传临时表Mapper,按资源/批次ID查询最新成功记录及分页查询 | R:SsResExtTestSet,SsResExtTestSetQo,SsResExtTestSetVo | A:- | S:MyBatis-Plus BaseMapper,selectByResourceIdAndBatchId,selectLatestByResourceId,selectTestSetByQo分页
SsResExtToolKitMapper.java[AMTBT]: F:插件扩展工具集表Mapper,查询工具集及关联工具 | R:SsResExtToolKit,ResourceExtToolKitDto | A:- | S:MyBatis-Plus BaseMapper,findResourceExtToolKitByIds批量查工具集含工具列表,selectListByResourceIds按资源ID批量,findToolKitIdByToolsId反查工具所属工具集
SsResExtToolMapper.java[MTO5BT]: F:插件工具扩展表Mapper,按资源ID批量查询工具及headers扩展信息 | R:SsResExtTool,SsResExtPluginToolDto,ResourceExtToolDto | A:- | S:继承BaseMapper,findWithHeaderByResourceIds关联headers,findResourceExtToolByIds/selectListByResourceIds批量查
SsResExtViewMapper.java[MA5M]: F:业务视图扩展表Mapper,继承MyBatis-Plus BaseMapper
SsResourceArtifactMapper.java[MO5TM]: F:资源产物表MyBatis-Plus映射器
SsResourceCatalogMapper.java[MOB5NL]: F:资源发布目录Mapper,目录树查询/子目录递归/资源目录关联树 | R:SsResourceCatalog,ResourceCatalogDto,ResourceCatalogTreeVO,CatalogQo,CatalogDto | A:- | S:queryCatalogTree,querySelfAndDescendantIds路径递归,queryResourceCatalogTree按catalog_type过滤OBJECT,MyBatisPlus
SsResourceMapper.java[ME8MM]: F:资源表统一Mapper,资源分页/关联查询/数字员工授权资源/数据集/受限资源/批量插入 | R:SsResource,SsResourceDTO,ResourcePageDto,DigEmployeeOperationsVO,ResourceAuthVo,DatasetVo | A:- | S:多租户隔离,资源三层授权查询,关联技能知识库,跨ConversationServer删规则,批量插入,数据集目录文件层级查询
SsResourceOperLogMapper.java[MA5T]: F:资源操作日志表Mapper接口
SsResourceRelDetailMapper.java[MOB5BL]: F:资源关联明细表Mapper,管理视图/主资源关联关系增删查及数字员工关联查询 | R:SsResourceRelDetail,SsResourceRelDetailDTO,ResourceRelationDto,ResourceRelationQo | A:- | S:BaseMapper,insertBatch批量插入,deleteByViewResourceId,findByViewResourceId基于JSON字段查询,findByResourceIdAsDetail,queryDigEmployeeRelations
SsResourceVersionMapper.java: F:资源版本表数据访问

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/sandbox/===
SsSandboxRecordMapper.java[MSB8LKM]: F:沙箱记录Mapper,沙箱生命周期全程持久化(创建/启动/续租/释放/对账/失败) | R:SsSandboxRecord,SandboxReconcileGroup | A:- | S:乐观锁lockVersion并发控制,游标分页查超时/待续租/对账记录,按用户+资源查运行中沙箱,状态机流转(running/starting/releasing/released/failed),续租与对账成功更新,关键字分页查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/scheduletask/===
ScheduleTaskInstMapper.java[AM7T]: F:定时任务执行实例表Mapper
ScheduleTaskMapper.java[MTA5T]: F:定时任务表Mapper | R:ScheduleTask,ScheduleTaskVo | A:- | S:MyBatis-Plus BaseMapper,selectVoById连表查询定时任务详情

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/searchask/===
SpaceDirMapper.java[MKN5BS]: F:空间目录表Mapper,查询导入/收藏/技能/已选/个人/企业知识库资源及批量插入空间目录 | R:SpaceDir,SpaceResourceVo,SpaceKbResourceVo,SpaceResourceQo,CollectResourceQo,SkillResourceQo,SelectedKbQo,PersonalKbQo,EnterpriseKbQo | A:- | S:MyBatis-Plus BaseMapper,byai_space_dir表,insertBatch批量,多类型知识库资源查询
SpaceDirRelMapper.java[MKN5BT]: F:空间目录关联关系表Mapper,提供批量插入目录关联记录 | R:SpaceDirRel | A:- | S:继承BaseMapper,insertBatch批量插入,对应表byai_space_dir_rel
WebCrawlDocArchiveMapper.java[MKN5BS]: F:联网搜索文档归档表持久化,按requestId查询与批量插入 | R:WebCrawlArchiveDoc | A:- | S:MyBatis-Plus BaseMapper,insertBatch批量,listByRequestId查询
WebCrawlRequestMapper.java[MKO5M]: F:联网搜索归档请求表持久化 | R:WebCrawlRequest | A:- | S:BaseMapper继承,insert新增,listBySessionId按会话查询归档请求,按创建时间排序,租户隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/session/===
ByaiSessionExtMapper.java[MCH5KT]: F:会话扩展参数表Mapper,按会话ID查询扩展参数 | R:ByaiSessionExt,BaseMapper | A:- | S:MyBatisPlus,selectBySessionId,byai_session_ext表
ByaiSessionMapper.java[MCH8KM]: F:会话主表Mapper查询会话/模板会话/最近搜问列表 | R:ByaiSession,ByaiSessionDto,TemplateSessionQueryRequestDto,RecentlySearchAskQo | A:- | S:MyBatisPlus BaseMapper,qryConversations,queryTemplateSessions,queryRecentlySearchAsk,租户隔离
ByaiSessionMemberMapper.java[MAH7M]: F:会话成员表数据访问,查询会话成员、按数字员工查会话、按时间范围查询 | R:ByaiSessionMember,SessionByAgentQo | A:- | S:MyBatis-Plus BaseMapper,findSessionMember/updateSelective非空更新/querySessionByAgent,@Param多条件查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/showcase/===
ByaiShowcaseMapper.java[MOB5BL]: F:成果空间表数据访问,增删改查/批量插入/条件查询/状态更新/查已删记录 | R:ByaiShowcase,ByaiShowcaseVo,ShowcaseQueryParam | A:- | S:MyBatis,insertBatch批量,updateStatusByCondition按会话/类型/文件码/消息更状态,selectDeletedRecord查逻辑删除

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/source/===
SourceSystemMapper.java[MDS5M]: F:源系统数据访问Mapper,查询源系统列表 | R:SourceSystem | A:- | S:继承BaseMapper,getSourceSystemList自定义查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/staticdata/===
ByaiSystemConfigListMapper.java[MSY5KT]: F:系统配置列表数据访问,支持分组查询与按分组编码查详情 | R:ByaiSystemConfigList,SystemConfigListDTO,SystemConfigListGroupVo,QueryObject | A:- | S:MyBatisPlus BaseMapper,selectSystemConfigListGroupByQo分组,selectByParamGroupCode按编码查
ByaiSystemConfigMapper.java[MSY5KS]: F:系统配置静态数据Mapper,支持按QO查询配置 | R:ByaiSystemConfig,SystemConfigQo,SystemConfigVo | A:- | S:BaseMapper扩展,selectSystemConfigByQo缓存管理查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/station/===
StationMapper.java[MO5KM]: F:驻地信息Mapper,驻地树查询/按用户查驻地/查下属驻地ID列表 | R:Station,StationTreeQo,BaseMapper | A:- | S:po_station表,MyBatisPlus,getStationTree树形查询,selectUnderlingStationList路径模糊查下属

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/superassist/===
SsSuperassistKwCatalogMapper.java[MK5M]: F:知识目录Mapper数据访问接口
SuasSuperassistMapper.java[ME5ST]: F:超级助手实体Mapper接口
SuasSuperassistResourcePrivilegeMapper.java[MEMP5BT]: F:助理资源授权Mapper,数字员工三层授权资源权限记录的查询与批量写入 | R:SuasSuperassistResourcePrivilege,BaseMapper | A:- | S:按助理/资源/类型条件查询,关联资源名称查询,按权限类型+资源类型过滤,批量插入
SuasSuperassistSubAgentMapper.java[AEM5M]: F:超级助理子智能体数据访问Mapper | R:SuasSuperassistSubAgent | A:- | S:继承MyBatisPlus BaseMapper,子智能体CRUD,多租户隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/system/===
SequenceMapper.java[MSY3T]: F:序列生成数据访问层,多数据库序列值生成与维护 | R:Sequence | A:- | S:BaseMapper扩展,Udal/Oracle/PostgreSQL/MySQL多库序列策略,MySQL临时记录自增及清理
SysAppVersionMapper.java[MSY5M]: F:应用版本信息Mapper,按设备类型查最新版本 | R:SysAppVersion | A:- | S:继承BaseMapper,selectLatestVersionByDeviceType按deviceType查最新版本
SystemFeedbackMapper.java[MSY5M]: F:系统反馈数据访问Mapper | R:SystemFeedback | A:- | S:继承MyBatisPlus BaseMapper,系统反馈CRUD
AttachFileMapper.java: F:附件文件Mapper

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/tag/===
ByaiTagRelationMapper.java[MOB5BS]: F:标签关系表数据访问,按对象类型批量查标签ID、先删后插维护对象-标签关联 | R:ByaiTagRelation,BaseMapper | A:- | S:MyBatis-Plus,findTagIdsByObjTypeAndObjIds去重查询,deleteByObjTypeAndObjId,insertBatch批量写入,多租户对象关联

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/template/===
ResourceTemplateRelationMapper.java[MOB5BT]: F:资源模版关联关系Mapper,按资源/模板/用户ID增删查及批量插入 | R:ResourceTemplateRelation | A:- | S:MyBatis-Plus BaseMapper,deleteByResourceId,selectByResourceIdAndUserId,batchInsert,selectByTemplateIdAndResourceId,selectByResourceIds批量查memory_rule_id
TemplateRuleInfoMapper.java[MCO5KS]: F:模版规则信息Mapper,条件分页查询、按资源/用户ID查询、批量查关联memory_rule_id | R:TemplateRuleInfo,TemplateRuleInfoQueryQo,BaseMapper | A:- | S:MyBatisPlus分页,selectByCondition/selectByResourceIds批量,返回Map含memory_rule_id

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/token/===
UserAccessTokenMapper.java[MTO5T]: F:用户访问令牌Mapper,继承MyBatisPlus BaseMapper提供令牌CRUD | R:UserAccessToken | A:- | S:BaseMapper泛型,无自定义方法

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/users/===
UserExternalSystemMapper.java[AAM5M]: F:用户外部系统关联Mapper
UserMailAccountMapper.java[MC3M]: F:用户个人邮箱账号Mapper
UsersMapper.java[MAU5BKS]: F:用户数据访问层,按组织/岗位/驻地查询用户及批量操作 | R:Users,UsersOrgVo,UsersDetailVo,SearchUserQo,TempQo | A:- | S:继承BaseMapper,组织成员分页查含子级,unionId查用户,用户编码/工号查重,按岗位/驻地ID列表批量查用户ID,批量更新用户,按编码批量查详情
UsersOrganizationExternalSystemMapper.java[AMORM]: F:组织外部系统映射Mapper,继承MyBatis-Plus BaseMapper提供组织外部系统CRUD
UsersOrganizationMapper.java[MORG5BM]: F:用户-组织关联关系数据访问,查询用户绑定组织/批量保存关系 | R:UsersOrganization,UsersOrgPostVo | A:- | S:MyBatisPlus BaseMapper,countExcludeCurrent排除当前组织计数,selectUsersInBatch按组织/岗位/工位批量查用户,saveBatch批量保存

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/workspace/===
ByaiSessionWorkspaceMapper.java[MCH5BT]: F:会话工作区数据访问,批量插入/按会话查询/批量更新存在标识 | R:ByaiSessionWorkspace,SessionWorkspaceListRequest | A:- | S:MyBatisPlus BaseMapper,insertBatch批量插入,selectBySession查询,updateIsExistByIds批量改is_exist

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/auth/===
AuthContextQo.java[DAU5M]: F:认证上下文查询对象,扩展AuthQo并携带资源业务类型字段
AuthDetailQo.java[DAU3M]: F:授权明细查询参数(授权类型/资源类型/资源ID)
AuthManQo.java[DAU3M]: F:授权管理查询对象,封装授权类型、被授权对象ID及对象类型
AuthQo.java[DAU3PM]: F:授权查询对象,封装用户/岗位/组织授权及平台管理员标识
DigitalEmployeeAuthQo.java[DEM5K]: F:数字员工授权查询对象,含授权类型/对象类型/对象标识/关键字/分页参数
GrantToObjQo.java[DAU3M]: F:授权目标对象查询参数,含授权对象类型与ID
OwnAuthQo.java[DAUTH5KS]: F:个人授权资源分页查询参数(组织/状态/资源类型/目录/排序)
PrivilegeGrantQo.java[DPERM5M]: F:权限授权查询对象,封装授权范围/资源类型/授权对象/红黑名单等多维度查询条件
ResourceAuthQo.java[DAU7M]: F:资源授权查询参数,封装授权范围/授予对象/资源类型/目录/排序等多维度筛选条件
ResourceMemberQueryQo.java[DA5PM]: F:资源成员查询入参,含resourceId必填校验
ResourceMemberSettingQo.java[DPER5T]: F:资源成员设置入参,含资源ID/组织ID/红黑名单授权列表
ResourceOperationPermissionsQo.java[DAUTH3T]: F:资源操作权限查询入参,含资源ID
ResourceUseApplyApproveQo.java[DA5PM]: F:资源使用申请审核通过入参(资源标识+申请用户标识)
ResourceUseApplyQo.java[DA5VM]: F:资源使用申请查询/创建入参,仅接resourceId由后端反查真实资源类型

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/conversation/===
FilterQo.java[DCH5K]: F:会话列表过滤查询参数,含关键字与分页
HandleFeedbackMsgQo.java[DCH3M]: F:处理反馈消息查询对象,含提问消息ID
MessageIndexQo.java[DCH5M]: F:消息索引查询请求实体,支持向量检索/反馈/时间范围等多维过滤分页
MessageQo.java[DCH5K]: F:会话消息分页查询参数,支持渠道/终端/时间/反馈/用户提问多维筛选
SearchQo.java[DCHA5T]: F:会话检索查询参数,含提问/回复对象类型标识、终端来源、反馈类型/标签/评分、内容及向量、分页字段

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/index/===
AuthResourceQo.java[DPM5M]: F:授权资源查询参数,含资源类型列表与授权范围(全部/授权给我/我创建)
DigitEmployCreateQo.java[DD5M]: F:创建数字员工请求参数,含插件工具/知识库/关联智能体/开场白/推荐提示词等嵌套配置
DigitEmployQo.java[DEM5T]: F:数字员工查询请求参数(分页/名称/目录/状态/终端等)
DiscoverQo.java[DD5M]: F:资源发现广场查询参数(目录/状态/归属/权限/排序筛选)
HotQo.java[DES5M]: F:首页热门发现查询参数,继承DiscoverQo
MyAuthEmployQo.java[DEM5M]: F:我的授权数字员工查询参数(按用户近90天使用频次/创建归属过滤)
MyCreatedQo.java[DCO5K]: F:我创建的资源分页查询参数(关键字/用户/目录及子目录ID)
MyUsualQo.java[DCO5M]: F:我的常用对象查询条件(近90天使用频次降序)
OrgFilterQo.java[DP3OM]: F:组织过滤查询参数(全部/公司/部门/自定义范围)
RecentlyAddedQo.java[DC1VT]: F:首页最近新增查询参数,继承鉴权QO
RecentContactQueryQo.java: F:最近联系人查询请求参数(分页/联系人类型/会话类型/天数过滤)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/men/===
FixedMemoryQo.java[DEM5K]: F:固定记忆分页查询参数(页码/大小/关键字/创建人)
MenResComQo.java[DCO5M]: F:资源组件查询对象,扩展资源组件实体附加消息id与任务id用于通知数字员工
MenTaskQueryQo.java[D]: F:待办任务分页查询参数,支持处理类型/状态列表/时间范围/资源类型多条件组合查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/organization/===
CatalogQo.java[DORGK5M]: F:目录查询参数(类型/关键字/含父级/目录ID列表)
OrgManagerQo.java[DOR3M]: F:组织管理员查询参数,组织ID必填+用户类型列表过滤
OrgTreeQo.java[DOR3T]: F:组织树查询参数对象,含父组织/关键字/组织ID集合/我的标识过滤条件
SearchOrgQo.java[DOR3M]: F:组织查询参数对象,按组织标识查询且orgId非空校验

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/permissiongroup/===
AuthorizedObjectQueryQO.java[DPER5T]: F:权限组授权对象查询参数(类型/名称/分页)
AuthorizedUserQueryQO.java[DG5KS]: F:权限组授权用户查询对象,支持用户/组织/岗位多维度过滤与分页
AvailableObjectQueryQO.java[DPE5T]: F:可用授权对象查询参数,查询可添加到权限组的用户/组织/角色/岗位列表
PermissionGroupAndCatalogQueryQO.java[DPER5M]: F:权限组与目录联合查询对象,支持名称模糊匹配及用户/组织多租户过滤
PermissionGroupCategoryQueryQO.java[DPERM5KT]: F:权限组目录查询对象,支持名称模糊/编码精确/父级/状态/组织过滤及树形与分页
PermissionGroupQueryQO.java[DPED5K]: F:权限组分页查询对象,含名称/编码/创建人/时间范围/状态/组织ID及分页参数
ResourcePermissionQueryQO.java[DPERM5KT]: F:权限组授权资源分页查询条件

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/position/===
DigitalPositionSearchQO.java[DD5KM]: F:数字岗位查询对象,支持领域ID与岗位名称模糊查询分页
PositionAdminSearchQO.java[DPO5VS]: F:岗位管理员查询对象,按岗位ID及用户名模糊查询
PositionQo.java[DPO5M]: F:岗位查询对象,继承通用分页查询基类
PositionResourceSearchQO.java[DPO5S]: F:岗位数字员工查询对象,含岗位ID与员工名称模糊查询
PositionUsersQo.java[DPO5K]: F:查询岗位下用户信息的查询对象,含用户角色/岗位ID/关键字(姓名/手机/工号)分页查询参数

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/resource/===
AgentListQo.java[DEMP5S]: F:数字员工列表查询参数,含默认类型筛选字段
CatalogDto.java[DOB5K]: F:资源发布目录查询参数,含目录层级/类型/资源状态过滤及分页排序
DigEmployeeExtQo.java[DEMP5M]: F:数字员工扩展资源查询参数(资源ID/编码)
DigitalEmployeeQo.java[DEMP5M]: F:数字员工资源查询参数,含类型/目录/权限/归属/组织/发布状态多维筛选
DirAndFileQo.java[DF5FM]: F:目录与文件查询参数,含资源ID/资源码/目录路径
OpenResourceQo.java[DObj5M]: F:开放资源查询对象,封装资源ID查询参数
PrivListQo.java[DPER5M]: F:权限资源列表查询参数(名称/分页/类型/授权对象/终端类型等)
QueryResourceCatalogTreeRequest.java[DOB5S]: F:查询资源目录关联树请求对象,含目录类型字段
ResourceIdQo.java[DO5SM]: F:资源ID批量查询参数,含资源ID列表与资源状态
ResourceQo.java[DB5M]: F:资源查询对象,支持归属类型/创建人/资源类型多条件过滤分页
ResourceRelationQo.java[DP5M]: F:资源关系查询参数,含资源ID/名称/业务类型/权限过滤集合及分页
SsResExtEvaluateQO.java[DEMP5M]: F:数字员工评估结果查询对象,按资源ID分页查询
SsResExtTestSetQo.java[DEM5K]: F:数字员工测试集查询对象,按资源ID/批次/处理状态/创建人时间范围分页查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/scheduletask/===
ScheduleTaskQo.java[DT5TM]: F:定时任务查询参数,含资源ID与执行用户ID

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/searchask/===
CollectResourceQo.java[DKNOW5S]: F:收藏资源查询参数,含创建人ID
EnterpriseKbQo.java[DK5M]: F:企业知识库搜索分页查询参数(会话/用户/关键词及驻地岗位组织授权过滤)
PersonalKbQo.java[DAK7S]: F:个人知识库搜索查询参数(分页/会话/创建人/关键词)
RecentlySearchAskQo.java[DROKS]: F:最近搜索问答分页查询参数
SelectedKbQo.java[DK7M]: F:选定知识库查询参数,含目录类型与会话ID
SkillResourceQo.java[DA5ST]: F:技能资源查询对象,封装资源ID列表
SpaceResourceQo.java[DKNOW5M]: F:空间资源查询参数,含创建人与会话ID

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/session/===
ByaiSessionQo.java[DB5KM]: F:会话列表分页查询参数(关键词/创建人/企业/对象类型/调试标记/会话类型)
SessionByAgentQo.java[DCH5K]: F:按数字员工查询会话的分页查询参数,含关键字/用户/对象过滤

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/showcase/===
ShowcaseQueryParam.java[DOB5K]: F:成果空间查询参数,含分页归一化与空白过滤

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/staticdata/===
SystemConfigQo.java[DS5M]: F:系统配置查询对象

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/station/===
SearchStationQo.java[DPOS5VT]: F:查询驻地参数对象,含驻地标识非空校验
StationTreeQo.java[DOR5M]: F:驻地树查询参数对象,支持父驻地过滤/关键字搜索/驻地类型/国内外筛选

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/template/===
TemplateRuleInfoQueryQo.java[DEM5T]: F:模版规则信息查询对象,支持模版ID/用户ID/资源ID精确查询、规则名称内容模糊查询、时间段过滤

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/token/===
AccessTokenQo.java[DD7M]: F:访问令牌列表查询对象,继承QueryObject

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/users/===
SearchUserQo.java[DAUC1T]: F:用户查询对象,按用户ID与组织ID检索
UsersByOrgIdQo.java[DOR5K]: F:按组织ID查询用户的分页查询对象(支持子组织/关键字/岗位/用户类型过滤)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/config/===
WebSecurityConfig.java[GAJ9PM]: F:SpringSecurity安全认证总配置,装配多登录方式过滤链(用户名/手机/鲸加/钉钉/SSO/飞连/CAS/苹果)与OAuth2链 | R:UsernameAuthenticationFilter,PhoneAuthenticationFilter,IwhaleAuthenticationFilter,DingtalkAuthenticationFilter,SSOAuthenticationFilter,FeiLianAuthenticationFilter,CasAuthenticationFilter,AppleAuthenticationFilter,各Provider,MultAuthenticationSuccessHandler,MultAuthenticationFailureHandler,GlobalI18nFilter,GlobalSecurityExceptionHandler | A:/system/session/loginByUsername,/system/session/loginByPhone,/system/social/*,/oauth2/** | S:securityMatcher限定路径permitAll,ProviderManager绑定各Provider,addFilterBefore注入认证过滤器,禁用formLogin/session/csrf,BCryptPasswordEncoder,异常处理EntryPoint与AccessDeniedHandler

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/exception/bean/===
AppleUserBindRequiredException.java[EAU3JT]: F:苹果登录验证通过但无系统用户时抛出,提示手机号绑定或注册 | R:AuthenticationException | A:- | S:错误码-100,携带appleUserId/appleEmail/bindToken,继承Spring Security认证异常
LoginAuthenticationException.java[HAU3JT]: F:自定义登录认证异常,携带用户ID/登录类型/错误码 | R:AuthenticationException | A:- | S:继承Spring Security AuthenticationException,Lombok@Getter,构造传errorMsg

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/exception/===
GlobalSecurityExceptionHandler.java[WAUTH8PS]: F:全局安全过滤器链异常捕获器,统一处理认证/授权/自定义/未知异常并返回JSON | R:BaseException,ResponseUtil,AuthenticationException,AccessDeniedException | A:- | S:继承OncePerRequestFilter,Base.fail/AuthEx返403/未知返500,fastjson序列化写response
MultAccessDeniedExceptionHandler.java[HAU8PT]: F:Spring Security权限拒绝处理器,认证通过但无权访问时返回401 | R:I18nUtil,LoginResponse,AccessDeniedHandler | A:- | S:实现AccessDeniedHandler,记录拒绝日志,setStatus401,JSON输出i18n国际化提示login.request.denied
MultAuthenticationEntryPoint.java[HAU8JT]: F:Spring Security未登录认证失败入口,返回403与JSON错误响应 | R:ResponseUtil.java,I18nUtil.java | A:- | S:实现AuthenticationEntryPoint,commence发送SC_FORBIDDEN,i18n国际化提示,fastjson序列化

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/filter/common/===
CommonFilter.java[WAUTH7JCM]: F:单点登录SSO认证过滤器基类,基于userCode查找或创建会话并缓存SessionId | R:LoginApplicationService,RedisUtil,LoginInfo,SessionRepository | A:- | S:SSO_SESSION_前缀,Redis缓存sessionId 24小时,findById命中则复用否则request.getSession创建,shareSession共享会话

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/handle/===
MultAuthenticationFailureHandler.java[HAU8HS]: F:Spring Security认证失败处理器,记录登录失败日志并返回JSON错误响应 | R:LoginLogApplicationService,LoginAuthenticationException,AppleUserBindRequiredException,LoginResponse,I18nUtil | A:- | S:实现AuthenticationFailureHandler,LoginAuthenticationException记失败日志,AppleUserBindRequiredException返回苹果绑定信息,i18n国际化错误消息,ObjectMapper写JSON
MultAuthenticationSuccessHandler.java[HAU9JSL]: F:多方式登录成功处理器,生成JWT/SSO令牌、共享会话、初始化超级助手知识库、异步启动沙箱并同步授权到Redis | R:LoginApplicationService,JwtService,SsoTokenService,SandboxService,AuthRedisSyncService,SuasSuperassistApplicationService,UserFS,LoginLogApplicationService | A:- | S:onAuthenticationSuccess写JWT+refreshToken+ssoToken,默认密码手机端特殊响应,putLoginAuth写Redis哈希带过期,mountUserBucket挂载用户存储,异步线程池launchSandbox,parseLoginType识别6种登录类型

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/login/apple/===
AppleAuthenticationFilter.java[WAU7JS]: F:苹果登录认证过滤器,提取identityToken/authorizationCode封装认证对象交由Provider校验 | R:AppleAuthentication.java,AbstractAuthenticationProcessingFilter | A:- | S:继承AbstractAuthenticationProcessingFilter,attemptAuthentication读取请求参数,identityToken非空校验,委托AuthenticationManager.authenticate
AppleAuthentication.java[DAUTH7JS]: F:苹果登录认证载体,封装identityToken/authorizationCode及用户信息供SpringSecurity传输 | R:Users,AbstractAuthenticationToken | A:- | S:继承AbstractAuthenticationToken,getPrincipal/getCredentials按认证状态切换,内嵌AppleUserInfo静态类
AppleAuthenticationProvider.java[HAU3JM]: F:苹果Sign In with Apple认证提供者,验证identity token并查找绑定用户完成认证 | R:AppleLoginService,LoginApplicationService,AppleAuthentication,AppleUserBindRequiredException,Users | A:- | S:实现AuthenticationProvider,verifyIdentityToken验证token,findUserByAppleId查绑定,未绑定生成bindToken抛AppleUserBindRequiredException,checkUserIsValid校验用户有效性

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/login/cas/===
CasAuthenticationFilter.java[WAU7JS]: F:CAS单点登录认证过滤器,从请求提取ticket封装为CasAuthentication交由AuthenticationManager认证 | R:CasAuthentication.java,AuthenticationManager | A:- | S:继承AbstractAuthenticationProcessingFilter,attemptAuthentication取ticket参数,设authenticated=false,委托provider认证
CasAuthentication.java[DAUTH3JL]: F:CAS登录认证Token载体,封装ticket与用户信息 | R:Users,AbstractAuthenticationToken | A:- | S:继承SpringSecurity认证token,getPrincipal认证前返ticket认证后返users,getCredentials认证后清空
CasAuthenticationProvider.java[SAU9JL]: F:CAS单点登录认证Provider,验证票据并解析XML获取用户名,自动注册映射用户 | R:UserService,UserApplicationService,LoginApplicationService,CasTicketUser,CasAuthentication,I18nUtil | A:- | S:HttpClient请求p3ServiceValidate,SAX解析XML取user/authenticationFailure,SHA-256哈希取模生成18位userId,findByUserCode缺失则registerByCasTicketUser,checkUserIsValid校验

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/login/dingtalk/===
DingtalkAuthenticationFilter.java[WDI8JM]: F:钉钉登录认证过滤器,提取authCode/loginType发起Spring Security认证 | R:DingtalkAuthentication,AuthenticationManager,AuthenticationSuccessHandler,AuthenticationFailureHandler | A:- | S:继承AbstractAuthenticationProcessingFilter,attemptAuthentication封装code/loginType为DingtalkAuthentication并委托authenticate
DingtalkAuthentication.java[DAD3JT]: F:钉钉登录SpringSecurity认证令牌载体,承载code/loginType/用户信息 | R:Users,AbstractAuthenticationToken | A:- | S:继承AbstractAuthenticationToken,getPrincipal认证前返回code认证后返回users,getCredentials认证后清空,无权限传null
DingtalkAuthenticationProvider.java[HDIN8M]: F:钉钉登录认证Provider,支持网页登录与工作台免登两种方式,通过authCode换取手机号匹配本地用户 | R:UserService,SourceSystemService,LoginApplicationService,DingtalkAuthentication,Users,SourceSystem,LoginAuthenticationException,I18nUtil | A:- | S:实现AuthenticationProvider,调钉钉OAuth2/Contact SDK获取accessToken→userInfo→mobile,findByUserPhone+checkUserIsValid校验,系统配置取appKey/appSecret,失败抛BadCredentials/LoginAuthenticationException

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/login/feilian/===
FeiLianAuthenticationFilter.java[WAU7AT]: F:飞连扫码登录认证过滤器,提取code参数封装认证对象交由Provider认证 | R:FeiLianAuthentication.java,AuthenticationManager | A:- | S:继承AbstractAuthenticationProcessingFilter,attemptAuthentication取code,构造未认证FeiLianAuthentication,委托authenticationManager.authenticate
FeiLianAuthentication.java[DAU3T]: F:飞连登录认证令牌载体,封装code与用户信息 | R:Users.java,AbstractAuthenticationToken | A:- | S:继承AbstractAuthenticationToken,getPrincipal/getCredentials按认证状态返回users或code
FeiLianAuthenticationProvider.java[HAU8M]: F:飞连OAuth登录认证提供者,授权码换token再换工号查用户并校验有效性 | R:UserService,SourceSystemService,LoginApplicationService,FeiLianAuthentication,LoginType,I18nUtil | A:- | S:OkHttp同步请求getTokenUrl/userInfoUrl,fastjson解析access_token/user_id,findByUserCode,checkUserIsValid,失败抛BadCredentialsException

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/login/iwhale/===
IwhaleAuthenticationFilter.java[WAU8JS]: F:鲸云SSO登录认证过滤器,提取code参数封装认证对象交由AuthenticationManager认证 | R:IwhaleAuthentication,AuthenticationManager,AbstractAuthenticationProcessingFilter | A:- | S:继承AbstractAuthenticationProcessingFilter,attemptAuthentication取code参数,构造未认证IwhaleAuthentication委派认证
IwhaleAuthentication.java[DAU3JS]: F:爱鲸单点登录认证令牌载体封装code与用户信息 | R:Users.java,AbstractAuthenticationToken | A:- | S:继承AbstractAuthenticationToken,getPrincipal认证前返code认证后返users,getCredentials认证后清空
IwhaleAuthenticationProvider.java[WAU9JM]: F:鲸+单点登录认证Provider,授权码换JWT解析用户信息完成认证 | R:UserService,SourceSystemService,LoginApplicationService,IwhaleAuthentication,WhaleTokenUser,JWT | A:- | S:OkHttp调getTokenUrl换token,JWT.decode取claims,buildWhaleTokenUser填充,findByUserCode查用户,checkUserIsValid校验,iwhale系统配置appKey/appSecret

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/login/phone/===
PhoneAuthenticationFilter.java[WAUTH8ES]: F:手机号验证码登录认证过滤器,提取表单并发起Spring Security认证 | R:PhoneAuthentication,LoginForm,AesUtils,AuthenticationManager | A:- | S:继承AbstractAuthenticationProcessingFilter,JSON/表单双读取,AES+Base64解密手机号,封装PhoneAuthentication委托authenticate
PhoneAuthentication.java[DAU3T]: F:手机号验证码登录认证令牌承载客户端凭证与用户信息 | R:Users.java,AbstractAuthenticationToken | A:- | S:继承Spring Security认证基类,getPrincipal授权前返手机号后返用户,getCredentials授权后清空验证码
PhoneAuthenticationProvider.java[HAU7ES]: F:手机短信验证码登录认证Provider,校验验证码有效性并签发认证token | R:UserService,SafeAccountMsgService,LoginApplicationService,Sm4Util,PhoneAuthentication | A:- | S:实现AuthenticationProvider,SM4加密验证码比对,查未过期SafeAccountMsg,验证码状态置已用,checkUserIsValid校验用户有效性
PhoneRegisterAuthenticationFilter.java[WAUTH8ET]: F:手机号验证码注册登录认证过滤器,提取表单/JSON并AES解密手机号封装Authentication | R:PhoneRegisterAuthentication.java,LoginForm.java,AesUtils.java,AuthenticationManager | A:- | S:继承AbstractAuthenticationProcessingFilter,attemptAuthentication提取phone/verifyCode,Base64+AES解密账号,委托AuthenticationManager认证
PhoneRegisterAuthentication.java[DAU3T]: F:手机号注册认证令牌载体,封装手机号/验证码/用户信息供SpringSecurity流转 | R:Users,AbstractAuthenticationToken | A:- | S:继承AbstractAuthenticationToken,getPrincipal授权前返phone后返users,getCredentials授权后清空verifyCode
PhoneRegisterAuthenticationProvider.java[SH8EM]: F:手机号短信验证码注册认证Provider,校验验证码并注册新用户 | R:UserService,SafeAccountMsgService,UserApplicationService,Sm4Util,PhoneRegisterAuthentication,I18nUtil | A:- | S:校验手机号未注册,查未过期验证码,SM4加密比对,标记验证码已用,registerByPhone创建用户返回认证token

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/login/sso/===
SSOAuthenticationFilter.java[WAUTH7JS]: F:SSO单点登录认证过滤器,提取systemCode/beyondToken封装认证对象交由AuthenticationManager | R:SSOAuthentication.java,I18nUtil,StringUtil | A:- | S:继承AbstractAuthenticationProcessingFilter,attemptAuthentication提取SSO令牌参数,空令牌抛BadCredentials
SSOAuthentication.java[DAU3TT]: F:SSO单点登录认证令牌载体,封装系统编码/beyondToken/用户信息 | R:Users,AbstractAuthenticationToken | A:- | S:继承Spring Security认证基类,getPrincipal授权前后返回systemCode/users,getCredentials授权后清空beyondToken
SSOAuthenticationProvider.java[WAU8JT]: F:SSO单点登录认证Provider,校验JWT令牌并验证用户有效性 | R:UserService,JwtService,LoginApplicationService,IwhaleAuthentication,SSOAuthentication,JwtUserInfo | A:- | S:实现AuthenticationProvider,verifyJwt解析令牌,findByUserCode查用户,checkUserIsValid校验,通过返回IwhaleAuthentication

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/login/username/===
UsernameAuthenticationFilter.java[WAU8EM]: F:用户名密码登录认证过滤器,提取登录表单并触发SpringSecurity认证流程 | R:UsernameAuthentication,LoginForm,AesUtils,Sm4Util,MD5Utils,AuthenticationManager | A:- | S:继承AbstractAuthenticationProcessingFilter,attemptAuthentication提取JSON/表单参数,loginType=5时AES解用户名+SM4解密码+MD5加盐,封装认证对象交AuthenticationManager
UsernameAuthentication.java[DAU5JS]: F:用户名密码登录认证令牌载体,封装账号密码及认证后用户信息 | R:Users.java,UsernameAuthenticationProvider | A:- | S:继承AbstractAuthenticationToken,getPrincipal认证前返账号认证后返Users,getCredentials认证后清空密码
UsernameAuthenticationProvider.java[WAU8PT]: F:账号密码登录认证Provider,校验用户名密码及用户有效性返回认证Token | R:UserService,PasswordEncoder,LoginApplicationService,UsernameAuthentication,LoginAuthenticationException | A:- | S:findByUserCode查用户,passwordEncoder.matches校验密码,checkUserIsValid检查有效性,失败抛BadCredentials/LoginAuthenticationException,I18n多语言提示

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/security/xss/===
XssFilter.java[WAU5VT]: F:XSS防护过滤器,包装请求过滤恶意脚本并拦截WEB-INF路径遍历 | R:XssHttpServletRequestWrapper.java | A:- | S:实现Filter,init加载excludes正则白名单,multipart/form-data及白名单URL跳过过滤,WEB-INF返回404防目录穿越
XssHttpServletRequestWrapper.java[WAUTH5M]: F:XSS防护请求包装器,过滤参数/请求头/请求体中的XSS攻击内容 | R:XssFilter | A:- | S:继承HttpServletRequestWrapper重写getParameter/getHeader/getInputStream,正则匹配script/iframe/javascript等模式,htmlEncode转义尖括号,POST请求体重读包装为ByteArrayInputStream

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/validate/organization/annotation/===
AddOrgValidator.java[DORG5VT]: F:新增组织参数校验注解 | R:AddOrgValidatorRule.java | A:- | S:JSR380自定义约束注解,@Constraint绑定校验器,作用于TYPE/PARAMETER,运行时保留
ParentOrgIdValidator.java[DORG5VT]: F:父组织标识存在性校验注解 | R:ParentOrgIdValidatorRule.java | A:- | S:JSR380自定义约束注解,FIELD/PARAMETER级,绑定校验规则类

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/validate/organization/rule/===
AddOrgValidatorRule.java[HOR5VT]: F:组织新增/修改的自定义约束校验规则,按校验组分发新增或修改业务校验 | R:Organization,AddOrgValidator,Add,Mod | A:- | S:实现ConstraintValidator,unwrap获取HibernateContext分组payload,validateAdd/validateMod待实现
ParentOrgIdValidatorRule.java[HOR5VS]: F:校验上级组织ID是否存在的自定义约束规则 | R:OrganizationMapper,ParentOrgIdValidator,Organization | A:- | S:实现ConstraintValidator,根组织-1或null放行,LambdaQueryWrapper按orgId查count判断存在性

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/validate/resource/annotion/===
ValidResourceBizType.java[HCO5VT]: F:资源业务类型校验注解 | R:ResourceBizTypeValidator.java | A:- | S:@Constraint自定义校验,绑定ResourceBizTypeValidator,作用于方法/字段/参数
ValidResourceHostType.java[DCO5VT]: F:资源主机类型校验注解 | R:ResourceHostTypeValidator.java | A:- | S:自定义约束注解,@Constraint绑定校验器,作用于方法/字段/参数
ValidResourceSample.java[HCO5VT]: F:资源样本字段校验注解,绑定ResourceSampleValidator | R:ResourceSampleValidator.java | A:- | S:Constraint自定义注解,作用于FIELD/PARAMETER,RUNTIME保留,默认消息国际化键
ValidSystemCode.java[HCO5VT]: F:系统编码校验注解,标注字段/参数触发SystemCodeValidator校验 | R:SystemCodeValidator.java | A:- | S:Bean Validation自定义约束,@Constraint绑定validator,作用于METHOD/FIELD/PARAMETER,运行时保留

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/validate/resource/rule/===
ResourceBizTypeValidator.java[DOB5VT]: F:资源业务类型枚举校验器,校验字符串是否为合法ResourceBizType | R:ResourceBizType,ValidResourceBizType | A:- | S:实现ConstraintValidator,遍历枚举值name匹配,null返回false
ResourceHostTypeValidator.java[DCO5VT]: F:校验资源宿主类型字段是否为合法枚举值 | R:ValidResourceHostType.java,ResourceHostType.java | A:- | S:实现ConstraintValidator,遍历ResourceHostType枚举比对code,空值返回false
ResourceSampleValidator.java[HOC5VT]: F:校验资源样例字段须为合法JSON字符串数组且元素均为非空字符串 | R:ValidResourceSample.java,ObjectMapper | A:- | S:实现ConstraintValidator,空值放行,解析readTree校验isArray,逐元素拒绝非字符串/null/空白
SystemCodeValidator.java[HCO5VT]: F:系统编码合法性校验器,校验值是否匹配SystemCode枚举项 | R:ValidSystemCode,SystemCode | A:- | S:实现ConstraintValidator,遍历枚举equalsIgnoreCase匹配,null返回false

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/validate/station/annotation/===
ParentStationIdValidator.java[DOR3VT]: F:父驻地标识存在性校验注解 | R:ParentStationIdValidatorRule | A:- | S:JSR380自定义约束注解,@Constraint绑定校验规则,作用于字段/参数,默认消息station.pstationid.valid

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/validate/station/rule/===
ParentStationIdValidatorRule.java[HOR5VT]: F:校验父驻地ID是否存在的自定义约束规则 | R:StationMapper,Station,ParentStationIdValidator | A:- | S:实现ConstraintValidator,-1为根节点放行,LambdaQueryWrapper按stationId查count校验

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/validate/users/annotation/===
OrgIdValidator.java[HOR3VT]: F:组织标识存在性校验注解,标注字段/参数触发组织ID有效性验证 | R:OrgIdValidatorRule.java | A:- | S:JCR约束注解,validatedBy绑定OrgIdValidatorRule,作用于FIELD/PARAMETER,运行时保留
PositionIdValidator.java[DPOS3VT]: F:岗位标识存在性校验注解,字段/参数级校验 | R:PositionIdValidatorRule | A:- | S:自定义Constraint注解,validatedBy绑定校验规则,运行时保留
SourceTypeValidator.java[DAU3VT]: F:外系统来源类型校验注解 | R:SourceTypeValidatorRule.java | A:- | S:Bean Validation自定义约束,作用于字段/参数,FIELD/PARAMETER目标,关联校验规则类
UserIdValidator.java[DAU3VT]: F:用户标识存在性校验注解 | R:UserIdValidatorRule.java | A:- | S:JSR303自定义约束,字段/参数级,运行时保留,绑定校验规则类
UserTypesValidator.java[DAU3VT]: F:用户角色类型存在性校验注解 | R:UserTypesValidatorRule.java | A:- | S:自定义Bean校验注解,@Constraint绑定校验规则类,作用于FIELD/PARAMETER,运行时保留
UserTypeValidator.java[HAU5VT]: F:用户角色类型校验注解,标注字段/参数触发用户类型存在性校验 | R:UserTypeValidatorRule.java | A:- | S:JSR380自定义约束,@Constraint绑定UserTypeValidatorRule,作用于FIELD/PARAMETER,运行时保留

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/validate/users/rule/===
OrgIdValidatorRule.java[HOR5VT]: F:自定义校验规则校验组织ID是否存在 | R:OrganizationMapper.java,OrgIdValidator.java,Organization.java | A:- | S:实现ConstraintValidator,null放行,LambdaQueryWrapper按orgId查count判断存在性
PositionIdValidatorRule.java[DPO5VT]: F:校验岗位ID是否存在的自定义约束规则 | R:PositionMapper,PositionIdValidator,Position | A:- | S:实现ConstraintValidator,岗位非必填null放行,LambdaQueryWrapper按positionId查count判存在
SourceTypeValidatorRule.java[HAU3VT]: F:校验用户来源类型(钉钉/企业微信)是否合法 | R:SourceTypeValidator.java,SourceType.java | A:- | S:实现ConstraintValidator,isValid仅允许DING_TALK与WE_CHAT,JSR380自定义校验
UserIdValidatorRule.java[HAU3VS]: F:校验用户ID是否存在的自定义约束校验规则 | R:UsersMapper,UserIdValidator,Users | A:- | S:实现ConstraintValidator,LambdaQueryWrapper按userId查count判存在
UserTypesValidatorRule.java[HAU3VT]: F:校验用户角色类型是否为系统配置USER_TYPE合法枚举 | R:ByaiSystemConfigListMapper,UserTypesValidator,ByaiSystemConfigList | A:- | S:JSR-303自定义校验器,查询USER_TYPE参数组,containsAll判定,空列表放行
UserTypeValidatorRule.java[DAU3VT]: F:校验用户角色类型是否存在于系统配置 | R:UserTypeValidator,ByaiSystemConfigListMapper | A:- | S:ConstraintValidator实现,查USER_TYPE配置组比对paramValue,空值放行

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/auth/===
AuthVo.java[DB5PM]: F:授权信息VO,含授权类型/操作类型/资源类型/授权对象/红黑名单标识
CompareVo.java[DPER5S]: F:权限授予增删改对比结果VO,红黑名单各含新增/更新/删除Map
FixedEntryOperationCapabilityVo.java[DPER5T]: F:固定入口按钮能力视图对象,统一返回用户对企业知识/工具/视图/对象导入入口的可操作性
ManPrivDto.java[DAU3PM]: F:权限授予对象关系DTO,含授权对象ID/被授权对象ID/用户名
PrivilegeGrantAuditVo.java[DA5M]: F:权限授予审计VO,含授权对象/被授权对象类型及状态路径
PrivilegeGrantVo.java[DPE5M]: F:权限授权记录VO,含授权类型/操作类型/资源对象/授予对象/红黑名单/生效失效时间
ResourceAuthVo.java[DPER3M]: F:资源授权信息VO,含资源元数据、归属组织、授权状态及多种权限操作标志
ResourceMemberItemVo.java[DAUM7S]: F:资源成员授权信息VO(授权对象类型/ID/名称、授权类型、红黑名单类型)
ResourceMemberQueryResultVo.java[DAUTHS]: F:资源成员查询结果VO,含管理/使用人员及黑名单列表
ResourceOperationPermissionsVo.java[D]: F:当前登录用户对单个资源的6项操作权限VO(管理/使用/编辑/授权/注销/恢复等)
ResourceUseApplyItemVo.java[DAU5S]: F:资源使用申请审核列表项VO
DigitalEmployeeAuthVo.java: F:数字员工授权信息VO(含资源、权限、授权来源、上架状态及各类授权计数)
GrantSourceVo.java: F:权限授予来源VO(授予对象类型/名称、黑白名单标识)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/datacloud/===
DatacloudScriptScenarioVo.java[D7OBM]: F:数据云脚本场景VO,封装场景主键ID
DatacloudScriptVo.java[DOB5S]: F:数据云脚本VO,封装脚本ID(Long转String序列化)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/digitemploy/===
DebugSessionCleanupVo.java[DD5M]: F:调试会话清理结果VO,含清理成功标志
DebugSessionVo.java[DDC5M]: F:数字员工调试会话VO,含会话信息/消息列表/消息总数
GenerateVo.java[DEM5S]: F:数字员工AI生成结果VO(名称/描述/人设/开场白/常见问题/能力/约束/性格维度/角色属性/处理流程等)
SetDefaultDigitalEmployeeResultVo.java[DEMP5S]: F:设置默认数字员工返回结果VO,含新旧默认员工资源ID/标签名/归属类型

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/ecosystem/===
EcosystemAgentStatusVo.java[DT1ES]: F:浏览器登录态能力状态视图,含运行时/BrowserBridge/Chrome Profile及各站点登录态检测结果
EcosystemRunVo.java[DKNW3T]: F:生态采集运行视图,含步骤/产物/信号嵌套结构
EcosystemSignalVo.java[DB5M]: F:生态采集分层信号VO（类型/编码/置信度/来源）
EcosystemTaskVo.java[DKNW1S]: F:生态采集任务视图,含任务/连接/调度/入库/运行状态及分层信号
EcosystemConnectorVo.java: F:生态连接器能力视图,描述连接器编码/分类/认证方式/采集模式/能力清单等

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/index/===
AuthDigitEmployVo.java[DEM5M]: F:当前账号可用授权数字员工信息视图对象
AuthResourceVo.java[DP5M]: F:权限资源视图对象,承载资源编码/名称/业务类型及创建归属信息
DepartmentRangeVo.java[DD5M]: F:部门范围视图对象,含组织ID/名称/父级/层级/路径编码
DigitEmployMarketVo.java[DE5SM]: F:数字员工市场展示VO,含资源信息/授权权限标志/创建人/技能标签
EmployeeResourceStatsDto.java[DEM5S]: F:数字员工资源统计DTO,统计知识与技能数量
ManPrivVo.java[DPER5S]: F:授权管理者权限VO,含授权资源/管理者用户/权限名称
SessionMemberResourceVo.java[DC5T]: F:会话关联资源信息视图对象,含资源ID/名称/编码/头像/智能体类型/会话ID等字段
DigitEmployMarketExtVo.java: F:数字员工市场扩展VO,封装授权数量统计与知识技能计数
ResourceTypeCount.java: F:资源类型统计VO,含知识/智能体/工具/对象等各类资源数量及总数计算

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/men/===
FixedMemoryMemoryTaskVo.java[DE5TS]: F:固定记忆任务VO,含任务ID/类型/标题/内容/资源关联
MenTaskDeleteResultVo.java[DA7T]: F:删除待办任务结果VO,含成功/失败计数与失败任务详情
MenTaskRecObjVo.java[DEM5S]: F:待办任务接收对象VO,扩展接收人用户编码与名称
MenTaskVo.java[DTA5T]: F:待办任务VO,扩展MenTask含卡片类型/接收人/资源等展示字段
MenTaskQueryByResourceVo.java: F:根据资源ID查询待办任务结果对象(含任务总数、状态分组统计、任务列表)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/notification/===
NotificationVO.java[DC5S]: F:通知消息展示对象

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/operations/===
DigEmployeeOperationsVO.java[DEM5M]: F:数字员工运营信息VO,返回基本信息及关联技能/知识库资源
RelResourceVO.java[DVO5T]: F:关联资源VO,含资源ID/名称/业务类型

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/organization/===
BelongOrgManagerVo.java[DOR3M]: F:用户所属组织管理者VO,含用户ID/编码/名称及授权对象ID
OrganizationVo.java[DOR5T]: F:组织视图对象,含组织ID/编码/名称/排序/父组织/描述
OrgManagerVo.java[DOR3T]: F:组织管理员视图对象,含用户ID/编码/名称及组织ID
OrgTreeVo.java[DOR3NS]: F:组织树视图对象,含组织ID/名称/父ID/路径/子组织数量

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/permissiongroup/===
AddResultVO.java[DP5T]: F:新增操作结果视图对象,封装新增记录ID并防止Long精度丢失
AuthorizedObjectVO.java[DPER5S]: F:权限组授权对象视图对象(用户/组织/角色/岗位授权关系)
AuthorizedUserVO.java[DPER5S]: F:权限组授权用户视图对象,返回去重后的授权用户信息
AvailableObjectVO.java[DPER5T]: F:可用授权对象视图,含对象ID/类型/名称/编码/所属组织/授权状态
CatalogSimpleVO.java[DPER5T]: F:权限组目录联合查询的目录简化视图对象
DataPermissionVO.java[DD5PM]: F:数据权限视图对象,含数据范围类型/字段权限/行级权限配置
DimensionListPermissionVO.java[DPER5M]: F:维度列表权限视图对象,返回用户对指定数据实例列表的访问权限及可访问/不可访问ID集合
PermissionGroupAndCatalogResultVO.java[DPER5M]: F:权限组与目录联合查询结果视图,含目录列表与权限组信息列表
PermissionGroupCategoryVO.java[DPER1S]: F:权限组目录树形视图对象
PermissionGroupVO.java[DPRM5S]: F:权限组视图对象,含功能权限列表与数据权限配置
PermissionResourceVO.java[DPER5S]: F:权限资源视图对象,含权限组信息及读写删导出权限标识、树形子资源列表
ResourceAttributePermissionVO.java[DPER5T]: F:资源属性权限视图对象,含资源/属性ID名称、数据范围类型、审计字段
AuthorizedObjectDataPermissionVO.java: F:授权对象数据权限视图对象
PermissionGroupWithCatalogVO.java: F:权限组含目录信息视图对象

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/position/===
PositionDigitalEmployeeVo.java[DPO5M]: F:岗位数字员工VO,含数字员工基本信息与岗位关联信息
PositionUsersVo.java[DPOS5S]: F:岗位关联用户VO,含用户编码/电话/工号/组织层级路径

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/resource/===
AgentPromptVo.java[DEM5S]: F:智能体提示词生成响应VO(描述/人设/开场白/常见问题/标签/能力边界/处理流程/性格维度等)
DigitalEmployeeDetailVo.java[DEMP1S]: F:数字员工详情VO,继承SsResExtDigEmployee扩展属性
DigitalEmployeePageVo.java[DD5EM]: F:数字员工资源分页查询VO
DigitalEmployeeVo.java[DAE1PS]: F:数字员工视图对象,扩展DTO含目录/管理者信息及多种权限操作标记
DirAndFileVo.java[DFS5FT]: F:目录与文件资源展示VO,含目录路径/文件信息/创建人
ResourceVO.java[DCOR5S]: F:资源VO,含资源ID/版本/名称/类型/业务类型/服务模式/目录/管理组织用户/状态等字段
SsResExtEvaluateCompareVO.java[DEMP5S]: F:数字员工评估比对VO,含基准值/评估值/上岗符合判定
SsResExtEvaluateVO.java[DEMP5S]: F:数字员工评估旧数据VO，含准确率/异常率/响应时长/人设规范度/上岗合格等指标
SsResExtTestSetVo.java[DEM5T]: F:数字员工测试集查看对象,继承实体扩展处理状态名称字段
ShelfResourceVo.java: F:上架资源VO,扩展资源来源类型(如插件下工具来源为PLUGIN)
SsResExtAttributeVo.java: F:资源扩展属性VO,继承实体扩展别名/来源表/术语类型等中间字段
SsResExtEvaluateTestSetVO.java: F:数字员工测试集评估结果VO,含准确率/意图识别率/测试详情列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/scheduletask/===
ScheduleTaskVo.java[DB5M]: F:定时任务展示VO,扩展ScheduleTask附加资源名/执行用户名/执行频率列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/searchask/===
EnterpriseKbVo.java[DK5M]: F:企业知识库视图对象,含已选知识库列表与分页信息
ImportSelectedDatasetVo.java[DKN5M]: F:导入选中数据集VO,含会话ID
PersonalKbVo.java[DKNO5M]: F:个人知识库视图对象,含已选知识库列表与分页资源信息
RecentlySearchAskVo.java[DQ7M]: F:最近搜索问答会话VO,继承ByaiSession实体
SelectedVo.java[DK5M]: F:问答会话选中项VO,封装sessionId
SpaceKbResourceVo.java[DK7M]: F:空间知识库资源VO,携带datasetId(序列化为字符串)
SpaceResourceVo.java[DK5M]: F:空间资源目录VO(目录ID/父ID/名称/数据类型/关联数据标识)
ImportFilesVo.java: F:导入文件结果VO,含会话ID与文件列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/showcase/===
ByaiShowcaseVo.java[DCORE5M]: F:案例展示VO,扩展实体增加创建人编码字段

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/staticdata/===
SystemConfigListGroupVo.java[DS5M]: F:系统配置分组VO,含分组编码/名称/缓存JSON
SystemConfigVo.java[DV5SM]: F:系统配置VO,继承系统配置实体并扩展缓存JSON字段

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/vo/users/===
UserMailAccountVO.java[DCO5M]: F:用户个人邮箱账号安全视图,屏蔽授权码明文仅返回后四位
UsersDetailVo.java[DAU1S]: F:用户详情VO,含用户标识/编码/工号/邮箱/电话/角色类型列表/组织/职位/驻地等字段
UsersOrganizationVo.java[DOR5M]: F:用户组织关系VO,扩展实体补充组织/角色/岗位名称
UsersOrgVo.java[DOR5M]: F:用户关联组织查询VO
UsersOrgPostVo.java: F:用户的组织岗位关联VO(用户ID+组织列表)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/callback/===
CallbackApplicationService.java[SAU5CR]: F:任务回调结果查询应用服务,按会话/消息/时间戳从Redis查回调记录并按状态(处理中/成功/失败)封装响应 | R:RedisUtil,CallbackRequest,ResponseUtil | A:- | S:callback:record:前缀Key构建,RedisUtil.getString读取,JSON解析status字段,无记录返PROCESSING,switch分支组装message

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/chat/===
AssistantChatApplicationService.java[SC9SL]: F:助手会话应用服务,停止任务/会话文件上传校验/消息结构与思考过程增量编辑及运行态快照同步 | R:GatewayClient,SessionService,FilesService,ConversationFileStorage,ConversationStoragePathResolver,TargetAgentTypeResolver,RunningChatSnapshotService,RunningOutputStreamRegistry,OutputStreamManager,ByaiMessageHotService,SsResExtDigEmployeeService | A:- | S:cancelTask取消并释放快照,按数字员工/全局配置校验文件数量大小,createSession建会话写MinIO,DB命中或运行快照双路更新messageStruct/inferLog,同步messageContext的AnswerDelta防storeMessage覆盖,JSONArray按id定位choices.delta.content替换
OpenApiConversationApplicationService.java[SCH8OMM]: F:OpenAPI开放会话文件应用编排服务,负责会话文件读写追加/会话CRUD并临时切换用户上下文定位byclaw-{userCode}空间 | R:ConversationFileStorage,ConversationStoragePathResolver,SessionService,SequenceService,ByaiMessageHotService,CurrentUserHolder | A:- | S:writeTxt覆盖写/appendTxt追加写/read按行流式读StreamingResponseBody,withUserContext临时切LoginInfo再恢复,路径规范化防..穿越,resolveContentType按后缀推断,createSession/updateSession带租户用户隔离,MinIO/UserFS委托存储
PythonWebService.java[SCH7GL]: F:调用Python QA-Worker的HTTP客户端,流式接收对话补全与同步事件追加 | R:UrlUtil,EnvConfigKey,ApplicationContextUtil,BdpRuntimeException via qa | A:- | S:HttpURLConnection流式读BufferedReader,RestTemplate同步POST,SHA256签名(accessKey+timestamp+body+secretKey)+X-Signature/X-Timestamp/X-Access-Key请求头,fastjson序列化
SsSuperAssistKwCatalogApplicationService.java[SK7OL]: F:超级助手会话文件上传与知识库重建,校验上传规则并落个人会话知识库 | R:DatasetApplicationService,SuperassistService,SsResExtDigEmployeeService,ByaiSystemConfigService,CurrentUserHolder | A:- | S:按agentId优先取上传配置回退全局,校验文件数量/大小,getDatasetId取用户个人会话知识库ID,委托datasetApplicationService.uploadFiles,CustomFilenameMultipartFile重命名,MinIO存储,用户隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/chat/enums/===
FileGroupEnum.java[ACHATK1T]: F:聊天文件分组类型常量(文档/表格/图片/综合) | R:- | A:- | S:静态字符串常量1-4
SessionType.java[KCH1T]: F:会话类型常量(超级助手/问数/慧笔/鲸灵/数字员工)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/dataset/===
DatasetApplicationService.java[SK9PTL]: F:数据集/知识库应用服务,管理ss_resource表知识库CRUD及库内目录文件上传构建下载、JSON导入(新增/更新)、能力开关、第三方知识库模式校验、三态存储产物同步 | R:SsResourceService,SsResExtDocService,FeignPythonBuildService,ResourceArtifactStorageService,ResourceDiscoveryRegistrationService,AuthApplicationService,ResourceTargetJsonBuilder via feign:pythonbuild | A:- | S:Feign调py构建知识库,@Transactional导入,validateKnowledgeBaseWritable第三方模式拦截,权限校验hasResourceManage/Access,软删REMOVED状态,registerAfterCommit资源注册,minio/nfs双态产物落点,默认个人知识库不可删,catalogId归属隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/filebrowser/===
FileBrowserApplicationService.java[ASFM5S]: F:文件浏览器应用服务,封装工作区文件增删改查/上传下载/重命名/移动/搜索/打包下载 | R:FileBrowserProviderFactory,FileBrowserItemVo | A:- | S:Provider工厂模式委托,默认工作区路径模板.openclaw/workspace-baiying-agent-{resourceId},按userCode+resourceId隔离,文件夹名解析
FileBrowserProviderFactory.java[SFI5T]: F:文件浏览器Provider工厂,按品牌版本选择Minio或OpenClaw实现 | R:MinioFileBrowserProvider,OpenClawFileBrowserProvider,ByaiSystemConfigService,FileBrowserType | A:- | S:Map注册两类Provider,读BYAI_BRAND_VERSION配置,commercial走OpenClaw否则Minio,缺类型抛异常
FileBrowserProvider.java[SF5MS]: F:文件浏览器存储抽象接口,定义增删改查/上传下载/重命名/移动/搜索/文件夹压缩下载契约 | R:FileBrowserItemVo | A:- | S:按userCode+resourceId+relativePath定位,多态存储三态实现入口,流式上传下载
FileBrowserType.java[EFI5T]: F:文件浏览器类型枚举(MINIO/OPENCLAW)
MinioFileBrowserProvider.java[SF7OML]: F:MinIO存储形态的文件浏览器Provider实现,提供列表/上传/下载/删除/重命名/移动/建文件夹/搜索/文件夹打包下载 | R:FileBrowserProvider,MinioStorageService,UserBucketNameResolver,StorageLocation,FileBrowserItemVo | A:- | S:按userCode解析用户桶,by/前缀拼绝对路径并校验..越权,递归listObjectKeys遍历,copy+delete模拟move/rename,ZipOutputStream流式打包文件夹,数随人走多租户隔离
OpenClawFileBrowserProvider.java[SF8SL]: F:OpenClaw沙箱文件浏览器Provider实现,通过沙箱Ingress代理转发文件list/upload/download/delete/rename/mkdir/search/文件夹打包下载 | R:FileBrowserProvider,SandboxIngressEndpointResolver,SandboxIngressRuntimeResolver,FileBrowserItemVo | A:- | S:OkHttp调沙箱/filebrowser/openclaw-api,resolvePath防..路径穿越,move不支持,JSON解析items构建VO,ZipOutputStream逐文件打包,download返回ByteArrayInputStream

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/fs/===
FsOperationApplicationService.java[SFS8POML]: F:UserFS/ResourceFS统一文件操作编排层,处理路径规范化/空间路由/资源权限校验/上传下载删除重命名建目录 | R:UserFS,ResourceFS,AuthApplicationService,SsResourceService,UserBucketNameResolver,CurrentUserHolder,FsSpaceType,MultipartFileUtil | A:- | S:USER/RESOURCE双空间路由,资源管理/访问权限校验,路径防穿越../与租户用户隔离,MinIO无空目录用.keep marker,copy+delete模拟rename,runAsUserCode身份切换,StreamingResponseBody流式下载

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/index/===
IndexApplicationServiceV2.java[SE8MTM]: F:数字员工首页应用服务V2,聚合我创建/订阅/常用/最近/发现/热门/部门范围/授权文档工具的分页查询与运行时标签权限回填 | R:IndexService,ResourceAuthContextService,SandboxService,SsResourceCatalogService,SuasSuperassistService,CurrentUserHolder,ShareCacheUtil,PageHelperUtil | A:- | S:PageHelper分页,90天频次排序,运行时标签按ownerType/agentType/第三方计算,默认数字员工回填,红黑名单授权过滤,沙箱资源处理容错,目录树下钻,多租户用户隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/limit/===
ChatCallLimitService.java[SAR5CM]: F:基于Redis的用户每日聊天调用次数限制服务,原子计数+超限校验+剩余次数查询+管理员重置 | R:ByaiSystemConfigService,RedisTemplate,StringUtil | A:- | S:INCR原子自增+expireAt当天结束,key前缀chat:limit:{userId}:{yyyyMMdd},限额读DAILY_CHAT_LIMIT配置默认500,按用户隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/manage/===
AssistantManApplicationService.java[SCH8MM]: F:助手综合搜索应用服务,按type聚合数字员工/企业员工/会话消息检索 | R:SessionService,IndexApplicationServiceV2,ByaiMessageHotService,CurrentUserHolder,FindQo,SearchDto,MessageSearchDto | A:- | S:type分支(all/digit/user/session),搜索类型校验过滤(message/participant/title),消息内容按sessionId分组,会话标题/参与者搜索带creatorId多租户隔离,会话与消息合并按sessionId倒序

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/message/===
MessageService.java[SCH9CWL]: F:消息核心服务,聊天历史/反馈点赞点踩/消息转发/SSE流式代理/群聊消息保存/外部消息增改/HTML内容解析及收藏信息补充 | R:MemoryMessageService,ByaiMessageHotService,ByaiMessageRelObjService,SessionApplicationService,ShowcaseService,SequenceService,ByaiSystemConfigService,MessageContentHandlerFactory | A:- | S:metadata反馈元数据构建,resMsgId/askMsgId/taskId三级索引定位,WebClient流式readLine输出,正则提取html代码块分段,记忆引擎分页查询补充收藏fileCode,多租户CurrentUserHolder

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/searchask/===
HtmlToMarkdownService.java[SK5M]: F:HTML转Markdown工具,清洗无关标签提取核心正文并过滤装饰性图片 | R:flexmark-html2md, jsoup, HtmlRenderer | A:- | S:Jsoup+Safelist清洗,提取#mp-editor核心区,FlexmarkHtmlConverter转换,正则移除static/icon等无用图片,多空行归并
SearchAskApplicationService.java[SCH7WM]: F:搜问应用服务,处理搜问聊天与会话创建及最近搜问分页查询 | R:SessionService,SequenceService,CompletionsUtils,CurrentUserHolder,PageHelperUtil,SearchAsk | A:- | S:无sessionId时建会话写SSE,SseResponseEventEnum流式输出,租户企业隔离,按当前用户分页查最近H_S_A会话
SpaceDriApplicationService.java[SKN7OUM]: F:搜问空间目录应用服务,管理个人/企业知识库/技能/收藏夹资源选择与文件导入到搜问空间 | R:SpaceDirService,SpaceDirRelService,FileService,FileIngressService,SessionService,SequenceService,ResourceAuthContextService,CurrentUserHolder | A:- | S:listImportResource/listPersonalKb/listEnterpriseKb按用户授权(站点/组织/岗位)查询,importFiles走FileStorageContext.searchImport上传MinIO,无会话自动建会话,importSelectedDataset增量diff选择,selected/unSelectedResource批量增删SpaceDirRel关联
WebCrawlFetchService.java[SK5TM]: F:网页抓取服务,对source_url发起GET请求获取HTML并处理超时/编码/SSRF防护,联网搜索归档用 | R:WebCrawlFetchResultDTO,MultipartFileUtil,StringUtil,Jsoup | A:- | S:Jsoup连接抓取(超时/1MB限制/UA),协议白名单+allowedHosts域名校验防SSRF,IOException映射404/403/4xx5xx,URL脱敏日志,Markdown转内存MultipartFile
WebSearchArchiveApplicationService.java[SK7TOL]: F:联网搜索归档应用服务,调DocChain搜索→爬URL转Markdown上传MinIO落库,管理搜问会话与导入目录 | R:FeignDocChainService,WebCrawlFetchService,HtmlToMarkdownService,FileIngressService,SessionService,SequenceService,WebCrawlRequestMapper,WebCrawlDocArchiveMapper,SpaceDirMapper,SpaceDirRelMapper,FilesMapper | A:- | S:query生成requestId存请求表,archiveSelected事务批量爬取入库byai_files+web_crawl_doc_archive,ensureSessionExists自动建会话,ensureWebSearchDirectories建导入来源/联网搜索两级目录,SpaceDirRel存docList JSON,listBySessionId反查文档,@Transactional回滚,FileStorageContext.searchFile存储三态

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/session/===
ByClawFileQueryApplicationService.java[SA8OM]: F:用户byclaw文件查询应用服务,按用户上下文查询会话文件并列出个人空间 | R:UserFS,MinioStorageService,UserBucketNameResolver,ConversationStoragePathResolver,CurrentUserHolder,ByClawFileDto,UserSpaceVo | A:- | S:list .sessions前缀文件,sessionId范围匹配+关键字过滤,withUserContext临时切换LoginInfo,StoragePrefix列minio空间,agent根前缀模板,数随人走多租户隔离
ByClawPersonalAgentArchivApplicationService.java[SFI5OML]: F:个人agent档案(tar.gz)上传/查询/下载/删除应用服务,固定路径口径bucket=byclaw-{userCode}+objectKey=/by/.personal-agents/{resourceId}/{file},同名覆盖 | R:FsOperationApplicationService,ByClawUserWorkspacePaths,ByClawPersonalAgentArchiveDto,FsFileDeleteRequest,FsSpaceType,I18nUtil | A:- | S:先删后写覆盖语义,路径规范化防穿越(..拦截),关键字过滤+按文件名排序,StreamingResponseBody流式下载,guessContentType默认gzip,用户隔离put/list/download/deleteAsUser
ByClawSkillDeleteApplicationService.java[ASKILL5MS]: F:用户工作空间技能目录删除服务,按数字员工/超级助手口径解析路径并删除skill目录 | R:UserFS,ByClawSkillPathResolver,ByClawUserWorkspacePaths,ByClawSkillDto,I18nUtil | A:- | S:用户上下文隔离删除,路径规范化防遍历(..校验),skillRootPrefix前缀校验,删前list存在性检查
ByClawSkillDownloadApplicationService.java[SSK7OM]: F:用户工作空间skill目录流式打包ZIP下载应用服务 | R:UserFS,ByClawSkillPathResolver,ByClawUserWorkspacePaths,I18nUtil | A:- | S:路径合规化(拒..防越权/校验skill根前缀),提前list对象,StreamingResponseBody流式8KB拷贝逐对象写ZipEntry,withUserContext按用户隔离切bucket,数据落MinIO三态
ByClawSkillPathResolver.java[SSK7MS]: F:解析数字员工skill根目录,按ownerType+agentType命中模板配置路径否则回退默认路径 | R:SystemConfigService,SsResourceService,SsResExtDigEmployeeService,ByClawUserWorkspacePaths | A:- | S:TEMPLATE_DIGITAL_EMPLOYEE参数JSON配置,{userCode}/{resourceId}占位符替换,路径归一化与..防穿越校验,按用户隔离数随人走
ByClawSkillQueryApplicationService.java[ASKILL7OS]: F:查询用户工作空间下的skill列表(数字员工/超级助手路径) | R:UserFS,ByClawSkillPathResolver,ByClawUserWorkspacePaths,ByClawSkillDto,I18nUtil | A:- | S:按resourceId解析skill根前缀,只识别skills/{name}/SKILL.md两层结构,keyword按目录名模糊匹配,按用户上下文list对象,按skillName排序
ByClawSkillUploadApplicationService.java[SSK7OL]: F:用户工作空间skill压缩包上传服务,解压zip/tar.gz后流式写入MinIO | R:UserFS,ByClawSkillPathResolver,ByClawUserWorkspacePaths,ByClawSkillDto,ByClawSkillQueryApplicationService,I18nUtil | A:- | S:支持zip/tar.gz解压(GBK回退编码),SKILL.md唯一性校验,50MB大小限制,路径穿越过滤,__MACOSX/.DS_Store噪音剔除,覆盖语义先清旧目录,SKILL.md文件名大小写规范化,按userCode切换用户上下文多租户隔离,数字员工/超级助手前缀区分
ByClawUserWorkspacePaths.java[US03MS]: F:用户桶/by工作空间路径解析工具(skills/agent skills/个人agent归档根前缀拼接、objectKey规范化、超级助手识别、跨用户LoginInfo上下文临时切换还原) | R:CurrentUserHolder,LoginInfo | A:- | S:USER_FS根/by前缀,workspace skills与baiying-agent-%s模板,personal-agents归档模板,SKILL.md标志,withUserContext按userCode切上下文执行回调finally还原,多租户数随人走
SessionApplicationService.java[SCA9AM]: F:会话增删改查应用服务,管理自定义线程池实现会话信息异步更新 | R:SessionService,SessionExtService,SessionMemberService,ByaiMessageHotService,SsSuperassistSubAgentService,ChatUtils,CurrentUserHolder | A:- | S:ThreadPoolExecutor自管理(PostConstruct初始化/PreDestroy优雅关停),分页查会话带用户+企业隔离,异步更新会话内容,级联删会话扩展成员消息,getSession按@智能体或助手设objectType,CallerRunsPolicy拒绝策略
WorkspaceArchiveApplicationService.java[ASF5OL]: F:工作区归档(取消授权/删除)上传下载状态查询删除,sha256校验与元数据JSON持久化 | R:ArchiveFS,ByclawArchiveFS,FileMetadata,WorkspaceArchiveDto,CurrentUserHolder,LoginInfo | A:- | S:archiveFS存储三态,DigestInputStream算SHA256,StreamingResponseBody流式下载,withUserContext临时切换登录上下文,metadata.json旁路写读回退对象存在性判断,cancel_auth/delete两种归档类型

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/task/===
TaskService.java[SS7VL]: F:长程任务服务,表单提交/任务有效性校验(步骤完整性/依赖关系/文件路径匹配)/手动修订任务 | R:ByaiMessageHotService,CompletionsUtils,PromptConstants,MessageTaskDto,MessageTaskValidResultDto,TaskValidationContext,AnswerDelta | A:- | S:submitForm更新表单状态码,validateTask代码校验+预留AI校验合并,buildValidationContext构建步骤输出文件可用集,validateStepDependencies依赖顺序校验,validateFileRelations输入输出文件来源校验,manualTask从后遍历修改TASK内容回写messageStruct,I18n语言切换prompt

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/aspect/===
ChatCallLimitAspect.java[HCH8AT]: F:聊天调用次数限制切面,拦截@ChatCallLimit注解校验用户每日会话调用上限 | R:ChatCallLimitService,CurrentUserHolder,I18nUtil,BdpRuntimeException | A:- | S:@Around环绕通知,获取当前用户ID,checkAndIncrementCallCount超限抛异常,否则放行
ManageLogAspect.java[HAU8AM]: F:管理操作日志AOP切面,环绕拦截@ManageLogAnnotation方法记录操作审计日志 | R:ManageLogService,ManageLog,ManageLogAnnotation,CurrentUserHolder,IpUtil,BaseRuntimeException | A:- | S:@Around环绕通知,反射读注解name/description,采集当前用户/IP/类名/方法,JSON序列化入参出参(过滤ServletRequest/Response/MultipartFile),finally保存日志,异常包装BaseRuntimeException

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/config/===
I18nConfig.java[GSY3S]: F:国际化配置,注册MessageSource/LocaleResolver/校验器集成i18n | R:I18nLocaleResolver | A:- | S:classpath:i18n/messages资源,UTF-8编码,useCodeAsDefaultMessage,缓存3600s,@Valid校验国际化
MybatisPlusConfig.java[GDS5KS]: F:MyBatis-Plus配置,注册分页拦截器与多数据库厂商识别 | R:MybatisPlusInterceptor,PaginationInnerInterceptor,VendorDatabaseIdProvider | A:- | S:按dbType切换PostgreSQL/MySQL分页方言,DatabaseIdProvider映射厂商名,支持分页查询
NettyConfig.java[GWS5WM]: F:Netty WebSocket服务器配置,定义boss/worker事件循环组、ServerBootstrap及业务执行线程组 | R:NettyProperties | A:- | S:支持Epoll(Linux)/NIO双模式,bossGroup/workerGroup/serverBootstrap/webEventExecutorGroup/broadcastEventExecutorGroup五Bean,TCP keepalive+nodelay,自定义NamedThreadFactory命名线程
NettyProperties.java[GWS5WT]: F:Netty WebSocket服务配置属性,绑定netty前缀的端口与线程数参数 | R:- | A:- | S:@ConfigurationProperties(netty),workerThreads默认CPU核数x2,bossThreads=1,port=8082
Resilience4jConfig.java[GCO5S]: F:Resilience4j容错配置注册熔断/限流/超时/重试 | R:- | A:- | S:CircuitBreaker滑动窗口10失败率50%,RateLimiter每秒10次,TimeLimiter3秒超时,Retry重试3次针对IO/Timeout异常
SessionConfiguration.java[GAU3GT]: F:Session配置类占位空壳 | R:- | A:- | S:@Configuration空实现,无Bean定义
StringToLongConverter.java[GSY1VT]: F:Spring类型转换器,GET请求String转Long处理undefined为null | R:- | A:- | S:实现Converter接口,空值/undefined返null,NumberFormatException兜底返null
SwaggerConfig.java[GSY3T]: F:对话引擎OpenAPI/Swagger文档配置 | R:- | A:- | S:OpenAPI Bean,Beyond-token APIKEY HEADER安全方案,Info/Contact/License元信息
WebConfig.java[GSY3T]: F:Web MVC配置,注册UTF-8字符编码过滤器 | R:- | A:- | S:CharacterEncodingFilter强制UTF-8,FilterRegistrationBean最高优先级order=0,拦截/*
WebCorsConfig.java[GAU3S]: F:全局CORS跨域过滤器配置,放行所有源/方法并暴露Tus上传相关Header | R:CorsFilter,UrlBasedCorsConfigurationSource | A:- | S:allowedOriginPattern通配,支持GET/POST/PUT/PATCH/DELETE/OPTIONS,暴露Location/Upload-Offset/Upload-Length/Tus-Resumable,映射/**
XssFilterConfig.java[GAUT5S]: F:注册XSS过滤器拦截全部请求防注入 | R:XssFilter | A:- | S:ConditionalOnProperty条件启用,order=1次于编码,addUrlPatterns/*,excludes可配排除url

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/constant/===
GrantToObjTypeConstants.java[KPE1S]: F:权限授予对象类型与权限级别常量(人员/组织/岗位/使用/管理/分享/文档/智能体) | R:- | A:- | S:USER/ORG/POST授予对象,USE_PRIV/MANAGER_PRIV/FORCE_PRIV/SHARE_PRIV权限级,三层授权枚举

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/dto/===
AnswerDelta.java[DCD5AM]: F:答案/推理增量信息DTO(a2a组件part:文本/卡片/视频/图像/文件)
BatchUnsubscribeApprovalRequest.java[DOB5M]: F:批量取消订阅审批请求,含审批申请项列表(资源对象ID/理由/审批人)
ChatQaRequest.java[DKN5M]: F:知识问答请求DTO，含语言/问题内容/知识库ID列表/文档ID列表
DeltaDto.java[DD5CT]: F:增量内容数据载体(流式响应delta块)
FileUploadDto.java[DKN5M]: F:知识库文件上传请求参数(含数据集ID/元数据/多文件/类型校验)
MessageDto.java[DCH1M]: F:消息实体DTO，含消息内容/向量/角色/关联对象/会话租户隔离字段
MessageStructDto.java[DCH8M]: F:消息结构更新DTO,承载会话消息内容/思考过程的字段更新载体
ResourceInfoDto.java[DCORES]: F:资源信息数据传输对象(对象Id/名称/类型:数字员工/文档库/插件/数据库)
SubscribeDto.java[DCO5K]: F:订阅查询分页参数(类型/页码/页大小)
UnSubscribeDto.java[DCO5M]: F:取消订阅请求数据类,含类型(DOC/AGENT/PLUGIN/DB)与id列表
ChoiceDto.java: F:LLM流式响应choice数据结构(完成原因/增量内容/索引)
MessageQo.java: F:会话消息分页查询参数,含会话ID/时间范围/用途/消息ID过滤
NexusaiPage.java: F:分页参数基类,提供页码页大小默认值与上限校验

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/enums/===
AgentTypeEnum.java[KEMP1T]: F:数字员工类型枚举(通用/文档问答/数据问答/插件/ChatBI/写作/数字人/Bot/个人知识库/联网搜索) | R:- | A:- | S:name+nameCode+url三字段,getNameCode按编码反查默认回退AGENT
ApproveStatusEnum.java[KEMP1T]: F:审批状态枚举(待审/通过/拒绝) | R:- | A:- | S:state数字员工审批三态枚举
ChatBiAnswerTypeEnum.java[KCH1T]: F:ChatBi问数SSE应答类型枚举(文本/查询结果JSON/意图识别)
CommonErrorCodeEnum.java[KCO1T]: F:统一日志/错误编码枚举,定义系统异常90120与业务异常10120 | R:- | A:- | S:enum含code/msg字段,双构造器,边缘常量类
KnowledgeQueryTypeEnum.java[EKN3T]: F:知识检索类型枚举(语义/全文/混合) | R:- | A:- | S:embedding/fullTextRecall/mixedRecall三值,Lombok生成
MessageContentTypeEnum.java[KCH5S]: F:消息内容类型枚举(文本/图表/表单/审批/思考过程/任务/卡片等) | R:- | A:- | S:code-msg双字段,getByCode静态查找,@Getter
OptimizeTypeEnum.java[KEM7M]: F:智能体配置项AI优化类型枚举,内置中英双语优化提示词模板(名称/描述/人设/开场白/常见问题/推荐问题) | R:- | A:- | S:type/enName/desc三字段,内嵌ZH/EN各6套Prompt模板,getPrompt按类型+语言选模板并替换${description}注入智能体信息,内部类OptimizeField封装字段值
ResourceTypeEnum.java[KEM7T]: F:资源类型枚举(智囊团/文档库/插件)


===byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/exception/===
BdpRuntimeException.java[HCO3T]: F:智能体状态模块运行时异常类 | R:BaseRuntimeException | A:- | S:继承BaseRuntimeException,三种构造器支持错误消息/异常/Throwable包装

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/filter/===
GlobalI18nFilter.java[WSY5S]: F:全局国际化过滤器,从header/param/body/attribute多级解析语言并设置Locale | R:I18nUtil,RequestWrapper,StringUtil | A:- | S:OncePerRequestFilter,header优先(language/x-language),JSON-POST包装RequestWrapper读body,默认中文,setLocale
SignAntiReplayFilter.java[WACGS]: F:签名验签+防重放攻击过滤器,校验请求签名/nonce/时间戳并经Redis去重 | R:SignAntiReplayConfig,RedisUtil,MD5Util,RequestWrapper,I18nUtil,RedisConfig | A:- | S:OncePerRequestFilter,x-signature头三件套校验,时间窗口防重放,Redis-setIfAbsent防nonce重放,GET用queryString-POST用JSON-body,session取USER_CODE,MD5(userCode+nonce+ts+body+salt)验签,AntPathMatcher排除URL

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/filter/request/===
RequestWrapper.java[WSY5T]: F:可重复读取请求体的HttpServletRequest包装器 | R:- | A:- | S:缓存body字节数组,重写getInputStream/getReader,支持多次读取请求流

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/filter/xss/===
XssFilter.java[WAU5S]: F:XSS防护过滤器,排除multipart与白名单URL并拦截WEB-INF路径遍历 | R:XssHttpServletRequestWrapper.java | A:- | S:实现Filter,init加载excludes正则,doFilter包装请求为XssHttpServletRequestWrapper,WEB-INF返回404,正则匹配豁免
XssHttpServletRequestWrapper.java[WAU8PS]: F:XSS防护请求包装器,过滤参数/请求头/请求体中的XSS攻击内容 | R:XssFilter | A:- | S:HttpServletRequestWrapper包装,正则匹配script/iframe/eval/javascript等攻击模式,htmlEncode转义尖括号,重写getParameter/getHeader/getInputStream,POST体读取后重新封装InputStream

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/redis/===
CustomJedisPoolConfig.java[GCO5T]: F:自定义Jedis连接池配置,扩展JedisPoolConfig并依据RedisProperties设置连接池参数 | R:RedisProperties.java | A:- | S:继承jedis.JedisPoolConfig,setPoolConfig设置maxTotal/maxIdle/minIdle/maxWait及空闲检测/驱逐参数,启用JMX,日志输出全部配置
RedisConfig.java[GCO5CS]: F:Redis自定义序列化与缓存管理配置 | R:RedisConnectionFactory | A:- | S:RedisTemplate-String序列化key/value,CacheManager-TTL可配置默认180分钟,disableCachingNullValues,@Primary
RedisConfiguration.java[GCO5EM]: F:Redis连接工厂配置(单机/哨兵/集群三模式)+Session序列化+消息监听容器+密码RSA解密 | R:RedisProperties,CustomJedisPoolConfig,RsaDecrypt,BdpRuntimeException,I18nUtil | A:- | S:JedisConnectionFactory按cluster/sentinel/host优先级构建,连接池池化超时配置,encrypt时RSA解密密码,Jackson2JSON-Session序列化,sessionTimeout可配,ConfigureRedisAction.NO_OP禁keyspace通知
RedisProperties.java[GS1CT]: F:Redis连接池配置属性,映射spring.redis.pool.*前缀 | R:- | A:- | S:@ConfigurationProperties绑定,maxActive/maxIdle/minIdle/maxWait,testWhileIdle/OnBorrow,驱逐策略evictionInterval/minEvictableIdleTime

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/session/autoconfigure/===
SessionConfig.java[GAU5JS]: F:会话Cookie序列化配置,定制SESSION会话ID持久化策略 | R:DefaultCookieSerializer | A:- | S:@Configuration注入Cookie名/路径/域/maxAge/httpOnly/secure/sameSite/Base64编码,@Value外部化配置,自定义CookieSerializer Bean
SystemHttpSessionIdResolver.java[WTO8JM]: F:自定义Session ID解析器,同时支持Header与Cookie双模式解析会话标识 | R:CookieSerializer,TransmittableThreadLocal | A:- | S:实现HttpSessionIdResolver,优先读x-signature-sessionId头否则回退Cookie,TTL线程变量记录模式,setSessionId/expireSession按模式写头或Cookie,Base64解码与jvmRoute剥离

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/share/helper/===
ShareCacheUtil.java[UCM3CT]: F:从Redis读取共享的用户/组织/岗位/驻地缓存信息工具类 | R:RedisUtil,ShareBfmUser,UsersOrganization,UserStation,Organization | A:- | S:静态工具类,SHARE_前缀key按userId/userCode/orgId/stationId查询,fastJSON反序列化,用户编码二次映射userId

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/util/===
MultipartFileUtil.java[UF3T]: F:内存字节数组实现MultipartFile接口,支持从byte[]或InputStream构造虚拟上传文件 | R:MultipartFile,FileCopyUtils | A:- | S:实现getBytes/getInputStream/transferTo,构造时拷贝流为字节数组,空内容容错
OkHttpUtil.java[US3T]: F:OkHttp客户端封装,提供HTTP GET请求与超时配置 | R:okhttp3 | A:- | S:300秒超时,getHttpClient构建客户端,getRequest发GET,doRequest执行调用异常捕获

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/config/===
GatewayClientConfig.java[GGA5RT]: F:Gateway SDK 客户端配置,复用项目 Redis 参数初始化 RedisClient/WorkerRegistry/GatewayClient 三个 Bean | R:GatewayClient,RedisClient,WorkerRegistry | A:- | S:@Value 读取 spring.redis.host/port/database/username/password,空字符串转 null,@Bean 注入,日志记录初始化
GatewayDiscoveryConfiguration.java[GG7RL]: F:网关服务注册发现配置,集成SDK实现RedisClient/ServiceRegistry Bean化与服务自动注册注销 | R:RedisClient,ServiceRegistry,GatewayConfig | A:- | S:监听ServletWebServerInitializedEvent捕获动态端口,DevTools重启强制RedisClient.init重置连接池,ApplicationRunner启动注册带metadata,PreDestroy注销,gateway.discovery.host适配Docker/NAT
RedisSubscriberConfig.java[GSA9RT]: F:Redis Stream订阅配置占位类,不再创建全局监听容器,改为按需动态监听 | R:SessionStreamManager | A:- | S:空配置类,监听容器由SessionStreamManager在sendMessage成功后按session启动,Stream Key格式byai_gateway:session:{sessionId}:data_stream

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/database/===
ByaiConfiguration.java[SE5TG]: F:byai主数据源Druid连接池配置,声明Primary数据源 | R:AbstractDruidConfiguration,ByaiDruidProperties,AbstractDruidProperties | A:- | S:继承AbstractDruidConfiguration,@Conditional条件装配,dataSourceByai主数据源Bean,Druid连接池
ByaiDruidProperties.java[GDS5T]: F:byai数据源Druid连接池配置属性，支持JNDI/URL条件装配 | R:AbstractDruidProperties | A:- | S:绑定spring.datasource.byai前缀,实现Condition按url/type条件加载,jndi类型直通

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/agent/dto/===
AgentDto.java[DEMPS]: F:智能体数据传输对象,封装智能体id/名称/类型/简介/状态/插件数据集关联及发布元状态
SearchDto.java[D]: F:全局搜索结果聚合DTO,含数字员工/用户/会话列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/agent/enums/===
AgentMetaEnum.java[KEMP3S]: F:智能体元数据类型枚举,定义智能体/数字员工/各类知识库/工具集/MCP/视图/对象等25种元类型 | R:- | A:- | S:code-name映射,KG_DOC/KG_QA/KG_TERM/KG_DB三级知识库结构,Lombok-Getter
MessageRoleEnum.java[KCH3T]: F:消息角色枚举(user/assistant),编号转角色码 | R:BdpRuntimeException,I18nUtil | A:- | S:num→code映射,roleCode静态查找,未匹配抛国际化异常
MetaStatusEnum.java[KEMP5S]: F:数字员工元数据状态枚举(草稿/待上架/已上架/已下架) | R:- | A:- | S:DRAFT/TODO_UP/UP/DOWN/SECOND_UP五态,getUpStatusList返回上架态集合,ImmutableList
OrgFilterType.java[KOR1T]: F:组织过滤范围常量(全部/公司/部门/自定义) | R:- | A:- | S:final工具类,私有构造,ALL/COMPANY/DEPT/CUSTOM四常量
StatusFilterType.java[KEMP1S]: F:数字员工状态过滤类型常量(全部/被授权/已过审/审核中/可申请) | R:- | A:- | S:final工具类私有构造,5个String常量,数字员工三层授权状态枚举

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/agent/model/===
SearchTypeCheckResult.java[DEMP5T]: F:搜索类型校验结果模型,持有有效搜索类型与会话搜索类型列表
SsResource.java[EE5TM]: F:资源实体DO,智能体/文档库/插件/MCP/工具等多类型资源元数据载体,含外系统编码/版本/授权/分享范围/置顶等字段
SuasSuperassistSubAgent.java[EEM5M]: F:超级助手与子智能体关联实体(关注/订阅/置顶,含租户隔离com_acct_id)
SuasSuperassistSubAgentExample.java: F:数字员工子智能体表MyBatis动态查询条件生成类(@mbggenerated)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/agent/qo/===
AgentPromptQo.java[DEMP5S]: F:智能体提示词生成请求参数

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/agent/service/===
SsSuperassistSubAgentService.java[SE7CM]: F:超级助手子数字员工关注管理服务,处理关注/取消关注/置顶/取消置顶及默认数字员工查询 | R:SuasSuperassistSubAgentMapper,AgentResourceService,ByaiSystemConfigService,SequenceService,CurrentUserHolder,RedisUtil | A:- | S:focusAgent关注幂等校验,cancelFocus软删,isTopAgent批量置顶,getDefaultAgentIds读系统配置(慧笔/chatbi/鲸灵),clearAgentFocusCountCache用hashtag清Redis缓存,租户隔离按assistantId/enterpriseId

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/agent/vo/===
DigitEmployDirVo.java[DEMP5S]: F:数字员工目录VO,含目录id/名称/描述/父级id
AgentPromptVo.java: F:智能体提示词生成响应(含描述/人设/开场白/常见问题/追问推荐)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/application/dto/===
ApplyRequest.java[DEM5M]: F:数字员工申请请求DTO,含agentId/reason/approveUserId
ApprovalRequest.java: F:数字员工任务审批请求DTO(消息id/是否通过/备注)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/assitsant/service/impl/===
ResourcePrivilegeServiceImpl.java[SEM7PTL]: F:数字员工资源(知识库/数据库)三层授权服务,处理首次/二次配置的红黑名单权限授权与查询 | R:SuasSuperassistResourcePrivilegeMapper,ResourcePrivilegeService,SequenceService,PrivilegeGrantDto,AgentMetaEnum,CurrentUserHolder | A:- | S:INNER/OUTER授权类型,KNOWLEDGE_BASE/DATA_BASE资源映射,@Transactional事务批量增删,红黑名单过滤(RED-BLACK)取默认权限,suas表优先回退通用授权表,事务保存,助理ID隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/assitsant/service/===
ResourcePrivilegeService.java[SPE7BMT]: F:资源授权服务接口,助理资源权限保存与按用户/授权类型/资源类型查询 | R:ResourcePrivilegeServiceImpl,ResourcePrivilegeRequestDto,ResourcePrivilegeQueryResponseDto | A:- | S:saveResourcePrivilege新增改,getUserResourcePrivileges新表降级旧表默认权,批量多类型查询,内外授权与知识库文档库问答术语资源,多租户用户隔离
SsSuperAssistKwCatalogService.java[SKN5MS]: F:超级助手文档库关联目录服务,管理会话与知识库目录映射 | R:SsSuperassistKwCatalogMapper,SequenceService,CurrentUserHolder | A:- | S:按sessionType/sessionId/superassistId查目录,createSessionCatalog生成catalogId并注入租户企业ID,多租户隔离
SuperassistService.java[SEM7T]: F:超级助手(数字员工)信息查询服务,按ID或创建用户查找助理 | R:SuasSuperassist,SuasSuperassistMapper | A:- | S:MyBatisPlus,selectById获取助理,LambdaQueryWrapper按superassistId查创建用户助手取首条

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/assitsant/vo/===
FocusVo.java[DEMP5M]: F:数字员工关注请求参数VO,含agentId/appId/agentIdList
IsTopVo.java[DEM5T]: F:数字员工置顶设置请求参数(员工IDs/类型/置顶标志)
ResourcePrivilegeQueryResponseDto.java[DEMP1S]: F:资源权限查询响应DTO,含资源类型及资源列表内嵌结构
ResourcePrivilegeRequestDto.java[DEM7M]: F:助理资源授权请求DTO(内/外部授权类型、知识与数据资源ID列表)
ResourcePrivilegeQueryRequestDto.java: F:资源权限查询请求参数(授权类型/资源类型过滤)
ResourcePrivilegeResponseDto.java: F:资源权限查询响应DTO,含资源类型/资源列表/授权类型及内部资源信息类

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/auth/enums/===
MetaDataEnum.java[KEMPT]: F:智能体授权元数据类型枚举(智能体/文档库/数据库/插件/目录) | R:- | A:- | S:code-name映射,@Getter+@AllArgsConstructor,权限授权对象类型分类

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/callback/dto/===
CallbackRequest.java[DTAST]: F:任务回调请求参数,含会话/任务/消息/用户/项目ID及签名时间戳
CallbackResponse.java: F:任务回调响应DTO,含文件回调内嵌类及成功/失败/签名/重复等静态构造

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/dto/===
AgentCardDto.java[DCHA1S]: F:智能体卡片数据传输对象,含智能体ID/类型/名称/描述/参数/动态卡片标识/任务ID等字段
AgentDebugChatDto.java[DECMS]: F:数字员工调试会话请求参数,继承AssistantChatDto含数字员工信息
ApproveMessageContentDto.java[DA5M]: F:审批消息内容DTO,含审核人/申请人/智能体id/表单内容/审核状态
AssistantChatDto.java[DCH5M]: F:数字助理对话请求参数,含会话内容/文件/模型/任务操作/渠道扩展/资源/记忆等
CategorizedSearchResultDto.java[DCH1S]: F:分类搜索结果数据类,含上传日期与关联资源列表
ChatFunctionCloudQo.java[DB5M]: F:会话功能云配置查询对象(竞价系统/谷歌浏览器开关)
ContentVo.java[D7CHM]: F:会话消息内容对象,含内容类型与消息内容字段
CrowdDto.java[DCHDT]: F:人群对象引用DTO,含objectId与objectType
CustomFilenameMultipartFile.java[UFI3T]: F:自定义MultipartFile包装类,支持重写上传文件名 | R:MultipartFile | A:- | S:委托原始文件实现,仅覆写getOriginalFilename返回新文件名,实现Spring5.1+ transferTo(Path)
DocRetrieveDto.java[DKARS]: F:文档检索请求参数(查询/检索类型/数据集ID列表/返回数量)
ExternalMessageVo.java[DCHA5S]: F:外部消息对象VO,含会话ID/内容/智能体ID/消息ID/扩展参数
FeedbackTypeDto.java[DCH5M]: F:会话反馈类型数据传输对象,含参数名称/取值/编码
FileUploadDto.java[DFI5M]: F:文件上传配置数据类(开关/大小/数量/Word与PDF页数上限/允许类型)
FixedMemoryDelDto.java[DCH5M]: F:固定记忆删除入参,含资源组件ID
GenerateFixedMemoryDto.java[DCH5M]: F:生成固定记忆请求DTO,含会话ID与消息ID列表
GenerateFixedMemoryGroup.java[DCH5M]: F:固定记忆分组数据载体,封装输入消息/输出消息列表/消息关联对象
GroupChatCreateDto.java[DCH5T]: F:群聊创建结果DTO,封装会话信息与成员列表
MemoryDto.java[DD5JM]: F:会话记忆开关配置数据类,控制是否开启记忆功能
MessageFormContentDto.java[DCHA1S]: F:会话消息表单内容数据类(表单类型/字段编码/字段值/只读隐藏等)
MessageFormSubmitDto.java[DCH5FM]: F:消息表单提交参数,含消息id/插件id/工具id/字段内容
MessageTaskValidResultDto.java[DCH5M]: F:消息任务校验结果DTO,含任务对象与无效步骤列表
ModelInfoDto.java[DD5M]: F:模型信息传输对象(模型名/ID/历史轮数/温度/最大token)
PrologueDto.java[DD5M]: F:会话开场白配置数据类,含模型ID/模型信息/文件上传配置
RunningChatInfo.java[DCH5T]: F:运行中会话状态信息DTO,记录会话/追踪ID/消息ID/智能体/传输方式
RunningChatSnapshotRequest.java[DCH5M]: F:运行中会话快照请求参数,含会话ID/traceId/模型回答消息ID
RunningChatStatusRequest.java[DCH5M]: F:运行中会话状态查询请求,含会话ID列表
StopChatDto.java[DACGS]: F:停止会话请求参数(含agentId/sessionId/messageId/clientRequestId)
SuggestionQuestionVo.java[DCH5M]: F:推荐问题响应VO,含入参问题与相关问题列表
TaskValidationContext.java[DT C1 T]: F:任务验证上下文,存储验证过程子步骤、步骤顺序、可用文件集合
UserSpaceDto.java[DCHA5M]: F:用户空间数据传输对象,含前缀与资源ID
AppendEventMsgDto.java: F:追加事件消息DTO,含用户/会话/消息ID与内容作者
ByaiAimodel.java: F:AI模型配置数据类(模型类型/地址/鉴权令牌/上下文长度/深思与图表支持/入参配置)
ChatDataCloudQo.java: F:会话数据云能力开关参数(摘要/联网/内部知识库/个人信息/鲸家业务/订阅数字员工/浏览器页面)
MdGenerationResult.java: F:MD文件生成结果数据类(路径/内容/成功标志/错误信息)
MessageSearchDto.java: F:会话消息搜索结果DTO,含会话名/ID/类型/内容及命中消息列表
MessageTaskDto.java: F:长程任务消息DTO，含任务描述/步骤/子步骤/工具元数据嵌套结构
RunningChatSnapshotResponse.java: F:运行中会话快照响应,含运行状态/traceId/流ID/模型回答消息ID
TaskFileDto.java: F:任务文件信息数据传输对象

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/enums/===
ChatRelatedResourceTypeEnum.java[KCH1T]: F:会话关联资源类型枚举(知识库/联网检索/智能助手) | R:- | A:- | S:code-msg二元枚举,Lombok @Getter
ChatTransport.java[KCH3WT]: F:会话传输方式枚举(HTTP_SSE/WebSocket) | R:- | A:- | S:定义聊天通道传输类型,SSE与WS二态
ChatUseageEnum.java[KCH3S]: F:会话消息用途枚举(用户输入/系统回答/追问/转发/群通知) | R:- | A:- | S:code+name映射,getName按code查名称
MessageIdTypeEnum.java[KCH3M]: F:消息ID类型枚举,区分提问(ask)与回复(res) | R:- | A:- | S:Getter+AllArgsConstructor,code/desc字段
MessageType.java[KKC1T]: F:WebSocket消息类型枚举,定义LLM消息/心跳/SSE流/通知/停止会话/生态桥接/错误七种类型 | R:- | A:- | S:state会话域消息类型枚举,ECOSYSTEM_BRIDGE用于Browser-Bridge长连接通道

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/model/===
AssistantDto.java[DCETS]: F:数字员工助手信息传输对象,含用户信息与知识库数据集列表
ByaiAiModelDto.java[DM5M]: F:AI模型基础信息数据传输对象(模型ID与名称)
ByaiAimodelExample.java[D]: F:AI模型表MyBatis动态查询条件构造器(@mbggenerated)
ByaiAimodel.java[EMOD5S]: F:AI模型配置实体,含模型类型/URL/鉴权令牌/最大上下文token/深度思考与图表支持标识/入参配置
ChatInitializationDto.java[DCHAT5S]: F:会话初始化数据传输对象,含消息ID/追踪ID/会话ID/元数据
ErrorReponse.java[DCH5S]: F:会话错误响应模型,封装状态码/错误码/堆栈等错误信息
MessageContext.java[SEC5CL]: F:聊天消息上下文模型,聚合流式回答/推理过程/答案文本及增量结构化拼接 | R:AnswerDelta,CompletionsUtils,ChatRelatedResource,MessageFileDto,AgentTypeEnum | A:- | S:StringBuilder累积answerText/streamAnswerText,recordStruct按contentType+orderId增量合并,JSONObject解析AnswerDelta,群聊双流(stream前缀),消息骨架模板messageStructTemplate,ES存储字段标注
MessageFileDto.java[DCHAT5S]: F:会话消息文件数据类(知识库id/文件来源类型/用途/文件元信息)
MessageResourceDto.java[DCH5M]: F:消息资源聚合DTO,含上传文件/引用来源/扩展参数/用户@资源
ResultSpace.java[DCH5FS]: F:成果空间模型存储会话MD内容与任务文件列表 | R:TaskFileDto | A:- | S:mdContent/mdFilePath/taskFileList,Lombok@Data
ChatRelatedResource.java: F:会话关联资源模型(知识库/联网检索来源)
ChatResponse.java: F:会话回答响应数据类(消息ID/会话ID/关联资源/推荐问题/成果空间)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/service/===
AbstractChatProcess.java[SCH9WTM]: F:聊天主流程抽象骨架(模板方法模式),定义参数准备/Gateway模式/Python SSE/消息存储/异常处理步骤链 | R:ChatProcessContext,AssistantChatDto,ScriptService | A:- | S:execute编排prepareParams→handleGatewayMode→storeMessage→afterProcess,SSE流式输出,asyncResponse短路,首词响应耗时埋点,Gateway模式阻塞等Redis监听完成
AssistantChatService.java[SCH9WSM]: F:智能体对话编排核心服务,SSE/WS流式响应+会话创建+群成员权限校验+固化记忆任务+默认超助路由识别 | R:ScriptService,SessionService,MemoryMessageService,MenTaskService,SuasSuperassistApplicationService,SsResourceService,SessionMemberService,CompletionsUtils via redis:gateway监听 | A:- | S:WithSpan链路追踪,Gateway阻塞等Redis,固化记忆建任务/卡片,resourceCode尾main识别默认超助清agentId,租户/用户隔离,ServletOutputStream条件关流避免误关WS
ChatProcessContext.java[SED5WM]: F:聊天主流程上下文对象,在各步骤间传递共享请求参数/消息对象/会话信息/计时/token统计/Gateway事件队列等 | R:AssistantChatDto,ByaiMessageHotDtoDto,MessageContext,ChatResponse,ChatTransport,SuggestionQuestionVo,LoginInfo | A:- | S:SSE输出流,Gateway模式BlockingQueue事件消费,Redis运行态token,WS多端广播senderChannel,首词响应计时,多租户userId隔离
ChatStreamRuntimeCoordinator.java[SS5RWS]: F:会话流运行态协调,准备/启停Redis Stream监听与运行标记 | R:OutputStreamManager,SessionStreamManager,RunningOutputStreamRegistry,ChatProcessContext,RunningChatInfo | A:- | S:startIfNecessary幂等判断会话是否已运行,HTTP-SSE建队列WS异步推送,缓存上下文启XREAD监听器标记running,stopIfStarted停监听
CronService.java[ST7AM]: F:定时任务变更事件分发,完成时创建站内通知并推送钉钉主动消息 | R:OpenApiApplicationService,DingtalkProactiveMessageService,NoticeDetail,Notices | A:- | S:cron_changed事件判定,解析data.action=finished,标题200/内容2000截断,高优先级通知,钉钉文本推送容错
GatewayStreamEventProcessor.java[SAW9WL]: F:网关流式SSE事件处理器,识别历史traceId事件并按批次累积入库,规范化事件类型/构建事件数据payload | R:PythonSseService,ScriptService,ByaiMessageHotService,SequenceService,TraceIdCodec,MessageContext,ChatProcessContext,SseResponseEventEnum | A:- | S:ConcurrentHashMap管理historyBatchMap,trace_id解码区分当前/历史,answerDelta跨agent转reasoningLogDelta,error/appStreamResponse触发批次入库,resolveMemory重放历史记忆,CurrentUserHolder登录态切换,UPDATE/RERUN/FEEDBACK判定更新已有消息
MessageFactory.java[SCB8M]: F:聊天消息工厂,构建提问/响应消息与消息索引DTO并持久化,管理任务状态更新与首词响应时长统计 | R:ByaiMessageHotService,ByaiMessageRelObjService,ByaiSystemConfigService,ChatProcessContext,CurrentUserHolder,RequestContextUtil,AnswerDelta | A:- | S:generateAskMessage构提问消息,buildMessageIndexDto建索引含token统计,saveMessageIndex按agentIds批量落库,updateMessageContentState改messageStruct的JSON状态,getTaskId取REQUEST_ID兼容HTTP/WS,多租户comAcctId隔离
OutputStreamManager.java[SSW8WM]: F:聊天流式输出连接管理器,在chat请求与Redis监听间共享OutputStream连接及ChatProcessContext上下文 | R:ChatProcessContext | A:- | S:双ConcurrentHashMap缓存,outputStreamMap按userCode:sessionId存流,contextMap按sessionId存上下文供异步Gateway模式延迟storeMessage/afterProcess,put/get/remove/containsKey操作
ParamService.java[SE9PML]: F:聊天请求Python参数拼接核心:组装数字员工资源列表/技能过滤/权限校验/Python环境变量/历史消息 | R:SsSuperassistSubAgentService,ResourceAuthContextService,AgentResourceService,SsResourceService,ByaiMessageHotService,AiModelService,CommonHandler,ChatProcessContext | A:- | S:getParams组装agent_list,正则提取{{}}选中资源按类型过滤(AGENT/KG_DB/KG_DOC/TOOLKIT/MCP),filterUnAuthAgentResources按AuthContextBo隔离越权资源,getPythonEnv注入LLM/Reranker/Langfuse/Docchain环境变量,filterHeader保留认证头,getChatHistories转外部智能体[role,content]并前置文件markdown
PythonSseService.java[SE9WCM]: F:Python算法SSE流式响应核心处理服务,解析增量事件并写客户端,落库消息/子任务/资源卡片 | R:PythonWebService,MenTaskService,MenResComService,MemoryMessageService,CompletionsUtils,MessageContext,AnswerDelta,SseResponseEventEnum,PythonRuntimeException | A:- | S:逐行读BufferedReader分发answerDelta/reasoningLog/taskCreate/stepComplete/tokenCount等事件,首词计时,数字员工执行sessionId改写,关联资源/推荐问题提取,2008/2010/2011/3013卡片存资源表,父子任务状态联动更新步骤图标
RunningChatSnapshotService.java[SCH5CM]: F:运行中会话快照Redis存取(保存/获取/续期/删除/按messageId定位/写回),供SSE断连重连恢复 | R:RunningChatSnapshotResponse,MessageContext,ChatProcessContext,ChatUseageEnum,MsgStatus,RedisTemplate | A:- | S:KEY前缀byai:chat:running:snapshot:,TTL30分钟,key=session:traceId或messageId,JSON序列化,keys模式扫描兜底,getExpire保留TTL写回,buildSnapshot聚合答复文本/结构/推理日志/关联资源<br>
RunningOutputStreamRegistry.java[SAH9CM]: F:会话运行中OutputStream标记注册表,基于Redis管理流式输出运行态(标记/续期/释放/查询) | R:ChatProcessContext,RunningChatInfo,RedisTemplate | A:- | S:byai:chat:running前缀键,30分钟TTL,token+instanceId归属校验owner,modelAnswerMessageId匹配释放,JSON序列化存运行态,批量查询会话运行状态
ScriptService.java[SS9WTL]: F:聊天主流程模板实现,编排参数准备/Python或Gateway SSE推流/消息落库/异常补偿/会话成员与知识库使用计数 | R:AbstractChatProcess,PythonSseService,RouteService,MessageFactory,MemoryMessageService,MenTaskService,SessionMemberService,MultiDeviceBroadcastService,RunningOutputStreamRegistry,SessionStreamManager,SequenceService | A:- | S:继承模板方法,running trace复用traceId防并发,WS多端广播userMessage/init/appStreamResponse,REQUIRES_NEW独立事务异常落库,TraceIdCodec编解码,任务UPDATE/RERUN/EXECUTE分支,addMenTask建父任务
SessionEventStreamListener.java[LCH9RM]: F:常驻消费后台会话事件Redis Stream并路由分发,不依赖session运行状态 | R:SessionStreamEventRouter,SessionStreamManager,RedisTemplate via redis:byai_gateway:session_event:data_stream | A:- | S:StreamMessageListenerContainer消费者组,setIfAbsent幂等去重(7天TTL),启动时ensureStreamExists+createGroup,失败releaseDedup保留pending,ack确认,主机名+UUID消费者名
SessionStreamEventRouter.java[SEW9RWM]: F:会话流事件路由器,Redis Stream统一入口分发SSE/WS事件并处理后台cron会话answer消息入库与多端推送 | R:OutputStreamManager,PythonSseService,GatewayStreamEventProcessor,MultiDeviceBroadcastService,RunningChatSnapshotService,ScriptService,CronService,MemoryMessageService,SessionService,SequenceService | A:- | S:dispatch按transport分流HTTP队列/WS通道,routeWebSocketEvent归一化事件类型与error处理,后台answer构造AnswerDelta并临时切换LoginInfo落库,broadcastRawEvent多端广播
SessionStreamManager.java[SBR9RM]: F:Gateway模式下按session动态管理Redis Stream监听容器,启动/停止专属监听器并维护running标记续租 | R:RedisStreamMessageListener,ChatProcessContext,OutputStreamManager,RunningOutputStreamRegistry,RunningChatSnapshotService via redis:byai_gateway:session:{id}:data_stream | A:- | S:每session独立StreamMessageListenerContainer+prototype监听器,复用全局消费者组CONSUMER_GROUP消费者名带sessionId,MKSTREAM自动建组,60s定时touch续租,ContextClosedEvent关闭清理全部容器
TargetAgentTypeResolver.java[SCH7S]: F:解析聊天链路最终targetAgentType,处理DEBUG/resume/用户沙箱隔离 | R:WorkerAgentType | A:- | S:DEBUG拼agentId,BYCLAW_EXE/CODE按userCode隔离构建用户级AgentType,resume透传优先
TokenStats.java[DCHAT5T]: F:Token统计信息数据类,记录输入/输出token总数及每秒输出速率 | R:- | A:- | S:lombok Getter/Setter,Float字段inputTokenCount/outputTokenCount/outputTokenPerSecond
TraceIdCodec.java[USE5ES]: F:将用户消息ID与模型回答ID用AES编码为Langfuse兼容的32位十六进制traceId并支持解码/旧格式兼容 | R:- | A:- | S:AES/ECB/NoPadding固定密钥,ByteBuffer双long编码,正则区分legacy(数字_数字)与hex格式,toHex/fromHex转换,canDecode容错,内部TraceMessageIds值对象

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/vo/===
UserSpaceVo.java[DCh7S]: F:用户空间文件项VO,含名称/路径/是否目录

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/filebrowser/dto/===
FileBrowserDeleteRequest.java[DFE5S]: F:文件浏览器删除请求DTO,含资源ID与待删除路径列表
FileBrowserListRequest.java[DFI5M]: F:文件列表/创建文件夹请求DTO,含资源ID与目录相对路径
FileBrowserRenameRequest.java[DFI5S]: F:文件浏览器重命名请求DTO,含资源ID、源路径、新名称
FileBrowserSearchRequest.java[DFI5M]: F:文件浏览器搜索请求DTO,含资源ID、起始路径、搜索关键词
FileBrowserMoveRequest.java: F:文件浏览器移动操作请求体(资源ID+源路径列表+目标目录)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/filebrowser/vo/===
FileBrowserItemVo.java[DFI5S]: F:文件浏览器列表项VO,含名称/路径/是否文件夹/大小/修改时间

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/file/service/===
ConversationFileStorage.java[SF7OS]: F:会话文件存储能力门面,封装会话文件读写追加按行读取列表查询 | R:UserFS,StorageLocation,StoragePrefix,MultipartFileUtil,OpenApiConversationApplicationService | A:- | S:经UserFS落用户空间byclaw-{userCode},writeText/writeBytes/appendText/streamTextByLines按行流式输出,readWholeTextIfExists容错,listObjectKeys按前缀列举,/by根路径转换由UserFS处理
ConversationStoragePathResolver.java[SS5MS]: F:解析会话文件逻辑存储路径,与存储后端无关,按用户分桶隔离 | R:UserBucketNamingService,StorageLocation,StoragePrefix | A:- | S:会话namespace,session对象前缀/.sessions,用户桶命名,路径规范化防..穿越,去前导斜杠,多租户数随人走
DocumentPageCountException.java[HFI3T]: F:文档页数检查自定义异常 | R:- | A:- | S:继承Exception,双构造函数,serialVersionUID
DocumentPageCountService.java[SF5T]: F:文档页数检查服务接口,校验上传文档页数是否超限 | R:DocumentPageCountException,PageCountResult | A:- | S:checkPageCount校验页数,getPageCount取页数,supports按contentType判类型,流不关闭
FileService.java[SF7OS]: F:文件域服务,处理文件保存与下载(MinIO流式),含上传/标签查询/批量打标签等知识API占位 | R:FilesMapper,FilesApplicationService,OpenFileDownloadDTO,KnowledgeResponse,Files | A:- | S:downloadFiles解析fileUrl的bucketName/filePath参数,openCommonFileInputStream获取MinIO流,构造Feign Response附Content-Disposition附件头URLEncoder编码文件名
PageCountResult.java: F:文档页数检查结果封装(通过/实际页数/最大页数及i18n消息)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/file/service/impl/===
DocumentPageCountServiceImpl.java[SFI5L]: F:文档页数检查服务,流式处理PDF/DOC/DOCX页数统计 | R:DocumentPageCountService,PageCountResult,DocumentPageCountException,I18nUtil | A:- | S:PDFBox临时文件加载PDF,ZipInputStream+StAX解析docx的app.xml元数据(防XXE),HWPF读DOC的SummaryInformation页数否则按2000字符估算,BufferedInputStream mark/reset不关流

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/fs/dto/===
FsFileDeleteRequest.java[AFC1S]: F:文件系统删除文件请求体,含空间类型/资源ID/路径
FsRenameRequest.java[DFI5S]: F:文件/目录重命名请求参数,含空间类型、资源ID、原新路径与覆盖标志
FsDirectoryRequest.java: F:文件系统目录操作请求参数(空间类型/资源ID/路径/递归删除标志)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/fs/enums/===
FsSpaceType.java[KFI3MT]: F:FS操作目标空间枚举(USER用户私有/RESOURCE平台资源) | R:I18nUtil | A:- | S:of字符串忽略大小写解析,非法值抛IllegalArgumentException带i18n消息,RESOURCE需resourceId权限校验

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/fs/vo/===
FsDirectoryRenameFailedItemVo.java[DH5FT]: F:文件目录重命名失败项VO,记录源/目标路径、失败阶段(COPY/DELETE)及错误原因
FsDirectoryRenameResultVo.java[F]: F:目录重命名结果VO,含复制/删除/失败统计与失败明细
FsDeleteResultVo.java: F:文件空间删除/建目录操作结果VO,含空间类型、资源ID、路径、删除/创建状态及影响对象数
FsFileMetadataVo.java: F:文件元数据VO(空间类型/路径/大小/MIME/MD5校验/桶名/存储类型)
FsRenameResultVo.java: F:文件重命名/移动结果VO,含空间类型、新旧路径、是否移动/覆盖

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/index/service/===
IndexService.java[SEP5MM]: F:数字员工首页索引查询服务,聚合授权员工/常用/最近新增/我创建/发现页/资源用户/授权文档与技能查询 | R:IndexMapper,PageHelperUtil,ListUtil | A:- | S:权限红黑名单过滤,顶级组织查询,授权对象按grantObjId聚合成map,分页查询授权文档,多租户隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/langfuse/service/===
LangfuseService.java[SAE9FL]: F:Langfuse链路追踪服务,查询traces/observations并构建会话流程时间线,Langfuse不可用时从本地消息记录回退构建trace | R:ByaiMessageHotService,OkHttpUtil,ApplicationContextUtil,LangfuseQueryDto,MessageQo,ByaiMessageHotDto,MapParamUtil | A:- | S:OkHttp+BasicAuth调Langfuse REST,observations三级endpoint降级(标准/路径/v1),一问一答配对usage=1/2构建trace,observations父子层级递归排序,会话统计成功率/延迟,毫秒与ISO时间互转

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/log/service/===
ManageLogService.java[SA05S]: F:管理操作日志保存服务,生成雪花ID并入库 | R:ManageLog,ManageLogMapper,SequenceService | A:- | S:nextSnowId生成logId,mapper.insert持久化
TrackLogService.java[SA5T]: F:日志埋点保存服务 | R:TrackLogMapper,TrackLog | A:- | S:saveTrackLog插入埋点日志,委托Mapper.insert

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/men/enums/===
MenTaskStatusEnum.java[KTAS5T]: F:长程任务状态枚举(已提交/进行中/待输入/完成/取消/失败/拒绝/待授权/未知) | R:- | A:- | S:code+desc双字段,fromName/fromCode/isValid查找,toUpperCase匹配
SystemCodeEnum.java[KEM1T]: F:来源系统编码枚举 | R:- | A:- | S:BYAI百应/BOT博特/WHALE+鲸+/UIAGENT界面智能体/SANDBOX沙箱,code+desc
TaskTypeEnum.java[KTA3T]: F:任务类型枚举(审批/用户协助输入/授权/固化记忆模板) | R:- | A:- | S:code-desc双字段,APPROVE/INPUT/AUTHORI/FIXMEMORY四类长程任务交互类型

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/men/service/===
MenResComService.java[SSE5MS]: F:资源组件(ResCom)CRUD服务,管理任务关联的资源组件及父子组件查询 | R:MenResComMapper,SequenceService,CurrentUserHolder,MenResCom,MenTaskVo | A:- | S:序列生成resComId,租户隔离comAcctId+createBy,批量按ID查询,getParentResComBySubTaskExtId查父组件
MenTaskService.java[ST7TMM]: F:待办任务全生命周期管理(增删改查/分页/子父任务联动/会话创建) | R:MenTaskMapper,MenTaskRecObjMapper,MenResComMapper,SessionService,MenTaskStatusLogService,NotificationService,SequenceService,RedisUtil,CurrentUserHolder | A:- | S:多租户隔离(comAcctId/enterpriseId),父子任务状态级联完成,Redis分布式锁防并发建会话,状态枚举映射,事务保障,h_as单聊群成员构建,状态变更写日志
MenTaskStatusLogService.java[SA7MT]: F:待办任务状态变更日志服务,记录任务状态新旧值变更并支持按任务ID删除 | R:MenTaskStatusLogMapper,SequenceService,CurrentUserHolder,MenTask,MenTaskStatusLog | A:- | S:insert记录新旧状态/变更描述,序列生成主键,带租户comAcctId与createBy隔离,deleteByTaskId级联清理

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/message/dto/===
ByaiMessageHotDtoDto.java[DC5M]: F:消息热点扩展DTO,含业务对象/收藏/提及用户等字段

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/message/enums/===
FeedbackField.java[KCH3T]: F:消息反馈字段枚举 | R:- | A:- | S:定义反馈类型/内容/评分/标记/标签字段名,提供全字段及点踩字段名列表
FeedbackTypeEnum.java[KCHA1T]: F:消息反馈类型枚举(答案不准确/找错人/其他) | R:- | A:- | S:type字段,getName按type忽略大小写匹配
MsgStatus.java[KECHAT8S]: F:消息状态枚举(结束/追加模式) | R:- | A:- | S:FINISH=0,APPEND=1,lombok枚举
PraiseAndTreadEnum.java[KCH1T]: F:消息点赞/点踩行为枚举 | R:- | A:- | S:praise/tread/none三态,getName按type匹配忽略大小写

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/message/model/===
ForwardMessageDtoDto.java[DCH3M]: F:转发消息DTO,含转发消息热数据列表
GroupChatVo.java[DCH3M]: F:群聊消息输入VO,含会话ID/输入内容/艾特名单/附件/任务关联
MessageFeedbackDto.java[DCHTS]: F:消息反馈(点赞/点踩)请求参数
SessionOpeartorDto.java[DCH1T]: F:会话消息操作请求参数(点赞/点踩/反馈)
FeedbackDto.java: F:会话消息反馈数据传输对象
GroupChatResponse.java: F:群聊响应数据类(会话ID/消息ID)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/message/qo/===
MessageQo.java[D8CMS]: F:消息查询参数,会话ID与topK条数

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/message/service/===
MemoryMessageService.java[SCH8WTM]: F:记忆引擎消息持久化与Kafka流式SSE消费(保存/更新/追加消息,从Kafka按sessionId分区消费并以SSE推送,消息计数定位) | R:ByaiMessageHotService,MessageFactory,ByaiSystemConfigService,ChatProcessContext,MessageContext,CompletionsUtils,CurrentUserHolder | A:- | S:KafkaConsumer手动assign+seek按session_hash分区,PipedInputStream异步守护线程SSE,重跑/更新过滤AnswerDelta,ES查询总数与1-based位置,FeignException转MemoryRuntimeException
MessageShareService.java[SE7PTL]: F:消息分享链接领域服务,创建多消息分享链接并校验访问权限(状态/过期/次数/认证) | R:MessageShareLinkMapper,MessageShareLinkMessageMapper,SequenceService,SessionFilter,JwtTokenFilter,SsoTokenFilter,MessageService,CurrentUserHolder | A:- | S:Base64-UUID生成token,雪花ID,批量insert关联表,三过滤器链认证(session/jwt/sso)写401,@Transactional,租户comAcctId隔离,访问计数自增
``

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/mode/service/===
ModeService.java[SCE5M]: F:模式与数字员工关联领域服务,查询模式列表及其关联员工 | R:ByaiModeMapper,ModeDto,ModeRelationDto,ByaiMode | A:- | S:selectList查模式,selectRelationByModeCode查search_query关联,BeanUtils拷贝组装ModeDto

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/monitor/mapper/service/===
MonitorTargetService.java[SE5TT]: F:监控目标服务查询质量等级低于阈值的数字员工 | R:MonitorTargetMapper,Constants | A:- | S:封装selectLtTargetQuality,按DIGITAL_EMPLOYEE类型+质量阈值过滤返回员工id列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/notification/service/===
NotificationService.java[SCH8WM]: F:通知服务,保存通知/创建通知会话/发送与更新通知消息/WS实时通知推送/批量已读 | R:ByaiNotificationMapper,SessionService,MemoryMessageService,MessageService,SandboxService,ByaiMessageHotService,RedisUtil | A:- | S:一人一通知会话,Redis标识USER_NOTIFICATION_前缀有新消息,Netty WS推送,沙箱心跳保持,SYSTEM_RESPONSE消息,企业租户隔离

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/resource/bo/===
AuthContextBo.java[EAP5PM]: F:授权上下文BO,封装用户授权资源ID集合与按类型分组映射,提供按资源类型取授权ID及鉴权判断 | R:ListUtil | A:- | S:allAuthResourceIds(Set)+allAuthResourceTypeMap(类型→ID列表),getAuthResourceIds可变类型聚合,isAuthResourceId包含校验

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/resource/converter/===
AbsConverter.java[SE5FT]: F:PDF文件转换策略(直通返回原字节流) | R:FileConverterStrategy.java | A:- | S:实现supports匹配pdf类型,convertToPdf直接返回原流,@Component注册
FileConverterContext.java[SFL5S]: F:文件转PDF策略上下文,按文件后缀选择对应转换策略 | R:FileConverterStrategy,I18nUtil | A:- | S:策略模式,注入策略列表,提取后缀名匹配supports,无匹配抛异常
FileConverterStrategy.java[ES5FT]: F:文件转PDF策略接口,按文件类型转换字节流为PDF | R:- | A:- | S:supports判定文件类型,convertToPdf转换字节流,策略模式
WordToPdfConverter.java[US5TM]: F:Word(doc/docx/rtf)转PDF转换策略,保留字体/对齐/表格格式 | R:FileConverterStrategy,I18nUtil,Apache-POI,OpenPDF | A:- | S:实现FileConverterStrategy,支持7种Word类型,XWPF优先回退HWPF,STSong中文字体缓存,段落对齐/粗斜体/字号映射,表格转PdfPTable,DOC表格简化处理

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/resource/dto/===
AgtResource.java[ETOB5S]: F:智能体资源实体(资源名/类型/对象ID/目录/状态/项目/图标),Long序列化为String
CurlImportRequest.java[DTO5TT]: F:curl命令导入请求DTO,含外键id与原始curl字符串
ObjectZipImportItem.java[DG7M]: F:单个资源包条目导入结果数据类
ObjectZipImportResult.java[DOB5S]: F:对象压缩包导入结果DTO，含总数/成功/失败/新建/更新统计及明细列表
ParamField.java[DCORE5M]: F:参数描述结构,用于前端交互展示和用户补全,支持嵌套子字段
ParsedObjectOwl.java[OBJ5T]: F:OWL业务对象解析结果数据类,含资源编码/名称/版本及字段列表
ParsedViewField.java[DV5M]: F:OWL视图字段定义数据类,含属性编码/名称及来源对象列映射
ParsedViewFieldRef.java[DVI5M]: F:视图定义节点中的field字段引用DTO
ResourceCurlGenerateRequest.java[DTOR5M]: F:资源curl生成请求体,含资源ID
ResourceCurlGenerateResult.java[DI5TM]: F:资源curl脚本生成结果数据类(curl/来源RULE-LLM/说明)
ResourceCurlRunResult.java[DTOR5T]: F:资源curl运行结果(成功标志/状态码/响应头体/耗时/错误)
ResourceImportDiffItem.java[DCORE5T]: F:资源导入更新差异明细,结构化返回更新前后字段对比给前端
ResourceVo.java[DAC1T]: F:资源信息VO(资源ID/名称/类型/编码)
SsResource.java[DTOB5M]: F:统一资源数据模型(智能体/文档库/插件/数据库/MCP/工具),含外系统编码、资源类型、版本、归属组织企业与分享范围
CurlParseResult.java: F:curl解析预览结果DTO,工具名/方法/URL/各类参数列表
ParsedObjectField.java: F:OWL对象字段定义数据类,含属性编码/名称/数据类型/来源表列/数据源等
**ParsedObjectField.java**: F:OWL对象字段定义数据类,含属性编码/名称/数据类型/来源表列/术语等
ParsedViewOwl.java: F:OWL业务视图解析结果数据类,含资源码/名称/对象码列表/字段引用
ResourceCurlRunRequest.java: F:资源curl运行请求参数(resourceId+curl脚本内容)
ResourceRegistrationTarget.java: F:资源服务注册目标DTO,封装网关发现中心注册结构(服务名/URL/主机/端口/路径/元数据)
ToolSaveRequest.java: F:工具保存请求DTO,用户补全描述后保存HTTP工具配置(含body/query/path/header参数)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/resource/qo/===
DatasetQo.java[DD5KM]: F:数据集查询对象,继承QueryObject带创建人过滤
DeleteResourceQo.java[DD5M]: F:资源删除入参QO,含资源ID/编码/所有者类型/强制删除标志
DownloadSkillZipQo.java[DAS5S]: F:Skill压缩包下载入参,含skillPath/resourceId/userCode
OpenApiDigEmployeeQueryQo.java[DEMP5M]: F:数字员工OpenAPI免登录查询入参(类型/名称模糊)
UpdateResourceBasicInfoQo.java[DCORE5M]: F:通用资源基础信息更新入参(资源ID/名称/描述/目录ID)
DeleteSkillQo.java: F:删除skill入参(skill路径/资源ID/用户编码)
OpenApiDigEmployeeSkillQo.java: F:数字员工技能查询QO(OpenAPI免登录),含数字员工ID与技能类型(可空)
PersonalAgentArchiveQo.java: F:个人agent的tar.gz档案查询入参
ResourceDetailQo.java: F:资源详情查询参数,含资源ID与资源编码

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/resource/service/===
DefaultResourceJsonConnectivityValidationService.java[SS5VL]: F:资源JSON写入MinIO前的轻量连通性强校验,按资源类型(KG/工具集/MCP/Agent)执行真实接口调用闭环验证 | R:ResourceCurlService,SsResExtMcpService,ResourceJsonConnectivityValidationService,ResourceJsonValidationContext,ResourceCurlRunResult,ResourceBizType,I18nUtil | A:- | S:知识库create_kb真实调用+finally清理delete_kb,工具集选读查语义接口,MCP listTools+callTool,Agent健康检查跳过BYCLAW_CODE,fail-fast可配置失败阻断或warn放行,OpenAPI解析回填domainURL,多字段别名兼容老格式
ObjectOwlImportParser.java[SO5M]: F:对象OWL(RDF/XML)导入解析器,提取实体定义与字段元数据 | R:ParsedObjectOwl, ParsedObjectField | A:- | S:DOM安全解析(禁DTD/外部实体),xmlns重复声明兜底去重,EntityDefinition/EntityField节点定位,字段引用按resource映射,getChildText忽略命名空间取值,可复用于视图
ResManagementService.java[SOB5KS]: F:资源管理服务,分页查询资源列表 | R:SsResourceMapper,ResourcePageDto,ResourceQueryRequest,KnowledgeResponse | A:- | S:MyBatis-Plus分页Page,封装list/total/pageNum/pageSize/pages到Map,KnowledgeResponse.success返回
ResourceApplicationService.java[SEM7AM]: F:资源应用服务,会话文件上传/标签检索、目录递归删除与层级标签生成、数字员工OpenAPI免登录列表/详情/技能查询、沙箱资源端点替换 | R:FileService,SandboxService,SsResourceService,SsResExtDigEmployeeService,SsResourceRelDetailService,ResManagementService,SessionService,ByaiSystemConfigService,MenTaskCatalogMapper | A:- | S:buildUploadTags构造US_/SE_/TA_/TC层级标签,appendFilenameTags批量加FN_标签,searchFilesByTags按标签匹配,deleteCatalogRecursively递归删目录,generateCatalogLevelTags计算层级,CurrentUserHolder用户隔离,debug模式跳过用户标签
ResourceArtifactPathResolver.java[UFI5OM]: F:资源产物存储路径解析器,统一资源JSON与bundle在FTP/MinIO的目录命名与根路径展开 | R:state/domain/resource/service | A:- | S:KG_前缀映射doc目录,resource根前缀,buildMinioResourceObjectKey拼对象key,normalizeRelativePath防路径穿越,ftp/minio双存储形态适配
ResourceArtifactStorageService.java[SF5OM]: F:资源产物统一存储门面,封装ResourceFS对开放资源目录的增删改查与目录上传 | R:ResourceFS,ResourceArtifactPathResolver,MultipartFileUtil,BaseException | A:- | S:syncResourceJsonByBizType按业务类型发布JSON,目录递归walk上传过滤MAC元数据,rename先copy后delete兼容文件与前缀目录,existsExactPath精确匹配,RESOURCE_ROOT=/resource,存储三态由ResourceFS适配
ResourceAuthContextService.java[SPE5PM]: F:资源权限上下文统一服务,按当前用户身份查询授权资源ID集合及按业务类型归类映射 | R:ResourceAuthContextMapper,CurrentUserHolder,AuthContextQo,AuthContextBo,AuthResourceType,UsersOrganization | A:- | S:从CurrentUserHolder填充用户/组织/岗位/平台管理员上下文,Mapper查授权资源,组织管理员按pathCode过滤,getAuthContextBo聚合全量Set与类型Map,getAuthResourceIds按bizType查列表,多租户用户隔离
ResourceCurlService.java[ASE7FL]: F:工具/MCP/Agent/知识库资源curl命令生成与执行,含规则/大模型双路生成、OpenAPI解析、连通性校验与shell注入防护 | R:CurlParser,JwtService,AIService,SsResourceService,SsResExtToolKitService,SsResExtMcpService,SsResExtAgentService,CurrentUserHolder | A:- | S:OkHttpClient执行,FastJSON解析OpenAPI/resourceService,Feign调manager资源服务,target-host白名单校验,shell控制符黑名单,读写操作关键词识别优先选只读接口,${HOST}模板占位解析,LLM兜底生成curl并清洗think标签
**注**: C维度按真实token预算应为高频核心(state包智能体核心+535行),标签数字位取7(业务);实际为大型工具脚本服务,故标L(>400行)。
ResourceDiscoveryRegistrationService.java[SSR5ALL]: F:资源级服务发现注册/反注册,导入更新删除时解析targetContent的domainName/URL并向网关注册,事务提交后异步执行 | R:RedisClient,ServiceRegistry,ResourceRegistrationTarget | A:- | S:ServiceRegistry按服务名缓存独立实例避免覆盖应用currentInstance,afterCommit回调,Redis SD键清理(sd:services/instances/active),URI解析host端口默认80/443,register/reregister/unregisterQuietly失败仅记日志不阻断主流程,@PreDestroy优雅注销
ResourceImportOwnerTypeValidator.java[SOB5MS]: F:资源导入归属类型校验,以resourceCode为幂等键兜底校验已有资源ownerType与导入入口一致,防止个人/企业tab间误导入覆盖归属域 | R:SsResource,OwnerType,ResourceBizType,I18nUtil | A:- | S:静态工具类,ownerType不一致抛IllegalArgumentException,本地化归属/资源类型标签(知识/对象/视图/工具),i18n国际化
ResourceJsonFtpSyncService.java[ES5OT]: F:按资源业务类型同步资源JSON到开放资源FTP目录,目录用小写文件名用大写命名 | R:FileIngressService,FtpConfig,ResourceArtifactPathResolver,ObjectStorageConfiguration,FileStorageContext,MultipartFileUtil | A:- | S:UTF8字节转MultipartFile,setStorageType,ftpCustomBasePathWithSubdirectory,空路径跳过
ResourcePackageFtpUploadService.java[SF5OL]: F:资源包文件/目录通过FTP/SFTP上传同步到开放资源目录,支持远程重命名、删除、存在性判断 | R:FileIngressService,FtpConfig,ResourceArtifactPathResolver,ObjectStorageConfiguration,MultipartFileUtil,JSch/ChannelSftp,FTPClient | A:- | S:JSch-SFTP与commons-net-FTP双协议,递归删除目录,自动创建父目录,Mac元数据过滤(__MACOSX/._),被动模式,本地目录树遍历保留结构上传
ToolManService.java[SST8OL]: F:工具/对象/视图资源管理服务,curl解析建工具、JSON导入TOOLKIT/MCP/AGENT、对象视图zip批量解析owl导入、资源软硬删除恢复与基础信息更新 | R:ResourceCurlService,SsResourceService,SsResExtToolKitService,SsResExtMcpService,SsResExtAgentService,SsResExtObjectService,SsResExtViewService,ObjectOwlImportParser,ViewOwlImportParser,ResourceDiscoveryRegistrationService,ResourceArtifactStorageService,AuthApplicationService,DigEmployeeChangeEventPublisher,DigitalEmployeeApplicationService,ResourceTargetJsonBuilder | A:- | S:@Transactional,resourceCode幂等,服务注册afterCommit,ZipSlip防护,MinIO产物bundle,数字员工Redis缓存清理,导入差异对比diff,开放接口免登录上下文,商业版WHALE_AGENT写禁止,多租户comAcctId隔离
ViewOwlImportParser.java[SVI5M]: F:解析视图OWL/RDF-XML文件提取视图定义与字段映射 | R:ParsedViewOwl,ParsedViewField,ParsedViewFieldRef | A:- | S:DOM安全解析(禁DTD/外部实体),根命名空间去重正则,SceneDefinition/SceneField节点提取,field引用映射,object_codes-JSON数组解析

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/resource/utils/===
LongToStringSerializer.java[UCO3T]: F:FastJSON序列化器将Long转String输出避免前端精度丢失 | R:fastjson:ObjectSerializer | A:- | S:实现ObjectSerializer,null写null,非null转String.valueOf写出

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/resource/vo/===
DatasetDetailVo.java[DK5M]: F:数据集详情VO,继承SsResource扩展type字段
DatasetVo.java[DKB3KS]: F:数据集视图对象,继承SsResource资源实体
McpToolParamsVo.java[DTool3S]: F:MCP工具参数VO,含参数名/编码/类型/默认值/是否必填
McpToolsVo.java[DToolJ T]: F:MCP工具信息VO,含工具编码/注释/服务地址/类型/请求头及参数列表
ResourceDetailVo.java[ED5TT]: F:资源详情VO,继承SsResource并扩展param参数字段
KnowledgeCapabilityVo.java: F:知识库前端页面能力开关视图对象,封装知识库模式与库级操作(增改删导入)开关

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/searchask/bean/===
SearchAsk.java[DCH5M]: F:搜问请求实体(会话ID/聊天内容/搜问模式)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/searchask/dto/===
ArchiveSelectedDocDTO.java[DKNOWMS]: F:联网搜索选中文档归档请求,含requestId/sessionId/选中textList条目
WebCrawlArchiveDocDTO.java[DK5TS]: F:网页爬取归档文档DTO,扩展实体附加文件URL字段
WebCrawlFetchResultDTO.java[DKN1S]: F:网页抓取结果DTO,封装成功HTML或失败原因
SessionArchiveItemDTO.java: F:按session反查的单次归档项DTO(含requestId/query/文档列表)
SessionArchiveQueryDTO.java: F:按sessionId反查归档的请求参数
WebSearchDocDTO.java: F:联网搜索请求DTO

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/searchask/service/===
SpaceDirRelService.java[SKN5S]: F:空间目录关联关系增删查及存在性统计 | R:SpaceDirRelMapper,SpaceDirRel,StringUtil | A:- | S:MyBatisPlus,LambdaQueryWrapper按dirId/dataType/dataId过滤,save/removeById/remove/findByDirId/countSpaceDirRel
SpaceDirService.java[SKN7KS]: F:搜索问答空间目录服务,管理会话目录(导入/收藏/个人企业知识库/技能资源查询)与查找或创建目录 | R:SpaceDirMapper,SequenceService,SpaceDirType,I18nUtil,CurrentUserHolder,PageHelperUtil | A:- | S:PageHelper分页查询个人/企业知识库,按dirType国际化命名,findOrCreate幂等建目录,sequence生成dirId

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/searchask/vo/===
ArchiveSelectedDocVO.java[DK7TM]: F:选中文档导入响应VO,会话维度归档请求列表
SessionSelectDocVO.java[DK5KT]: F:按会话ID反查归档文档响应VO,含会话标识与归档请求列表
WebSearchQueryVO.java[DK5KS]: F:联网搜索query响应VO,封装sessionId/requestId与DocChain返回textList供前端勾选归档

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/session/dto/===
AppendMessageDto.java[DDD5T]: F:追加消息DTO(消息ID/内容/结构/完成标志/推理日志)
ByClawPersonalAgentArchiveDto.java[DEMP5M]: F:个人agent tar.gz档案信息数据类(文件名/桶路径/objectKey/资源ID/用户编码/大小/类型)
ByClawSkillDto.java[DD5TT]: F:用户工作空间下skill信息数据类(目录名/根路径/SKILL.md对象键)
MessageDto.java[DB5CM]: F:会话消息数据传输对象,承载消息内容/结构体/向量/引用来源/关联资源/角色等
SortField.java[DCH5M]: F:会话查询排序字段DTO,含字段名/排序方式/优先级
TemplateMembersCopyRequestDto.java[DCH5M]: F:复制模板会话成员请求DTO,含原会话ID与成员记录ID映射关系
TemplateMembersCopyResponseDto.java[DCH5S]: F:复制模板会话成员响应DTO,含成员复制结果统计与详情列表
TemplateMessageEditRequestDto.java[DCH5T]: F:编辑模板会话消息内容请求DTO
TemplateMessagesCopyResponseDto.java[DCH5M]: F:复制模板会话消息响应DTO,含统计计数与逐条复制结果
TemplateSaveRequestDto.java[DA5TM]: F:会话模板保存请求,含新会话ID/标题/封面/终端类型/模板类型/做同款配置
TemplateSessionDetailResponseDto.java[DCH5M]: F:模板会话详情响应DTO,含会话信息/模板扩展/聊天记录列表三层嵌套结构
TemplateUpdateRequestDto.java[DA5TM]: F:更新模板会话参数请求DTO
WorkspaceArchiveDto.java[DCH3O]: F:工作区归档元数据传输对象,含ArchiveFS路径与MinIO objectKey、sha256校验、存储类型
ByClawFileDto.java: F:用户byclaw文件信息DTO(objectKey/fileName/filePath)
ConversationFilePathDto.java: F:会话文件路径DTO(相对路径与MinIO对象键)
SessionMembersDto.java: F:会话成员DTO,继承会话实体并附带成员列表、消息ID与扩展属性
TemplateMessagesCopyRequestDto.java: F:复制模板会话消息请求DTO,含原会话ID/消息ID列表/文件映射关系及内嵌FileInfo文件信息

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/session/enums/===
MemObjType.java[KCH1T]: F:会话记忆对象类型枚举(USER/AGENT)及有效性校验 | R:- | A:- | S:isValid遍历values匹配name,空值返false
SessionType.java[KCH5M]: F:会话类型枚举(单聊/群聊/人人/通知/即时搜问) | R:- | A:- | S:code+name双字段,RequiredArgsConstructor,Getter,五种会话场景常量
TemplateType.java[KCHA3S]: F:会话模板类型枚举(企业问答/高效工作/办公写作/市场分析/数据分析/调研报告/ESG等) | R:- | A:- | S:code与displayName双字段,fromCode/fromDisplayName/fromCodeOrDisplayName查找,getAllCodes/getAllDisplayNames,isValid校验
UserRole.java[EC5MT]: F:会话用户角色枚举(OWNER/ADMIN/MEMBER)及有效性校验 | R:- | A:- | S:values遍历name匹配,isValid静态校验,null返回false

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/session/qo/===
ConversationAppendTxtQo.java[DCHA5]: F:会话追加文本内容查询参数(用户/会话/文件路径/内容)
ConversationReadQo.java[DCHAT5T]: F:会话文件按行读取请求参数
ConversationWriteTxtQo.java[DCH5M]: F:会话文件覆盖写入请求(userCode/sessionId/filePath/content)
QryByClawFileByUserCodeQo.java[DF5M]: F:按用户编码查询byclaw用户桶文件列表请求,支持关键字与会话ID过滤
QrySkillListByUserCodeQo.java: F:按用户编码查询工作空间skill列表请求参数

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/session/service/===
SessionExtService.java[SCH5S]: F:会话扩展参数CRUD服务,按sessionId/参数编码值增删查 | R:ByaiSessionExt,ByaiSessionExtMapper | A:- | S:MyBatisPlus LambdaQueryWrapper,save/deleteBySessionId/selectBySessionId/selectByParamCodeAndValue
SessionMemberService.java[SC7KM]: F:会话成员管理(增删改查/批量保存/追加去重/按数字员工分页查会话) | R:ByaiSessionMemberMapper,SessionByAgentQo,ByaiSessionMember,CurrentUserHolder,PageHelperUtil | A:- | S:LambdaQueryWrapper按sessionId/memObjType/memObjId过滤,appendSessionMembers查重防重复,updateSelective非空更新,querySessionByAgent注入当前用户ID+PageHelper分页
SessionService.java[SCH7BTM]: F:记忆中心会话核心服务,会话CRUD/群聊创建/模板会话存为模板/更新/详情/消息及成员复制(含文件ID替换)/删除 | R:ByaiSessionMapper,ByaiSessionExtMapper,ByaiSessionMemberMapper,SessionExtService,SessionMemberService,SequenceService,ByaiMessageHotService,TemplateType,MapParamUtil,CurrentUserHolder | A:- | S:isDebug=2标识模板,扩展参数键值存储(template_title/cover_id/type/config/terminal),relatedResources递归JSON文件映射替换,批量复制结果统计成功失败,租户隔离enterpriseId

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/showcase/===
ContentTypeConstant.java[SKC1T]: F:展示内容类型常量(慧笔PPT/文稿/会议纪要/海报图片前缀) | R:- | A:- | S:静态final字符串常量,2017_/2005_/2018_/2004_类型编码

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/showcase/service/===
ShowcaseService.java[SOB7TML]: F:成果空间(收藏)增删改查/详情/下载/转存知识库/聊天历史,策略模式按类型处理 | R:ByaiShowcaseMapper,ShowcaseStrategyFactory,SequenceService,FileService,ResourceApplicationService,MessageService,CurrentUserHolder | A:- | S:事务写操作,逻辑删status=0,PageHelper分页+用户隔离queryAll,saveToDoc下载文件Feign转存预上传知识库,fileId纯数字校验防路径遍历,sessionMode按task映射,ContentDisposition解析文件名

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/showcase/strategy/===
AbstractShowcaseStrategy.java[SCO5OM]: F:成果空间策略抽象基类,定义保存前下载/上传对象存储/写回实体模板流程 | R:ShowcaseStrategy,ShowcaseRecoveryHelper,ByaiShowcase,ShowcaseStoragePayload,ShowcaseDetailDto,I18nUtil | A:- | S:beforeSave模板方法,downloadOriginalFile/uploadToObjectStorage默认空实现可覆盖,applyStorageResult写回url/name/fileId,buildBasicDetail构建详情,内容预览截断200字,UTF8转字节,recoverIfNecessary恢复
AllShowcaseStrategy.java[SCO5OT]: F:汇总类型成果展示策略,委托默认行为构建详情与对象存储上传 | R:AbstractShowcaseStrategy,ByaiShowcase,ShowcaseDetailDto,ShowcaseStoragePayload | A:- | S:type=all,buildDetail设previewType/description,download/upload留TODO,withObjectUrl返回content
BaseFileShowcaseStrategy.java[SO5OT]: F:文件型成果展示策略抽象基类,构建详情/下载/文件名/预览 | R:AbstractShowcaseStrategy,ByaiShowcase,ShowcaseDetailDto,ShowcaseDownloadResult | A:- | S:模板方法模式,预留fileExtension/mediaType抽象,文件名清理路径分隔符防注入,toBytes转字节流下载
ChatShowcaseStrategy.java[SCH5T]: F:会话类成果展示策略,构建预览详情与消息摘要 | R:AbstractShowcaseStrategy,ByaiShowcase,ShowcaseDetailDto | A:- | S:策略模式type=chat,正则压缩空白截取200字摘要,beforeSave空实现无需对象存储
DefaultShowcaseStrategy.java[SOB5OT]: F:默认成果空间策略,通用成果类型详情构建与文件下载上传占位实现 | R:AbstractShowcaseStrategy,ByaiShowcase,ShowcaseDetailDto,ShowcaseStoragePayload | A:- | S:type=default,buildBasicDetail通用成果,downloadOriginalFile返回empty占位,uploadToObjectStorage回写原content
ExcelShowcaseStrategy.java[SCO7OT]: F:Excel类型展品存储策略,定义xlsx扩展名与MIME类型并沿用已有URL免上传 | R:BaseFileShowcaseStrategy,ByaiShowcase,ShowcaseStoragePayload | A:- | S:继承基类文件策略,getType=excel,downloadOriginalFile留空待扩展,uploadToObjectStorage直接复用content的URL不触发MinIO上传
FileShowcaseStrategy.java[SS7FM]: F:文件型成果策略,解析content构建文件预览详情并按后缀检测文件类型 | R:AbstractShowcaseStrategy,ShowcaseDetailDto,ByaiShowcase | A:- | S:type=file,parseFilePayload解析fileId/fileUrl/fileName,detectFileType按后缀分类doc/ppt/excel/pdf/image/md,extractSuffix去查询参数取扩展名,buildDetail装previewType
ImageShowcaseStrategy.java[SS5OL]: F:图片类型成果展示下载策略,解析HTML/JSON内容提取图片URL并下载上传对象存储 | R:BaseFileShowcaseStrategy,ShowcaseStorageHelper,ByaiShowcase,ShowcaseDownloadResult,ShowcaseStoragePayload,showcaseFileRestTemplate | A:- | S:正则提取href/src/download属性,unwrap流式JSON delta content,RestTemplate下载图片字节,MD5内容指纹幂等,http/https协议校验,异常兜底回退父类,默认png
OcrShowcaseStrategy.java[SCO5OS]: F:OCR成果展示策略,生成文本文件并上传对象存储 | R:BaseFileShowcaseStrategy,ShowcaseStoragePayload,ByaiShowcase,I18nUtil | A:- | S:type=ocr,.txt/text-plain-UTF8,downloadOriginalFile从content生成字节,uploadToObjectStorage待实现,content空抛异常
PaperShowcaseStrategy.java[ECO5OT]: F:论文/文档(PDF)成果展示策略,继承文件展示基类处理PDF下载与对象存储上传 | R:BaseFileShowcaseStrategy,ByaiShowcase,ShowcaseStoragePayload | A:- | S:type=paper,fileExtension=.pdf,mediaType=application/pdf,download/upload均TODO待实现,uploadToObjectStorage返回content在线地址
PptShowcaseStrategy.java[SS5OS]: F:PPT成果展示策略,导出PPT并上传对象存储 | R:BaseFileShowcaseStrategy,ShowcaseRemoteExportService,ShowcaseStorageHelper,ShowcaseStoragePayload,ByaiShowcase,ContentTypeConstant | A:- | S:getType=ppt,导出pptx,从content.substance.pptId解析导出ID回退messageId,设置fileCode,recoverIfNecessary跳过,MinIO上传
RecordShowcaseStrategy.java[SS5FOM]: F:会议录音成果(record)展示策略,从会议服务下载纪要文件失败则回退本地生成txt后存对象存储 | R:BaseFileShowcaseStrategy,ShowcaseStorageHelper,ShowcaseStoragePayload,ByaiShowcase,ContentTypeConstant,feign.memobit:/v1/meeting/download/minute | A:- | S:RestTemplate POST下载会议纪要,Content-Disposition解析文件名,parseRecordPayload解析substance,buildMinuteFile拼接纪要,storageHelper上传MinIO
ShowcaseRecoveryHelper.java[SOB5S]: F:成果展示记录软删除恢复辅助,命中已删除记录则复活并回填字段 | R:ByaiShowcaseMapper,ByaiShowcase,CurrentUserHolder,I18nUtil,BdpRuntimeException | A:- | S:按sessionId/type/messageId/fileCode查已删记录,非删态抛已收藏异常,status置1并更新审计字段,回填url/fileId/name/content并标记recovered
ShowcaseRemoteExportService.java[SCO5FM]: F:展示文稿远程导出服务,封装PPT/DOC调用AiWriter导出接口 | R:FeignAiWriterService,BdpRuntimeException,I18nUtil | A:- | S:Feign调用exportPpt/exportDoc,流读取文件字节,解析Content-Type/Content-Disposition,文件名路径遍历防护与格式校验,ExportedFile载体
ShowcaseStorageHelper.java[SF7OS]: F:成果展示文件上传对象存储辅助类,下载载体上传MinIO并返回访问地址 | R:FileService,ByaiSystemConfigService,MultipartFileUtil,ShowcaseStoragePayload,ByaiShowcase,CurrentUserHolder | A:- | S:fileService.uploadFiles上传,文件名URL解码,SC_/SE_标签构建用户会话隔离,projectId从系统配置取,响应解析successFiles取fileUrl/downloadUrl,失败回退原地址
ShowcaseStrategyFactory.java[SS5T]: F:成果空间展示策略工厂,按成果类型路由到对应策略实现 | R:ShowcaseStrategy,DefaultShowcaseStrategy,ExcelShowcaseStrategy | A:- | S:构造期注入策略列表建type→策略映射,type归一化小写,table映射为Excel策略,找不到返回默认策略
ShowcaseStrategy.java[ASO5OS]: F:成果空间策略接口,定义不同成果类型的保存/更新预处理、详情构建、下载行为 | R:ByaiShowcase,ShowcaseDetailDto,ShowcaseDownloadResult,I18nUtil | A:- | S:策略模式解耦,default方法提供默认实现,download默认抛UnsupportedOperationException,getType标识类型
TableShowcaseStrategy.java[SV5OT]: F:已废弃的表格展示策略,继承ExcelShowcaseStrategy仅保留遗留兼容 | R:ExcelShowcaseStrategy.java | A:- | S:@Deprecated空类,委托父类Excel展示逻辑
TaskShowcaseStrategy.java[ST5OT]: F:任务成果展示策略,生成JSON格式任务上下文文件并上传对象存储 | R:BaseFileShowcaseStrategy,ShowcaseStoragePayload,ByaiShowcase,I18nUtil | A:- | S:type=task,.json/application/json,继承基类下载上传逻辑待实现,空载荷兜底
TextShowcaseStrategy.java[SOB7OS]: F:文本成果导出策略,解析docId远程导出docx并上传对象存储 | R:BaseFileShowcaseStrategy,ShowcaseRemoteExportService,ShowcaseStorageHelper,ShowcaseStoragePayload,ByaiShowcase | A:- | S:getType=text,导出docx失败兜底content生成txt,从substance.docId或messageId解析,MinIO上传

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/sys/model/===
SequenceId.java[ESYS5T]: F:序列ID包装类

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/sys/service/===
ByaiSystemConfigService.java[SSY5CT]: F:系统参数配置查询服务,缓存优先获取配置值并替换${}环境变量占位符 | R:ByaiSystemConfigMapper,ByaiSystemConfigListMapper,RedisUtil,ApplicationContextUtil,JsonUtil | A:- | S:Redis-hmGet缓存兜底DB查询,正则解析占位符,getEnvProperty环境变量替换,按paramCode/paramGroupCode查询
SequenceService.java[SSD5S]: F:多数据源序列号生成服务,按数据库类型(teledb/oracle/postgresql/opengauss/mysql)路由不同序列策略,兼容雪花ID与纳秒原子自增 | R:SequenceMapper,ByaiDruidProperties,SequenceId,IdUtil | A:- | S:dbType分支路由,AtomicLong纳秒兜底,mysql增量每万次清理,雪花ID,defaultSequenceName可配
SysAppVersionService.java[SSY5T]: F:应用版本信息服务,按设备类型查询最新版本 | R:SysAppVersion,SysAppVersionMapper | A:- | S:selectLatestVersionByDeviceType,deviceType入参,单一查询委托Mapper

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/template/enums/===
DebugModeEnum.java[KAES1T]: F:会话调试模式枚举(普通/调试/模板会话)
TemplateTypeEnum.java[KCOR3T]: F:模板类型枚举(企业问答/办公写作/数据分析/ESG等),提供code映射校验工具方法 | R:- | A:- | S:code-displayName双字段,fromCode/isValid/getAllCodes/getAllCodesAsString

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/template/service/===
TemplateFileProcessingService.java[SFI5FOS]: F:模板会话文件处理,下载原文件并经会话重新上传构建文件ID映射关系 | R:FileService,AssistantChatApplicationService,OpenFileDownloadDTO,SessionUploadResult,UploadItem,ByaiMessageHotDto | A:- | S:正则提取消息relatedResources中fileId/fileIds,Feign下载文件流,Content-Disposition解析文件名,构造匿名MultipartFile重传,文件归属当前用户datasetId,内容类型推断扩展名,I18n异常
:
TemplateSessionService.java[SC7TMOL]: F:模板会话保存/查询/删除全流程编排,会话存模板含消息成员成果空间任务/文件深度复制 | R:SessionService,SequenceService,TemplateFileProcessingService,MenTaskService,FileService,ByaiMessageHotService,MenTaskMapper,MenResComMapper,MenTaskRecObjMapper,MenTaskCatalogMapper,SessionMemberService,ByaiSystemConfigService,CurrentUserHolder | A:- | S:平台管理员权限校验,@Transactional,父子任务分层复制+taskIdMapping,文件下载重传构标签US_/SE_/TA_/TC_/FN_,Feign下载流封MultipartFile,成果空间清理级联删除,序列生成新ID,企业租户隔离comAcctId

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/workspace/service/===
SessionWorkspaceService.java[SC7BTM]: F:会话工作区文件管理,支持工作区记录增删改查及批量保存文件到成果空间并按类型归入空间目录 | R:ByaiSessionWorkspaceMapper,ByaiShowcaseMapper,SpaceDirMapper,SpaceDirRelMapper,FileShowcaseStrategy,SequenceService,CurrentUserHolder | A:- | S:批量插入工作区/成果,detectType文件类型识别,batchBindShowcaseDirs目录绑定(查已有→建缺失→插关联),事务保障,is_exist标记

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/ws/config/===
WebSocketProperties.java[GWS3WT]: F:WebSocket服务器Netty配置属性 | R:- | A:- | S:websocket前缀配置,maxFrameSize帧大小64KB,idleTimeout读空闲60s,writerIdleTime/allIdleTime,websocketPath=/byaiService/ws,logLevel日志级别

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/ws/constant/===
Constant.java[KWS1WT]: F:WebSocket通道常量定义用户信息/请求头/生态桥接的Netty AttributeKey | R:LoginInfo | A:- | S:静态AttributeKey常量,Netty Channel属性键

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/ws/handler/===
HttpRequestHandler.java[HHW9WT]: F:Netty HTTP升级握手处理器,校验WS路径并触发认证后转发升级 | R:AuthService,WebSocketProperties,NettyResponse,CloseUtil | A:- | S:ChannelInboundHandlerAdapter,@Sharable,路径匹配websocketPath,authService.auth鉴权,retain转发,404/错误响应,异常关闭连接
RedisStreamMessageListener.java[SWG9RWL]: F:Redis Stream消息监听器,Gateway模式下按session独立prototype实例接收数据流事件并投入路由器,广播多端同步 | R:SessionStreamEventRouter,SessionStreamManager,RedisTemplate | A:- | S:监听byai_gateway:session:{id}:data_stream,解析data字段JSON提取session_id注入stream_id,dispatch后ack消费组,SSE实时推流由请求线程消费队列
WebSocketHandler.java[HWS9WL]: F:Netty WebSocket消息总入口处理器,按类型分发(心跳/LLM对话/SSE流/通知/生态桥接/停止),管理连接生命周期与登录上下文 | R:ChatService,NotificationService,SandboxService,EcosystemCollectionApplicationService,ChatMessage,CurrentUserHolder,PushUtil,NettyResponse,Constant | A:ws | S:SimpleChannelInboundHandler,@Sharable,REQUEST_ID雪花ID生成清理,IdleState读空闲60s关连接,LoginInfo线程上下文还原,浏览器桥接BIND/HEARTBEAT/PULL_TASKS/CLAIM/RENEW租约/TASK_RESULT动作,沙箱心跳活跃更新,JSON序列化推送
WebSocketServerInitializer.java[SW9WT]: F:Netty WebSocket服务端Channel流水线初始化器,装配HTTP编解码/聚合/空闲检测/WS协议升级及业务处理器 | R:HttpRequestHandler,WebSocketHandler,WebSocketProperties,webEventExecutorGroup | A:- | S:ChannelInitializer,HttpServerCodec+HttpObjectAggregator,IdleStateHandler心跳,WebSocketServerProtocolHandler握手,业务handler走独立EventExecutorGroup

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/ws/manager/===
ChannelManager.java[SWS9WT]: F:WebSocket用户Channel连接管理器,支持单用户多设备多连接 | R:Netty Channel | A:- | S:静态ConcurrentHashMap存userId→Channel集合,computeIfAbsent增,computeIfPresent删空清条目,查活跃连接与在线用户
NettyArrayOutputStream.java[UWS5WT]: F:Netty WebSocket输出流,将写入字节实时包装为TextWebSocketFrame推送给客户端 | R:fastjson,netty | A:- | S:继承ByteArrayOutputStream重写write/flush,wrapContent按clientRequestId/wrapperType包装event/sessionId/data,channel活跃才writeAndFlush

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/ws/model/===
ChatMessage.java[ACHWM]: F:WebSocket聊天消息模型,封装发信人/消息类型/消息ID

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/ws/===
NettyServerApplication.java[LWS9WS]: F:Netty WebSocket服务器启动器,应用启动时绑定端口并优雅关闭 | R:WebSocketServerInitializer,NettyProperties,ServerBootstrap | A:- | S:ApplicationRunner启动钩子,childHandler绑定initializer,bind端口8082,@PreDestroy关闭channel

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/ws/service/===
AuthService.java[SWS9JWM]: F:WebSocket握手JWT鉴权,从header/URL提取beyond-token校验并绑定LoginInfo到Channel | R:JwtService,ChannelManager,BaseTokenFilter,Constant,CloseUtil,I18nUtil,LoginInfo | A:- | S:verifyJwt解析用户,补sso-token给bot,addChannel按userId注册,ExpiredJwt转码提示前端刷token,parseUrl解析查询参数
ChatService.java[SWS9WM]: F:WebSocket聊天服务,处理LLM对话/SSE流转发/停止对话三类实时通信 | R:AssistantChatService,MessageService,AssistantChatApplicationService,RunningOutputStreamRegistry,NettyArrayOutputStream,NettyResponse,CurrentUserHolder | A:- | S:Netty非阻塞IO,CHAT_STREAM流式响应,SSE去data前缀转发,senderChannel多端广播排除,stopChat回填RunningChatInfo并发STOP_CHAT_ACK
MultiDeviceBroadcastService.java[SWS8WS]: F:多端在线设备WebSocket消息广播服务,将会话/聊天流/原始事件推送到同一用户所有Channel(排除发送端) | R:ChannelManager,Netty Channel | A:- | S:broadcastToUserDevices/broadcastRawEvent/broadcastRawToUser,TextWebSocketFrame写入,按userId取Channel集合,isActive过滤,SESSION_EVENT/CHAT_STREAM/原始透传三类消息,traceId/streamId/metadata拼装

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/infrastructure/agentconnect/===
AgentTypeHandlerFactory.java[HEMP5T]: F:数字员工类型处理器工厂,按agentType注册与获取对应处理器 | R:AgentTypeHandlerAbstract,BdpRuntimeException,I18nUtil | A:- | S:静态factoryMap注册表,register注册,getHandler取处理器空则抛异常

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/infrastructure/agentconnect/handle/===
AgentTypeHandlerAbstract.java[SE9AT]: F:智能体类型处理器抽象基类,定义不同类型数字员工表头处理模板 | R:AgentDto | A:- | S:抽象类handleHeader模板方法,@Service待子类实现,按智能体类型分发处理
AiWriterAgentHandler.java[SEH5AT]: F:AI写作智能体连接处理器,生成请求头与token | R:CommonHandler,AgentTypeHandlerFactory,AgentTypeEnum,AgentDto | A:- | S:继承CommonHandler,InitializingBean启动注册WRITER类型,工厂模式分发,重写handleHeader
BotAgentHandler.java[SEM7AT]: F:Bot类型智能体处理器,初始化时按BOT_AGENT类型码注册到工厂 | R:CommonHandler,AgentTypeHandlerFactory,AgentTypeEnum | A:- | S:继承CommonHandler,实现InitializingBean,afterPropertiesSet自注册,策略工厂模式
ChatBiAgentHandler.java[HEMP5S]: F:ChatBI类型数字员工连接处理器,组装请求头 | R:CommonHandler.java,AgentTypeHandlerFactory.java,AgentTypeEnum,AgentDto | A:- | S:继承CommonHandler重写handleHeader,InitializingBean启动时按CHATBI名称码与名称双重注册到工厂
CommonHandler.java[SEH7JM]: F:智能体连接通用请求头处理器,根据认证类型(SSO/BEYOND/URL-TOKEN)组装透传sso-token/beyond-token/cookie/session-code等鉴权头 | R:AgentTypeHandlerAbstract,BaseTokenFilter,JwtService,CurrentUserHolder,AgentDto | A:- | S:RequestContextHolder取HTTP头,非HTTP场景取LoginInfo.paramMap,缺失beyond-token时JWT自生成,URL-TOKEN场景createSsoToken,固定system-code=BYAI
DigHumanAgentHandler.java[HEMP7AT]: F:数字人智能体连接处理器,生成请求头token并注册到类型工厂 | R:CommonHandler,AgentTypeHandlerFactory,AgentTypeEnum,AgentDto | A:- | S:继承CommonHandler重写handleHeader,InitializingBean启动注册DIGHUM类型,工厂模式按NameCode/Name双注册
KnowledgeAgentHandler.java[HKNW5T]: F:知识库类智能体连接处理器,启动时按类型注册到工厂 | R:CommonHandler,AgentTypeHandlerFactory,AgentTypeEnum | A:- | S:继承CommonHandler,InitializingBean,注册AGENT/DOC_AGENT/DB_AGENT/API_AGENT四类

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/infrastructure/common/constants/===
SseResponseEventEnum.java[AKC1WT]: F:SSE响应事件类型常量定义 | R:- | A:- | S:answer/reasoningLog/answerDelta流式事件,taskCreate/stepComplete/stopTask智办规划事件,tokenCount/createSession/initMessage

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/infrastructure/exception/===
GlobalExceptionHandler.java[HSY8VM]: F:全局异常处理器,统一封装BaseRuntimeException/校验/404等为ResponseUtil失败响应 | R:ResponseUtil,I18nUtil,BaseRuntimeException | A:- | S:@RestControllerAdvice,i18n多语言错误消息,SSE流跳过包装,SQL异常脱敏,参数校验聚合(MethodArgumentNotValid/ConstraintViolation/Bind),sysCode标识

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/infrastructure/filter/===
AccessTokenVerifyInterceptor.java[WAU9JPL]: F:统一认证拦截器,外部请求按session/JWT/SSO/accessToken多级链式鉴权,内部feign及白名单URL放行 | R:SessionFilter,JwtTokenFilter,SsoTokenFilter,AccessTokenFilter,URLFilter,LoginApplicationService,CurrentUserHolder | A:- | S:preHandle正则白名单匹配,session优先共享,beyond-token补全session,401错误封装html转义,真实IP多层代理解析,敏感字段脱敏日志
WebMvcConfiguration.java[GCO5SM]: F:Spring MVC全局配置,消息转换器/文件上传/拦截器/RestTemplate/静态资源 | R:AccessTokenVerifyInterceptor | A:- | S:FastJson+Jackson双转换器Long/Int转String防精度丢失,UTF-8字符串转换器防SSE中文乱码,自定义multipartResolver按沙箱ingress前缀跳过多部分解析,负载均衡RestTemplate+成果空间专用5s超时RestTemplate,token拦截器拦/**

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/infrastructure/filter/sub/===
AccessTokenFilter.java[WTO8JS]: F:AccessToken令牌认证子过滤器,校验令牌有效性与过期并设置当前登录用户 | R:UserAccessTokenService,LoginApplicationService,CurrentUserHolder,FilterType,I18nUtil | A:- | S:findByAccessToken查令牌,endTime过期校验,getLoginInfo设线程上下文,更新lastActiveTime,异常转BadCredentials
BaseTokenFilter.java[WAU8JM]: F:SSO单点登录JWT令牌认证基类,验签解析token并从Redis/Session构建登录用户信息绑定线程上下文 | R:CurrentUserHolder,LoginInfo,LoginApplicationService,RedisUtil,SessionRepository,SsoTokenFilter | A:- | S:HMAC256验签,SSO_SESSION_前缀Redis映射sessionId,session过期重建,JWT生成,buildUserInfo填充组织/岗位/驻地,多租户enterpriseId/comAcctId
JwtTokenFilter.java[WAUTH8JS]: F:JWT令牌认证过滤器,校验jwtToken解析登录信息并设置安全上下文 | R:BaseTokenFilter,JwtService,CurrentUserHolder,LoginInfo,JwtAuthentication,I18nUtil | A:- | S:verifyJwt解析LoginInfo,多系统编码(UIAGENT/BOT/BYAI等)用户信息对齐findOrBuildUerInfo,SecurityContextHolder设置认证,过期抛BadCredentialsException提示刷新token
SessionFilter.java[WAU8JMT]: F:从HttpSession解析共享用户信息构建LoginInfo并设入当前线程上下文 | R:CurrentUserHolder,LoginInfo,UsersOrganization,UserStation | A:- | S:读SHARE_CURRENT_USER共享session,JSON反序列化用户信息,填充assistantId/enterpriseId/comAcctId等,解析组织列表与驻地,多租户隔离
SsoTokenFilter.java[WTO7JS]: F:单点登录SSO令牌认证过滤器,校验JWT签名并构建会话与登录上下文 | R:BaseTokenFilter,CurrentUserHolder,LoginInfo,RedisUtil,I18nUtil | A:- | S:HMAC256验签JWT,解析id/code/name声明,SSO_REDIS_PREFIX+code取sessionId失效则createNewSession,buildUserInfo后CurrentUserHolder.setLoginInfo,过期抛BadCredentialsException
URLFilter.java[WAU7JT]: F:URL参数userId认证过滤器,从分享缓存查用户构建登录态写入当前线程 | R:BaseTokenFilter,ShareCacheUtil,ShareBfmUser,CurrentUserHolder,LoginInfo | A:- | S:取userId参数,空则跳过,ShareCacheUtil查ShareBfmUser,findOrBuildUerInfo建登录态,CurrentUserHolder设线程上下文

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/infrastructure/messagecontent/handle/===
DefaultContentHandler.java[SEH13T]: F:默认消息内容处理器,原样返回内容不做转换 | R:MessageContentHandler | A:- | S:实现MessageContentHandler接口,handle方法直接返回入参,空操作兜底实现
EchartContentHandler.java[SCH5H T]: F:ChatBI图表消息内容解析处理器,按answerType提取文本/查询结果数据 | R:MessageContentHandler,ChatBiAnswerTypeEnum | A:- | S:fastjson解析,TEXT直返answer,QUERY_DATA_RESULT/KNOWLEDGE_ROUTER取queryDataResultList首项desc+resultData,空值兜底原文
MessageContentHandler.java[SEC9T]: F:消息内容处理器接口,定义会话消息内容转换契约 | R:消息内容处理实现类 | A:- | S:单方法handle,入参出参String,策略模式扩展点
WriterArticleContentHandler.java[SCH5T]: F:写作文章消息内容解析处理器,从JSON的main数组提取标题与值拼接为文章文本 | R:MessageContentHandler | A:- | S:实现MessageContentHandler接口,fastjson解析嵌套content,遍历valueList取title否则取value换行拼接
WriterOutlineContentHandler.java[HCO3T]: F:写作大纲消息内容处理器,将大纲JSON递归转为Markdown多级标题 | R:MessageContentHandler | A:- | S:实现handle接口,fastjson解析title/outlines,递归processOutlineItems按level生成#标题

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/infrastructure/messagecontent/===
MessageContentHandlerFactory.java[HCHA5T]: F:消息内容处理器工厂,按内容类型路由到对应Handler | R:MessageContentHandler,EchartContentHandler,WriterArticleContentHandler,WriterOutlineContentHandler,DefaultContentHandler,MessageContentTypeEnum | A:- | S:静态HashMap注册echart/writer-article/writer-outline处理器,getOrDefault兜底DefaultContentHandler

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/infrastructure/utils/===
ChatUtils.java[UAC3T]: F:会话工具类,字符串截断/语言获取/联网检索参数拼接 | R:I18nUtil,ApplicationContextUtil,EnvConfigKey | A:- | S:truncateString截前N字符,getLanguage从请求属性取语言默认中文,getConnectParams拼DocChain的topic_id与X-Api-Key
CloseUtil.java[UWS9WT]: F:WebSocket连接关闭工具,移除用户Channel并关闭上下文 | R:LoginInfo,Constant,ChannelManager | A:- | S:netty-ChannelHandlerContext,从ATT_USER_INFO取userId,removeChannel,异常warn容错
CompletionsUtils.java[US8WT]: F:Completions流式响应工具,SSE/WS输出写出与消息内容增量整合 | R:MessageContentHandlerFactory,MessageContentHandler,AnswerDelta,ChoiceDto,DeltaDto,MessageContentTypeEnum,I18nUtil | A:- | S:setResHeader设SSE头,responseWrite按ServletOutputStream(event/data格式)与ByteArrayOutputStream(注入event/sessionId)分流,getSseContext解析AnswerDelta按contentType过滤数字卡片并handle内容,parseMessageStruct整合骨架与完整content
LogUtil.java[USY3T]: F:日志工具类,清理CRLF/控制字符防止日志注入 | R:slf4j Logger | A:- | S:info/warn/debug封装,sanitizeForLog移除CRLF,sanitizeLogParameter清理控制字符及注入特殊字符并限长1000
NettyResponse.java[UWS5T]: F:Netty HTTP响应工具,封装成功/错误/404及通用JSON响应发送 | R:PushUtil | A:- | S:DefaultFullHttpResponse,application/json,UTF-8编码,静态方法
PushUtil.java[UWS9WT]: F:Netty通道WebSocket消息帧推送工具 | R:io.netty.Channel | A:- | S:writeAndFlush发送,isChannelValid校验active,异常日志,TODO速率控制

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/chat/===
AssistantChatController.java[CC9WML]: F:数字助理对话核心控制器,SSE流式输出/任务表单提交/会话停止/运行状态快照/文件上传/术语选项 | R:MessageService,AssistantChatApplicationService,TaskService,SuperassistService,RunningOutputStreamRegistry,RunningChatSnapshotService,SessionService,FeignDataCloudService via feign,CurrentUserHolder | A:/chat/getMessageStream,/submitForm,/manualTask,/stopChat,/runningStatus,/runningSnapshot,/uploadFiles,/getTermsOptions,/share/html | S:text/event-stream流式,会话归属校验isCurrentUserSession防越权,MultipartFile上传,html预览no-cache,数据云术语feign调用
SsSuperAssistKwCatalogController.java[CKO7US]: F:会话级知识库文档上传与构建,支持问数/慧笔/鲸灵/数字员工四类会话场景 | R:SsSuperAssistKwCatalogApplicationService,ResponseUtil,UploadResult | A:POST /SsSuperAssistKwCatalogController/uploadFileAndRebuildDataset | S:多文件MultipartFile上传,按sessionType分场景,可选sessionId/build/agentId,异常转fail响应

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/dataset/===
DatasetController.java[CKN7OL]: F:知识库数据集资源全生命周期管理(CRUD/目录/文件上传下载/构建/JSON导入/状态查询) | R:DatasetApplicationService,ResponseUtil,I18nUtil | A:/datasetController/{selectDatasetByQo,createDataset,updateDataset,deleteDataset,detail,queryKnowledgeCapability,createFolder,renameFolder,deleteFolder,queryDirAndFileByLevel,uploadFiles,build,download,removeFile,importDatasetJson,fileBuildStatus} | S:对应ss_resource表,multipart文件上传ISO_8859_1转UTF-8,JSON批量导入聚合成功/失败/新增/更新统计,文件流下载,i18n国际化消息

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/digitemploy/===
DigitEmployManController.java[CW8WS]: F:数字员工管理控制器,提供调试对话(SSE流式)与置顶操作 | R:AssistantChatService,SsSuperassistSubAgentService,CompletionsUtils,CurrentUserHolder,AgentDebugChatDto,IsTopVo | A:POST /api/v1/digitEmploy/debugChat,/isTop | S:debugChat设DEBUG模式输出流式响应,当前用户assistantId校验,isTop置顶/取消子智能体

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/ecosystem/===
EcosystemCollectionController.java[CCO7ML]: F:生态采集REST入口,管理连接器/连接配置/采集任务/运行/聊天与技能采集计划编排 | R:EcosystemCollectionApplicationService,ResponseUtil,I18nUtil | A:/ecosystemCollection/{connectors,browserBridge/status,connections(GET/POST),tasks(GET/POST),tasks/status,runs/start,runs/detail,runs/action,chat/plan,skill/plan,chat/start,skill/start} | S:Map泛化入参,凭据安全视图不返明文,BrowserBridge状态查询,运行动作重试/跳过/确认,聊天与OpenClaw技能双入口
EcosystemCollectionIngestionController.java[CK7SL]: F:生态采集入库分步接口,执行OpenCLI采集、产物落地、Markdown知识库导入 | R:OpenCliRunner,EcosystemArtifactStorageService,EcosystemKnowledgeImportService,SequenceService,EcosystemTaskVo | A:/ecosystemCollection/ingestion/{opencli/collect,artifacts/store,knowledge/import} | S:三步骤POST编排,沙箱命令采集后落产物再导知识库,输出目录限tmp/bykc-ec-前缀防越权,Base64/UTF8解码Markdown,序列ID缺省生成,内嵌Request/Payload清单类
</assistant>

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/filebrowser/===
FileBrowserController.java[CFL8MOL]: F:文件浏览器REST控制器,提供列表/上传/下载/删除/重命名/移动/搜索/建文件夹/打包下载九大接口 | R:FileBrowserApplicationService,CurrentUserHolder,ResponseUtil,FileBrowserItemVo | A:POST /fileBrowser/{list,upload,delete,rename,move,createFolder,search} GET /fileBrowser/{defaultPath,download,downloadFolder} | S:MinIO按用户隔离bucket,userCode登录校验,resourceId必填,InputStreamResource单文件流,StreamingResponseBody递归zip打包,URLEncoder中文文件名编码

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/fs/===
FsOperationController.java[CFI8OM]: F:对外暴露USER/RESOURCE两类MinIO文件空间的增删改下载接口,薄层转发 | R:FsOperationApplicationService,ResponseUtil,I18nUtil | A:/fs/operation/v1/{files/put,files/get,files/delete,directories/create,directories/delete,files/rename,directories/rename} | S:multipart上传,StreamingResponseBody流式下载且异常返回可读text/plain,RFC5987中文文件名编码,spaceType+resourceId区分空间

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/index/===
DigitEmployManControllerV2.java[CEM5KM]: F:数字员工市场首页V2(我创建/订阅/常用/最近添加/发现/热门/部门范围) | R:IndexApplicationServiceV2,ResponseUtil,MyAuthEmployQo,AuthDigitEmployVo,DigitEmployMarketVo | A:/api/v2/digitEmploy/{queryMyCreatedAndSubscribedAgents,queryMyUsual,queryRecentlyAdded,queryMyCreated,discover,queryPopular,queryMyDepartmentRange} | S:全POST分页查询,90天使用频次排序,OpenTelemetry埋点,多租户隔离
ResourceManControllerV2.java[CE7KT]: F:查询数字员工授权的文档与工具资源(分页) | R:IndexApplicationServiceV2,AuthResourceQo,AuthResourceVo,ResponseUtil,PageInfo | A:POST /api/v2/resource/queryAuthDoc,/queryAuthTools | S:V2资源授权控制器,委托IndexApplicationServiceV2,分页返回授权资源

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/langfuse/dto/===
LangfuseQueryDto.java[DCH5T]: F:Langfuse追踪查询参数对象(分页/会话/Trace/时间范围/排序)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/langfuse/===
LangfuseController.java[CV5MT]: F:Langfuse链路追踪查询控制器,提供Traces/Observations及会话流程统计查询 | R:LangfuseService,LangfuseQueryDto,ResponseUtil,BdpRuntimeException,I18nUtil | A:/langfuse/traces,/langfuse/traces/{traceId}/observations,/langfuse/observations,/langfuse/traces/{traceId},/langfuse/getTraceTimelineBasicInfo/{traceId},/langfuse/observations/{observationId},/langfuse/config,/langfuse/sessions/{sessionId}/{traces,flow,statistics,recent,observations} | S:统一try-catch+error字段判定,sessionId/traceId空校验抛BdpRuntimeException,按session聚合多trace的observations,时间线/统计/最近记录

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/manage/===
AssistantManController.java[CC8PML]: F:助理管理控制器,会话历史/消息点赞点踩/反馈/删除/资源授权/人员模糊查询/按数字员工查会话等非对话类功能 | R:MessageService,SessionApplicationService,ResourcePrivilegeService,AssistantManApplicationService,SessionMemberService,ByaiMessageHotService,CurrentUserHolder | A:/assiman/{updateMessage,updateMesFeedback,qryConversations,updateConversation,removeConversation,getMessages,getForwardMessage/{id},getMessageByIds,deleteMessage,getContentFeedbackType,find,saveResourcePrivilege,getUserSelectedResourcePrivileges,getUserAllAvailableResources,querySessionByAgent} | S:点赞点踩枚举校验PraiseAndTreadEnum/FeedbackTypeEnum,先查热消息替换metadata,资源授权新旧表兼容查询,按当前用户隔离,分页PageInfo,I18n异常
TemplateSessionController.java[CC7PM]: F:模板会话管理,保存/更新/分页查询/详情/消息编辑/删除模板及模板类型查询(分页支持匿名访问) | R:TemplateSessionService,ByaiSystemConfigService,CurrentUserHolder,ResponseUtil | A:/api/v1/template-sessions/{saveOrUpdateTemplate,page,getTemplateSessionDetail,editTemplateMessage,deleteTemplateSession,getTemplateTypes} | S:平台管理员鉴权,multipart上传封面,异常交全局处理器,TEMPLATE_TYPE系统配置

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/manage/dto/===
SystemConfigClearCacheRequest.java[DSY5CT]: F:系统配置缓存清除请求参数,按参数类型或代码清除缓存
SystemConfigListResponse.java[DSY5S]: F:系统配置列表响应,含去重参数类型与参数代码列表
TemplateSessionDetailRequestDto.java[DA5VS]: F:模板会话详情查询请求DTO,含会话ID及非空校验
TemplateSessionSaveRequestDto.java: F:模板会话保存请求,含模板标题/类型/封面/消息ID列表/做同款配置

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/men/===
MenTaskController.java[CT7KBM]: F:待办任务控制器,任务分页查询/修改/资源组件CRUD/创建会话/工作空间父任务查询 | R:MenTaskService,MenResComService,MenTaskStatusEnum,ResponseUtil,I18nUtil | A:/menTaskController/{listTasksByPage,updateTask,updateResCom,createTaskConversation,getResCom,listTasksBySessionPage,getResComList,listTasksByPTask} | S:参数校验+i18n错误码,外部系统taskExtId+systemNo校验,状态枚举校验,批量资源组件,会话/父任务双维度查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/message/dto/===
MessageShareLinkCreateRequest.java[DD5VS]: F:消息分享链接创建请求,含消息ID列表/标题/有效期/访问权限
MessageShareLinkResponse.java[DC3ST]: F:消息分享链接返回VO,含消息列表/标题/生成时间

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/message/===
MessageShareController.java[CCH5M]: F:消息分享链接接口,生成分享token与校验访问 | R:MessageShareService,MessageShareLinkCreateRequest,MessageShareLinkResponse,ResponseUtil,I18nUtil | A:POST /chat/message/share-link,GET /chat/message/share-link/access | S:多消息生成安全可控分享链接,过期天数/最大访问次数/权限/标题控制,token校验返回messageIds,异常分级捕获

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/mode/===
ModeController.java[CC7TS]: F:查询模式与数字员工关联列表 | R:ModeService,ModeDto,ResponseUtil | A:GET /mode/getModeList | S:RestController,委托service返回关联列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/notification/===
NotificationController.java[CCO5PM]: F:通知批量已读控制器,设置当前用户接收的通知为已读 | R:NotificationService,CurrentUserHolder,NotificationReadDto,ResponseUtil | A:POST /notification/batchSetNotificationRead | S:当前用户ID校验,read=ALL全量或idList指定,参数校验,返回更新条数

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/openapi/===
OpenApiConversationController.java[CCH8OM]: F:免登录开放API会话文件读写与会话/消息CRUD | R:OpenApiConversationApplicationService,MessageService,ConversationWriteTxtQo,ConversationReadQo,ExternalMessageVo | A:/open/api/v1/conversation/{writeTxt,appendTxt,read},/open/api/v1/{createSession,updateSession,addOrUpdateMessage,qrySessionsByQo,qryMessagesByQo},/open/api/deleteMessage | S:read走StreamingResponseBody流式输出,MinIO桶按.sessions/{sessionId}/{filePath}定位,异常转译为fail响应,@ManageLogAnnotation审计
OpenApiInnerController.java[CCH7L]: F:内部开放API聊天消息查询接口 | R:ByaiMessageHotService,MessageQo,ByaiMessageHotDto,ResponseUtil | A:POST /open/api/inner/getMessages | S:内部接口获取热消息列表,委托ByaiMessageHotService.getMessages
OpenApiPythonParamController.java[CCH5S]: F:OpenAPI暴露Python环境参数与联网参数获取接口 | R:ParamService,ChatUtils,ResponseUtil | A:GET /open/api/python/params | S:按modelAnswerMessageId取env,组装connect_params返回
OpenApiResourceController.java[CEM5M]: F:对外开放API控制器,免登录查询资源/数字员工列表详情技能、工作空间文件上传下载、知识库目录列表 | R:ResourceApplicationService,OpenResourceApplicationService,DatasetApplicationService,AssistantChatApplicationService,FilesApplicationService | A:/open/api/v1/{getResourceListByPage,queryDigEmployeeList,queryDigEmployeeDetail,queryDigEmployeeSkills,getUserAuthResource,dataset/listDir,uploadFileToWorkSpace,downloadFromWorkSpace} | S:免登录开放接口,分页查询,文件上传至工作空间走会话,文件下载流式响应,ManageLog审计
OpenApiWorkspaceArchiveController.java[CFI7OM]: F:内部数字员工workspace归档文件的上传/状态查询/流式下载/删除 | R:WorkspaceArchiveApplicationService,WorkspaceArchiveDto,ResponseUtil | A:/open/api/inner/v1/workspace-archive/dig-employees/{resourceId}[POST,DELETE,GET],/{resourceId}/status[GET] | S:按userCode+resourceId+archiveKind隔离,MultipartFile上传带sha256校验,StreamingResponseBody流式下载gzip,archiveKind默认cancel_auth

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/resource/===
ResourceManController.java[CFP7N]: F:资源管理控制器,查询资源详情/插件文档库/数字员工目录树/任务文件清单 | R:ResourceApplicationService,SsResourceCatalogService,ResourceDetailQo,CatalogQo,ResourceDetailVo,ResponseUtil | A:/resource/queryResourceDetail,/queryCatalogTree,/getTaskFileList | S:POST查资源详情返ResourceDetailVo,按权限查知识库目录树,按标签匹配模式searchFilesByTags获取会话/任务文件
ToolManController.java[CAC9OL]: F:工具/资源超市统一管理控制器,curl解析生成/工具JSON导入/对象视图zip导入/资源增删改查恢复/skill与个人agent档案上传下载/MCP工具调用 | R:ToolManService,ResourceApplicationService,ByClawFileQueryApplicationService,ByClawSkillUploadApplicationService,ByClawSkillDownloadApplicationService,ByClawSkillDeleteApplicationService,ByClawPersonalAgentArchivApplicationService,SsResExtMcpService,CurrentUserHolder | A:/tool/parseCurl,/generateResourceCurl,/runResourceCurl,/saveTool,/importToolJson,/addToolFromThird,/importObjectZip,/importViewZip,/deleteResource,/deleteResourceByCodeAndOwnerType,/deleteResourceById,/restoreResourceById,/deleteResourceAndAllRel,/queryResourceDetail,/updateResourceBasicInfo,/qryByClawFileByUserCode,/qrySkillListByUserCode,/uploadSkillZip,/downloadSkillZip,/deleteSkill,/qryPersonalAgentArchiveList,/uploadPersonalAgentTarGz,/downloadPersonalAgentTarGz,/deletePersonalAgentTarGz,/listUserSpace,/mcp/listTools,/mcp/callToolRequest | S:MultipartFile批量导入幂等写主表子表+FTP同步,zip流式下载RFC5987文件名编码,userCode缺省回退当前登录用户按MinIO桶隔离,body优先query兜底参数解析,三态异常分级返回,I18nUtil国际化
WaManagerController.java[CEM7OS]: F:智能体公共文件预览接口,从MinIO按桶名文件名获取图标流 | R:HttpServletResponse | A:/WaManagerService/commonFile/preview,/knowledge/WaManagerService/commonFile/preview | S:GET预览,style指定下载类型MINIO,bucketName+fileName定位,空实现待补,响应流输出

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/searchask/===
SearchAskController.java[CC7WT]: F:搜问聊天与最近会话查询接口 | R:SearchAskApplicationService,CompletionsUtils,SearchAsk,RecentlySearchAskQo,ResponseUtil | A:/searchAsk/chat,/searchAsk/queryRecentlySearchAsk | S:SSE流式输出聊天,setResHeader写OutputStream,分页查询最近会话,IOException转BaseException国际化提示
SpaceDriController.java[CK7UM]: F:搜问目录空间资源管理,导入文件/知识库/技能/收藏夹及资源选择 | R:SpaceDriApplicationService,ResponseUtil | A:/spaceDir/{listImportResource,importFiles,listPersonalKb,listEnterpriseKb,listCollectResource,listSkills,importSelectedDataset,selectedResource,unSelectedResource} | S:个人/企业知识库分查,MultipartFile多文件上传带sessionId/agentId,资源选择与取消
WebSearchArchiveController.java[CKNW7OM]: F:联网搜索归档控制器,DocChain搜索后爬取URL转MD上传归档并按会话反查 | R:WebSearchArchiveApplicationService,ResponseUtil,ManageLogAnnotation | A:POST /web-search/query,/archive-selected,/session-archive | S:query返requestId+文本列表,archiveSelected勾选爬取转MD上传落库byai_files,sessionArchive按sessionId反查归档及文件信息

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/showcase/dto/===
ShowcaseCancelRequest.java[DCOR5]: F:成果空间取消收藏请求参数(会话ID/成果类型/文件编码/消息ID)
ShowcaseCreateRequest.java[DCOR5S]: F:成果空间创建请求,含会话/类型/文件/数字员工等字段及校验
ShowcaseDetailResponse.java[DCOR5T]: F:成果空间详情响应,含基础信息与属性Map
ShowcaseRenameRequest.java[DCO7T]: F:成果空间重命名请求参数
ShowcaseUpdateRequest.java[DCA5T]: F:成果空间更新请求参数,含ID/会话/类型/内容/文件信息/数字员工标识
ShowcaseQueryRequest.java: F:成果空间查询请求体(分页/关键字/会话/任务过滤)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/showcase/===
ShowcaseController.java[CVC7M]: F:成果空间增删改查/重命名/取消收藏/列表分页及保存到知识库、查询消息位置 | R:ShowcaseService,MessageService,ByaiShowcaseVo,ShowcaseCreateRequest,FileUploadDto,MessageQo,ResponseUtil | A:/showcase/{create,update,rename,delete,cancelCollect,list,saveToDoc,getChatHistory,messages/count},GET /showcase/{id} | S:RESTful,@Valid参数校验,PageInfo分页,DTO脱敏返回ShowcaseDetailResponse.from

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/sys/===
SysAppVersionController.java[CSY5S]: F:应用版本信息查询接口,按设备类型获取最新版本 | R:SysAppVersionService,SysAppVersion,ResponseUtil | A:GET /api/v1/appVersion/latest | S:支持iOS/Android设备类型,deviceType参数查询,ResponseUtil统一响应
SysConfigController.java[CB5VS]: F:系统静态配置参数查询接口,按分组码/参数码/批量码获取系统配置 | R:ByaiSystemConfigService,MapParamUtil,ResponseUtil,ByaiSystemConfig,ByaiSystemConfigList | A:/system/staticdata/{getDcSystemConfigListByStandType,getDcSystemConfigValueByCode,getDcSystemConfigValueByCodes} | S:POST全接口,Map入参,参数空校验fail,委托service查询

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/workspace/===
SessionWorkspaceController.java[CCH7VM]: F:会话工作区管理(创建/批量创建/保存成果空间/列表/删除/改名) | R:SessionWorkspaceService,ResponseUtil,SessionWorkspaceCreateRequest | A:POST /workspace/{create,createBatch,saveToShowcaseBatch,list,delete,updateName} | S:REST控制器,@Valid参数校验,批量写工作区记录,按sessionId查询,工作区文件归类入成果空间

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/aimodel/===
ByaiAimodelMapper.xml[MM5BM]: F:AI模型表MyBatis映射,按条件分页查询/名称去重统计/标签关联列出模型 | R:ByaiAimodelMapper.java,ByaiAimodel.java | A:- | S:byai_aimodel,LEFT JOIN byai_tag_relation产出is_default,tag_id=1/3区分默认与可用,keyword多字段LIKE,ability子查询EXISTS,PageHelper分页

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/auth/===
PrivilegeGrantMapper.xml[MB9PME]: F:权限授权SQL映射,资源/数字员工授权查询、红黑名单成员统计、可管理资源、订阅数、多维度授权过滤 | R:PrivilegeGrantMapper.java,PrivilegeGrant,ResourceAuthVo,DigitalEmployeeAuthVo,AuthVo,PrivilegeGrantWithOrgPath | A:- | S:au_privilege_grant主表,联ss_resource/po_users/po_organization/po_position/po_station,RED/BLACK统计,ORG/USER/POST/STATION多隔离维度授权,path_code组织树过滤,pg/mysql方言INSTR/STRPOS,ALLOW_MANAGE/AVAILABLE_USE/FORCE_USE/OWNER授权类型
ResourceAuthContextMapper.xml[ME7PSM]: F:资源授权上下文查询,按用户/组织/岗位/工作站多维度黑白名单计算可用资源类型及资源详情 | R:ResourceAuthContextMapper.java,SsResource,AuthResourceType | A:- | S:getAuthResourceType红黑名单SUM聚合排黑,grant_to_obj_type多维OR匹配ORG/USER/POST/STATION,getResourceByIds批量,getDatasetByDigEmployeeIds数字员工知识集KG_DOC/KG_QA/KG_TERM关联

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/conversation/===
FeedbackMsgInfoMapper.xml[MCH8BTS]: F:会话反馈消息批量入库SQL映射 | R:FeedbackMsgInfoMapper.java,FeedbackMsgInfo | A:- | S:saveBatch批量insert,foreach拼接,反馈处理/指派字段

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/customer/===
ByaiCustomerLeadsMapper.xml[MO5BS]: F:客户线索数据持久化SQL,单条与批量插入 | R:ByaiCustomerLeadsMapper.java,ByaiCustomerLeads | A:- | S:insertLead单条插入,insertBatch foreach批量插入,公司/联系人/行业/电话/微信/需求字段映射

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/datacloud/===
DatacloudLoginTypeMapper.xml[MOB5MM]: F:数据云登录类型Mapper-SQL实现,提供分页查询/启用类型列表/编码唯一校验/脚本数统计/批量删除 | R:DatacloudLoginTypeMapper.java,DatacloudLoginType,DatacloudLoginTypeDTO | A:- | S:多租户enterprise_id隔离,LEFT JOIN datacloud_script聚合script_count,GROUP BY,模糊查询,batchDelete用foreach,统计聚合CASE WHEN
DatacloudScriptCategoryMapper.xml[MOB5NM]: F:数据云脚本分类Mapper,支持分页/树形/子分类查询、编码校验、脚本与子分类计数统计、批量删除 | R:DatacloudScriptCategoryMapper.java,DatacloudScriptCategory,DatacloudScriptCategoryDTO | A:- | S:多表LEFT JOIN聚合script_count/child_count,enterprise_id租户隔离,树形按category_level排序,foreach批量删除,checkCategoryCodeExists唯一校验
DatacloudScriptExecutionMapper.xml[MOB7MM]: F:数据云脚本执行记录SQL映射,分页/按脚本ID查询执行记录及多维统计(成功/失败/时长/状态分布) | R:DatacloudScriptExecutionMapper.java,DatacloudScriptExecution,DatacloudScriptExecutionDTO | A:- | S:JOIN script/sys_user带script_name与executor_name,enterprise_id租户隔离,COUNT/AVG/GROUP BY统计,批量删除,LIMIT分页
DatacloudScriptMapper.xml[MD5MM]: F:数据云自动化脚本SQL映射,分页/场景/分类/模板/标签查询及执行统计聚合与批量删除 | R:DatacloudScriptMapper.java,DatacloudScript,DatacloudScriptDTO,DatacloudScriptQO | A:- | S:多表LEFT JOIN(scenario/category/po_users),执行次数子查询统计,租户enterprise_id隔离,COUNT分组热门排序,batchDelete带租户校验
DatacloudScriptScenarioMapper.xml[MOB7KBM]: F:数据云脚本场景表SQL映射,支持分页查询/递归CTE树形结构/子场景查询/编码查重/脚本与子场景计数/批量删除 | R:DatacloudScriptScenarioMapper.java,DatacloudScriptScenario,DatacloudScriptScenarioDTO | A:- | S:WITH RECURSIVE递归构建场景树,LEFT JOIN登录类型,enterprise_id多租户隔离,scenario_order排序,批量删除带租户校验
DatacloudScriptStepMapper.xml[MOB7KBM]: F:数据云脚本步骤Mapper-SQL,分页/按脚本ID查步骤、步骤顺序批量更新、步骤及类型统计、批量删除 | R:DatacloudScriptStepMapper.java,DatacloudScriptStep,DatacloudScriptStepDTO | A:- | S:LEFT JOIN datacloud_script取script_name,enterprise_id租户隔离,batchUpdateStepOrder用CASE WHEN批改step_order,statistics聚合is_active/is_required计数
**纠正**: C维度应为业务数字。Mapper-XML属辅助配置,且C锚点须为数字。重输:

DatacloudScriptStepMapper.xml[MM5BM]: F:数据云脚本步骤Mapper-SQL,分页/按脚本ID及类型查步骤、批量更新步骤顺序、步骤与类型统计、批量删除 | R:DatacloudScriptStepMapper.java,DatacloudScriptStep,DatacloudScriptStepDTO | A:- | S:LEFT JOIN datacloud_script取script_name,enterprise_id租户隔离,batchUpdateStepOrder用CASE WHEN批量改step_order,聚合is_active/is_required计数统计
DatacloudScriptTemplateMapper.xml[MOB5KS]: F:数据云脚本模板SQL映射,分页查询与可用模板查询 | R:DatacloudScriptTemplateMapper.java,DatacloudScriptTemplate | A:- | S:BaseResultMap全字段映射,按template_type/framework/enterprise_id条件过滤,is_active=1筛可用,create_time倒序,租户隔离
DataCloudScriptViewMapper.xml[MES7KM]: F:数据云脚本视图Mapper,分页查询脚本场景视图列表 | R:DataCloudScriptViewMapper.java,DatacloudScriptTemplate,DataCloudViewScriptDTO | A:- | S:三表left join(脚本场景/脚本/登录类型),按视图ID过滤,关键字模糊匹配场景名脚本名,创建时间倒序

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/enterprise/===
EnterpriseInfoMapper.xml[MOR5M]: F:企业信息数据访问获取最大企业ID | R:EnterpriseInfoMapper.java,po_enterprise_info | A:- | S:MyBatis映射,max(enterprise_id)查询,组织域企业表

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/file/===
FilesMapper.xml[MFI5BS]: F:文件表SQL映射,按聊天ID与标签匹配查询及批量插入归档 | R:FilesMapper.java,UploadFilesRespDto | A:- | S:byai_files表,string_to_array标签数组any/all匹配(&&/@>),insertBatch兼容MySQL/PG,resultMap映射上传响应

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/index/===
IndexMapper.xml[MEM5PM]: F:首页索引数据访问层,授权数字员工/知识文档/工具的红黑名单权限聚合查询与会话资源映射 | R:IndexMapper.java,AuthDigitEmployVo,DigitEmployMarketVo,DigitEmployMarketExtVo,AuthResourceVo,SessionMemberResourceVo,DepartmentRangeVo,ManPrivVo | A:- | S:selectAuthDigitEmploy/queryMyUsual/queryRecentlyAdded/queryMyCreated/discover授权数字员工列表,au_privilege_grant按ORG/USER/POST/STATION多维权限聚合(红黑名单/FORCE_USE/AVAILABLE_USE),metaStatus(已授权/已过审/审核中/可申请)与permission(我创建/授权我/待我审批/我申请)筛选,置顶+使用频次排序,queryAuthDoc/queryAuthTools知识工具授权,findMyDepartmentRange/findManPrivVo/findTopOrgId组织管理员,多租户用户隔离

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/log/===
ManageLogMapper.xml[MAU3M]: F:管理操作日志 SQL 映射,定义操作日志结果映射(模块/操作人/IP/参数响应/时间) | R:ManageLog.java,ManageLogMapper.java | A:- | S:resultMap 映射,operatorParam/Response 为 CLOB,操作人与IP记录,审计日志持久化
TrackLogMapper.xml[MA7M]: F:埋点日志Mapper映射文件(空) | R:TrackLogMapper.java | A:- | S:MyBatis映射,审计日志,当前无SQL定义

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/memory/===
MemoryLibraryMapper.xml[MEM5M]: F:数字员工记忆库数据持久化SQL,按用户/员工查询及删除记忆库 | R:MemoryLibraryMapper.java,MemoryLibrary.java | A:- | S:resultMap映射library_id等10字段,selectByUserIdAndAgentId按agent+type查单条,selectByAgentId查列表,deleteByAgentId删除,memory_library表
ResourceRuleEnabledMapper.xml[MKN5MM]: F:资源规则启用状态表MyBatis映射,按资源/模版/用户增删改查及禁用记录查询 | R:ResourceRuleEnabledMapper.java,ResourceRuleEnabled.java | A:- | S:resource_rule_enabled表,insert/updateById动态set/deleteById,selectByResourceIdAndTemplateIdAndUserId,selectDisabledByResourceIdAndUserId,按用户隔离

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/men/===
MenResComMapper.xml[MEC5TS]: F:任务卡片资源(res_com)数据访问,支持按子任务查父任务卡片及固定记忆任务列表 | R:MenResCom.java,FixedMemoryMemoryTaskVo.java,men_task | A:- | S:getParentResComBySubTaskExtId三表JOIN(men_task自连+men_res_com)按systemNo/taskExtId定位父卡片,selectFixedMemoryMemoryTaskVoByQo查FIXMEMORY类型任务按createBy过滤倒序
MenTaskCatalogMapper.xml[MM5BS]: F:任务目录Mapper SQL,批量插入任务目录记录 | R:MenTaskCatalogMapper.java,MenTaskCatalog | A:- | S:batchInsert foreach批量插入,含租户com_acct_id与task_id隔离
MenTaskMapper.xml[MM7KK]: F:待办任务SQL映射,分页查询/状态统计/父子任务/资源关联/外部任务查询/删除 | R:MenTaskMapper.java,MenTask,MenTaskVo | A:- | S:多表left/inner join(men_res_com/men_task_rec_obj/po_users/ss_resource/ss_res_ext_dig_employee),STRING_AGG聚合接收对象名,statusCdList/resourceBizTypeList动态in,limit/offset分页,MY_INITIATED发起人逻辑分支,res_page like匹配resourceId,countTasksByStatus分组统计
MenTaskRecObjMapper.xml[MMA5BM]: F:任务接收对象Mapper,按任务ID查询/批量插入/删除接收对象及关联用户信息 | R:MenTaskRecObj.java,MenTaskRecObjVo.java,MenTaskRecObjMapper.java | A:- | S:men_task_rec_obj表CRUD,insertBatch批量插入,selectTaskResUserByTaskId关联po_users取HUMAN类型用户code/name,com_acct_id租户隔离
MenTaskStatusLogMapper.xml[MAT5L]: F:长程任务状态日志Mapper,按任务ID删除状态日志 | R:MenTaskStatusLogMapper.java | A:- | S:MyBatis XML,deleteByTaskId单方法,men_task_status_log表

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/message/===
ByaiMessageMapper.xml[MAH5KM]: F:消息持久化SQL映射(会话/任务/分页/批量插入/热数据更新) | R:ByaiMessageMapper.java,ByaiMessage.java,ByaiMessageHotDto | A:- | S:byai_message表CRUD,selectBySessionId/TaskId/MessageId,insertBatch批量,updateByMessageId热数据毫秒戳转timestamp,selectByQo关键字LIKE通配,countPositionInSession消息定位
ByaiMessageRelMapper.xml[MCO5K]: F:消息关联对象记忆库SQL映射,问答消息对单插/批插/按relId查删改/反馈更新/多维条件分页检索 | R:ByaiMessageRel | A:- | S:byai_message_relobj表,insertBatch批量,updateFeedbackByMessagePair按问答msgId对更新反馈,SearchMemWhere动态条件含时间区间/关键词LIKE/分数范围,selectSearchMemPage动态排序字段+方向,countSearchMem计数
MessageShareLinkMapper.xml[MCH5M]: F:消息分享链接Mapper-XML,提供插入/按token查询/访问计数自增 | R:MessageShareLinkMapper.java,MessageShareLink | A:- | S:message_share_link表,BaseResultMap映射13字段含com_acct_id租户隔离,incrementAccessCountAndUpdateTime原子自增访问次数
MessageShareLinkMessageMapper.xml[MCH5BT]: F:会话消息分享链接关联映射,管理分享链接与消息的多对多关系 | R:MessageShareLinkMessage,MessageShareLinkMessageMapper.java | A:- | S:insert单条插入,insertBatch批量foreach插入,selectMessageIdsByLinkId按linkId查消息ID列表按id排序,含com_acct_id多租户隔离

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/mode/===
ByaiModeMapper.xml[MCO5M]: F:模式与数字人资源关联查询SQL映射 | R:ByaiModeMapper.java,ByaiMode,ModeRelationDto | A:- | S:selectRelationByModeCode三表LEFT JOIN(mode_dig_rel/mode/ss_resource),selectList查模式列表,modeCode动态条件

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/monitor/===
MonitorTargetMapper.xml[MSY5BM]: F:监控目标SQL映射,按agentId查询/按类型排除删除/低质量目标筛选 | R:MonitorTargetMapper.java,MonitorTarget.java | A:- | S:byai_monitor_target表,BaseResultMap,foreach排除删除,target_quality阈值查询

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/notification/===
ByaiNotificationMapper.xml[MCO5BKM]: F:通知消息持久化SQL映射,批量插入/分页查询/批量已读/全部已读 | R:ByaiNotificationMapper.java,ByaiNotification | A:- | S:BaseResultMap字段映射,selectNotificationPage多条件动态过滤(标题内容模糊/时间区间CAST DATE/资源IN),按已读状态排序,batchSetNotificationRead带target_id隔离,is_deleted逻辑删除

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/ontology/===
ByaiDbresourceRelMapper.xml[MOB5BS]: F:数据库资源与业务对象关联关系映射,按对象/记录ID增删查 | R:ByaiDbresourceRel,ByaiDbresourceRelMapper.java | A:- | S:byai_dbresource_rel表,findByObjId/RecordId查询,deleteByObjId/RecordId,insertBatch多库方言(MySQL/Oracle/PG)兼容
SsResExtOntologyMapper.xml[MOB5BS]: F:本体资源扩展信息SQL映射,资源ID与项目ID关联查询/增删 | R:SsResExtOntology,SsResExtOntologyMapper.java | A:- | S:ss_res_ext_ontology表,按resourceId/pid查询,批量插入insertBatch,批量删除deleteByResourceIds

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/operations/===
QueryConfigMapper.xml[MVO5M]: F:运营查询配置SQL映射,按编码查配置/执行动态SQL模板/列出启用配置 | R:QueryConfigMapper.java,QueryConfig,QueryConfigListDTO | A:- | S:selectByQueryCode/AndType按status=1查询,executeDynamicSql用${sqlTemplate}拼接动态SQL,selectAllConfigList列表不含SQL模板

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/organization/===
OrganizationMapper.xml[MO5KM]: F:组织机构SQL映射,组织树/层级路径/成员/上级关系查询 | R:OrganizationMapper.java,Organization.java,OrgTreeVo.java,UsersOrganization.java,OrgManagerVo.java | A:- | S:path_code路径码递归查上下级,string_agg拼路径名,strpos定位树层级,授权管理员查询关联au_privilege_grant,租户隔离

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/permissiongroup/===
AuthorizedObjectDataPermissionMapper.xml[MP5BM]: F:授权对象数据权限SQL映射,按权限组/用户查询授权对象数据权限并关联授权对象与用户表 | R:AuthorizedObjectDataPermissionMapper.java,AuthorizedObjectDataPermission,AuthorizedObjectDataPermissionVO | A:- | S:JOIN authorized_objects/po_users,batchInsert/batchDelete,status=active过滤,按object_type排序
AvailableObjectMapper.xml[MPER7KM]: F:权限组可授权对象(用户/组织)查询SQL映射,标记已授权状态 | R:AvailableObjectMapper.java,AvailableObjectVO,AvailableObjectQO | A:- | S:用户/组织分页与全量列表,EXISTS子查询判authorized,关联po_users/po_organization/permission_group_authorized_objects,objectName模糊+orgId过滤,LIMIT100
DefaultDataPermissionMapper.xml[MPM5S]: F:默认数据权限SQL映射,按权限组查询(含范围类型中文转换)/删除 | R:DefaultDataPermissionMapper.java,DefaultDataPermission,DataPermissionVO | A:- | S:default_data_permissions表,data_scope_type枚举CASE映射(self/org/position/station),按permission_group_id查询active状态及批量删除
LogExceptionInfoMapper.xml[MMP5BS]: F:资源属性权限SQL映射,查询/删除/批量插入资源属性权限 | R:PermissionGroupResourceAttributeMapper.java,ResourceAttributePermissionVO | A:- | S:namespace实为PermissionGroupResourceAttributeMapper,selectByResourceId联查ss_resource与ss_res_ext_attribute,deleteByResourceId,batchInsert foreach,VO结果映射
PermissionGroupAuthorizedObjectMapper.xml[MPE7BKL]: F:权限组授权对象SQL映射,授权对象/用户分页查询及批量增删,跨user/org/position/station多类型授权解析与排除对象过滤 | R:PermissionGroupAuthorizedObjectMapper.java,PermissionGroupAuthorizedObject,AuthorizedObjectVO,AuthorizedUserVO | A:- | S:UNION聚合user/org/position三类授权用户去重,NOT EXISTS过滤排除对象,CASE映射对象类型名,关联authorized_object_data_permissions判hasExtPer扩展权限,batchInsert/batchDeleteByIds批量,permissionGroupIds IN多组查询,userScope范围筛选
PermissionGroupCategoryMapper.xml[MPM5KM]: F:权限组目录Mapper SQL,分页/列表/详情查询及递归子目录查询、编码名称去重校验、目录树形展示 | R:PermissionGroupCategoryMapper.java,PermissionGroupCategoryVO,CatalogSimpleVO | A:- | S:permission_group_categories表,LEFT JOIN po_users/po_organization,WITH RECURSIVE递归查子目录,子查询统计权限组数,org_id多租户隔离,同级名称唯一校验
PermissionGroupExcludedObjectMapper.xml[MM5BS]: F:权限组排除对象关联SQL映射,分页/批量增删/按对象类型查排除用户组织岗位ID | R:PermissionGroupExcludedObjectMapper.java,PermissionGroupExcludedObject.java,AuthorizedObjectVO.java | A:- | S:关联po_users/po_organization取名,object_type枚举映射中文,batchInsert/batchDeleteByIds批量,countByObject去重校验,按权限组ID删除
PermissionGroupMapper.xml[MPE5M]: F:权限组SQL映射,分页/列表/详情/编码名称查重/含目录信息查询 | R:PermissionGroupMapper.java,PermissionGroupVO,PermissionGroupWithCatalogVO,CatalogSimpleVO | A:- | S:permission_groups关联po_organization/po_users/permission_group_categories,授权对象计数子查询,目录信息association映射,模糊查询排序
PermissionGroupResourceAttributeMapper.xml[MM5BL]: F:资源属性权限SQL映射,按资源ID查询/删除及批量插入属性数据范围权限 | R:PermissionGroupResourceAttributeMapper.java,ResourceAttributePermissionVO | A:- | S:关联ss_resource/ss_res_ext_attribute,data_scope_type数据范围,foreach批量insert
PermissionGroupResourceMapper.xml[MPB5KBM]: F:权限组资源关联Mapper,管理权限组对资源的授权关系 | R:PermissionGroupResourceMapper.java,PermissionGroupResource,PermissionResourceVO | A:- | S:按权限组ID查/删资源,批量插入/删除,分页查授权资源(联ss_resource/po_users),按资源ID反查权限组,permissionType为List需聚合

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/pluginmodule/===
DigitalEmployeeMapper.xml[MEMP7S]: F:数字员工Mapper XML映射,按员工编码查询及存在性校验 | R:DigitalEmployeeMapper.java,DigitalEmployee.java | A:- | S:BaseResultMap结果映射,selectByCode/existsByCode,digital_employee表
FunctionMenuPermissionMapper.xml[MEM5BS]: F:数字员工功能菜单权限Mapper,批量插入与按员工ID查询权限 | R:FunctionMenuPermission.java | A:- | S:batchInsert批量foreach,selectByEmployeeId查菜单权限,permission_type权限类型

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/position/===
PositionExtCatalogMapper.xml[MPO5BL]: F:数字岗位与领域关系映射,岗位名重复校验/批量插入/岗位领域关联双向查询 | R:PositionExtCatalogMapper.java,PositionExtCatalog,DigitalPositionDTO,CatalogWithPositionsDTO | A:- | S:po_position_ext_catalog关系表,collection嵌套映射岗位↔领域,countPositionNameInCatalogs去重,saveBatch批量,is_digital_position=1过滤,catalog_type=6领域
PositionMapper.xml[MPO5KM]: F:岗位Mapper SQL映射,岗位列表/岗位用户/计数/用户岗位查询,兼容PG数组聚合与MySQL GROUP_CONCAT | R:PositionMapper.java,Position,PositionDTO,PositionUsersVo | A:- | S:po_position/po_users/po_users_organization多表join,is_digital_position=0过滤普通岗位,keyword模糊搜索,databaseId方言分支,org负责人ORG_MAN关联
PositionUserRelationMapper.xml[MPO5KS]: F:数字岗位与管理员用户关系SQL映射,分页查询岗位下用户及其组织/类型聚合并批量保存关系 | R:PositionUserRelationMapper.java,PositionUserRelation,PositionUsersVo | A:- | S:selectUsersByPositionIdPage按pg/mysql分库聚合orgIds与userTypes(ARRAY_AGG/GROUP_CONCAT),关联po_users及po_users_organization,userName模糊分页,saveBatch批量insert
ResourcePositionRelationMapper.xml[MPO5KM]: F:岗位-资源关联Mapper,分页查询岗位下数字员工(关联资源表) | R:ResourcePositionRelationMapper.java,ResourcePositionRelation,PositionDigitalEmployeeVo | A:- | S:ss_res_position_relation联ss_resource,过滤DIG_EMPLOYEE,按resourceName模糊,create_time倒序

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/resource/===
AiModelMapper.xml[MM5KM]: F:AI模型MyBatis映射,查询全部模型列表 | R:AiModelMapper.java,AiModel.java | A:- | S:selectAllAiModels查byai_aimodel表全字段按create_time倒序
SsResExtAgentMapper.xml[MEM57M]: F:外部Agent资源扩展表映射,按ID批量联查资源主表与Agent扩展信息 | R:SsResExtAgentMapper.java,SsResExtAgent.java,ResourceExtAgentDto.java,SsResourceMapper.xml | A:- | S:resultMap关联ss_resource与ss_res_ext_agent,findResourceExtAgentByIds按resourceIds foreach左联查询,过滤resource_biz_type=AGENT
SsResExtAttributeMapper.xml[MOB7BL]: F:资源扩展属性SQL映射,按资源ID查询及批量增改 | R:SsResExtAttributeMapper.java,SsResExtAttribute | A:- | S:selectByResourceId(s)/AndType,insertBatch,updateBatch(CASE WHEN批量更新),按sort排序
SsResExtDbDatasetMapper.xml[MM5BS]: F:数据库数据集资源扩展表MyBatis映射,按资源ID单查/列表查/批量查 | R:SsResExtDbDataset.java,SsResExtDbDatasetMapper.java | A:- | S:ss_res_ext_dbdataset表,selectByResourceId(LIMIT1),selectListByResourceId,selectListByResourceIds(foreach IN批量)
SsResExtDbMapper.xml[MKB5TM]: F:外部数据库资源扩展表MyBatis映射,关联查询ChatBI数据库资源 | R:SsResExtDb.java,ResourceExtDbDto,SsResourceMapper | A:- | S:findResourceExtDbByIds按ID批量查询,ss_resource左联ss_res_ext_db,过滤resource_biz_type=KG_DB,resultMap嵌套association
SsResExtDigEmployeeMapper.xml[MEM5KM]: F:数字员工资源扩展Mapper-XML,企业/个人数字员工分页查询、详情、批量与开放接口查询及权限隔离 | R:SsResExtDigEmployeeMapper.java,SsResEx tDigEmployee,DigitalEmployeePageVo,DigitalEmployeeVo,DigitalEmployeeDTO,ResourceExtDigEmployeeDto,SsResourceMapper.xml | A:- | S:多库prologue-JSON抽modelId(pg/mysql/oracle),au_privilege_grant黑白名单/强制可用/可管理三授权聚合,owner_type企业/个人/默认隔离,permission四态(我创建/授我/待审/我申请),按userOrgIds/userId/positionIds/stationId多维授权过滤,关键词模糊+catalog/system过滤,machine_channel机器渠道筛选
SsResExtDocMapper.xml[MKB7M]: F:知识文档资源扩展表Mapper,按资源ID批量查询文档库扩展数据及JOIN主资源表 | R:SsResExtDocMapper.java,SsResExtDoc,ResourceExtDocDto,SsResourceMapper.xml | A:- | S:findResourceExtDocByIds关联ss_resource查KG_TERM/QA/DOC/DB知识类型,selectListByResourceIds直查扩展表,foreach批量IN查询
SsResExtEvaluateMapper.xml[MEM7KS]: F:数字员工资源扩展评估结果Mapper,查最新评估及分页 | R:SsResExtEvaluate.java,SsResExtEvaluateMapper.java | A:- | S:selectLatestByResourceId按evaluate_time倒序LIMIT1,selectPageByQO按resourceId过滤分页,准确率/对话错误率/岗位匹配评分字段
SsResExtMcpServerMapper.xml[MM5ST]: F:MCP-Server资源扩展信息查询,按资源ID批量关联ss_resource主表查MCP服务配置 | R:SsResExtMcpServerMapper.java,SsResourceMapper.xml,SsResExtMcpServer,ResourceExtMcpDto | A:- | S:resultMap继承SsResourceMapper.BaseResultMap+association嵌套McpServer,findResourceExtMcpByIds左连接ss_res_ext_mcpserver,foreach批量IN,过滤resource_biz_type=MCP
SsResExtMcpToolMapper.xml[MTO5M]: F:MCP工具资源扩展表SQL映射,定义resultMap与基础列(resource_id/input_schema) | R:SsResExtMcpToolMapper.java,SsResExtMcpTool.java | A:- | S:MyBatis-XML,BaseResultMap,Base_Column_List,工具inputSchema字段映射
SsResExtTestSetMapper.xml[MQ5KM]: F:扩展资源测试集Mapper映射,按资源/批次查询及条件分页查询测试集记录 | R:SsResExtTestSetMapper.java,SsResExtTestSet,SsResExtTestSetVo | A:- | S:BaseResultMap/Vo双映射,process_status CASE转中文状态名,selectLatestByResourceId取最新非失败记录,QO动态条件+时间范围,按create_time倒序
SsResExtToolKitMapper.xml[MTO5BS]: F:工具集扩展资源Mapper,查询工具集及其关联工具与HTTP扩展信息 | R:SsResExtToolKitMapper.java,SsResourceMapper.xml,ResourceExtToolKitDto,SsResExtTool | A:- | S:嵌套resultMap工具集→工具→ext三层映射,findResourceExtToolKitByIds多表LEFT JOIN(ss_resource/ss_res_ext_toolkit/ss_resource_rel_detail/ss_res_ext_tool),findToolKitIdByToolsId反查,selectListByResourceIds批量扩展查
SsResExtToolMapper.xml[MT5BM]: F:工具扩展资源Mapper-XML,批量查工具扩展数据及关联插件header/资源信息 | R:SsResExtToolMapper.java,SsResExtTool,SsResExtPluginToolDto,ResourceExtToolDto,SsResourceMapper.xml | A:- | S:findWithHeaderByResourceIds关联ss_resource_rel_detail与ss_res_ext_toolkit取headers,findResourceExtToolByIds联ss_resource按TOOL类型查,selectListByResourceIds纯扩展表批量查,foreach拼ID
SsResourceCatalogMapper.xml[ME5KM]: F:资源目录Mapper-SQL,目录树查询/子目录/自身及后代ID/目录关联资源树 | R:SsResourceCatalogMapper.java,SsResourceCatalog,ResourceCatalogDto,CatalogDto,ResourceCatalogTreeVO | A:- | S:catalog_path递归层级查询,左连ss_resource/po_organization,catalogType过滤,keyword模糊,order_index排序,多租户com_acct_id字段
SsResourceMapper.xml[MOB7M]: F:资源元数据(数字员工/知识/工具/对象)统一存储与多维查询SQL,含分页/状态统计/关联资源/授权/数据集 | R:SsResourceMapper.java,SsResource,ResourcePageDto,DigEmployeeDto,DigitalEmployeeVo,DatasetVo | A:- | S:ss_resource主表多表LEFT JOIN(ext_agent/ext_doc/ext_dig_employee/catalog/organization),catalog_path树形LIKE ANY过滤,ownershipType我创建/我管理OR逻辑,动态排序sortFields,au_privilege_grant授权关联,suas_superassist_sub_agent置顶,批量insert,parent_resource_id=-1过滤子资源,多租户com_acct_id
SsResourceOperLogMapper.xml[EQ5MS]: F:资源操作日志Mapper的SQL映射,定义结果集与通用字段列 | R:SsResourceOperLog,SsResourceOperLogMapper | A:- | S:BaseResultMap映射操作类型/用户/参数/版本号,com_acct_id多租户隔离字段
SsResourceRelDetailMapper.xml[MO5BM]: F:资源关联明细Mapper,批量插入及按viewResourceId/resourceId多维查询关联资源 | R:SsResourceRelDetailMapper.java,SsResourceRelDetail,SsResourceRelDetailDTO,ResourceRelationDto | A:- | S:批量insert,JSON字段viewResourceId三库兼容(pg/mysql/oracle)增删查,LEFT JOIN ss_resource两次取关联类型,数字员工关联查询动态条件,按com_acct_id租户隔离
SsResourceVersionMapper.xml[MO5M]: F:资源版本表ORM映射,定义结果映射与通用列 | R:SsResourceVersion,SsResourceVersionMapper.java | A:- | S:BaseResultMap27字段,Base_Column_List,含com_acct_id租户隔离,version_no版本号,resource_status/version_status双状态

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/sandbox/===
SsSandboxRecordMapper.xml[MAB5LM]: F:沙箱记录持久化SQL,覆盖增删改查/状态机流转/租约续期/对账/超时释放 | R:SsSandboxRecordMapper.java,SsSandboxRecord,SandboxReconcileGroup | A:- | S:乐观锁lock_version+version双控,状态机(STARTING/RUNNING/RELEASING/RELEASED/FAILED),游标分页(cursorTime+cursorId避offset跳过),超时释放按last_access_time,续期next_renew_at扫描,对账分组聚合,按user_code多租隔离

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/scheduletask/===
ScheduleTaskMapper.xml[MTA5KM]: F:定时任务SQL映射,按ID查询任务VO含资源名与执行人名 | R:ScheduleTaskMapper.java,ScheduleTask.java,ScheduleTaskVo.java | A:- | S:BaseResultMap+VoResultMap,byai_schedule_task左连ss_resource与po_users,租户隔离

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/searchask/===
SpaceDirMapper.xml[MKB7BM]: F:搜索问答空间目录资源SQL映射,查导入/收藏/技能/知识库资源及企业知识库授权过滤 | R:SpaceDirMapper.java,SpaceResourceVo,SpaceKbResourceVo | A:- | S:多表union查WEB_SEARCH/IMPORT/COLLECT资源,批量插入兼容多库,企业知识库按ORG/USER/POST/STATION授权红黑名单过滤,会话与createBy隔离
SpaceDirRelMapper.xml[MKN5BT]: F:空间目录关联批量插入SQL映射 | R:SpaceDirRelMapper.java,SpaceDirRelDO | A:- | S:insertBatch批量插入byai_space_dir_rel,foreach拼接,兼容MySQL/Oracle/PG,字段dir_rel_id/dir_id/data_id/data_type/ext_json
WebCrawlDocArchiveMapper.xml[MKN5BT]: F:网络爬取文档归档SQL映射,支持单条/批量插入及按请求ID查询 | R:WebCrawlDocArchiveMapper.java,WebCrawlArchiveDoc.java | A:- | S:byai_web_crawl_archive_doc表,insertBatch用foreach兼容MySQL/PG,listByRequestId按docArchiveId升序
WebCrawlRequestMapper.xml[MK5TS]: F:网络爬取请求记录持久化映射(插入/按会话查询) | R:WebCrawlRequestMapper.java,WebCrawlRequest.java | A:- | S:byai_web_crawl_request表,insert/listBySessionId按createTime升序

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/session/===
ByaiSessionExtMapper.xml[MO5KM]: F:会话扩展参数MyBatis映射,按会话ID查询扩展参数列表 | R:ByaiSessionExt,ByaiSessionExtMapper | A:- | S:BaseResultMap映射,selectBySessionId按sessionId查询ext_id升序
ByaiSessionMapper.xml[MCH8MKM]: F:会话持久化SQL映射,会话列表/模板会话/最近搜索问答查询 | R:ByaiSessionMapper.java,ByaiSessionExtMapper,ByaiSession,ByaiSessionDto,TemplateSessionQueryResponseDto,RecentlySearchAskVo | A:- | S:LEFT JOIN ss_resource取头像,collection嵌套查sessionExts,多租户enterprise_id隔离,EXISTS子查模板类型/终端,动态排序create/update/name,关键词模糊,split(',')拆模板类型,is_debug=2标模板,排除DELETED态
ByaiSessionMemberMapper.xml[ME5KM]: F:会话成员SQL映射,按会话/对象/时间范围查成员、选择性更新、按Agent关联查会话 | R:ByaiSessionMemberMapper.java,ByaiSessionMember,ByaiSession | A:- | S:findSessionMember单条,findByMemObjIdAndTimeRange时间范围AGENT,querySessionByAgent子查询关联+keyword模糊,updateSelective动态字段,com_acct_id多租户

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/showcase/===
ByaiShowcaseMapper.xml[MOB5BKM]: F:作品展示成果物Mapper的SQL实现,增删改查与按条件分页查询、状态批量更新 | R:ByaiShowcaseMapper.java,ByaiShowcase,ByaiShowcaseVo | A:- | S:insert/insertBatch批量插入,selectByCondition关联po_users取user_code按sessionId/type/agentId/taskId/messageIds/keyword过滤,updateStatusByCondition批量改状态,selectDeletedRecord查软删记录,按update_time降序

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/source/===
SourceSystemMapper.xml[MEO5M]: F:源系统数据访问，查询非BYAI源系统列表 | R:SourceSystem,SourceSystemMapper.java | A:- | S:MyBatis映射,baseResultMap字段映射,po_source_system表查询排除BYAI

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/staticdata/===
ByaiSystemConfigListMapper.xml[MSY5KS]: F:系统配置列表查询映射,按分组分页及详情查询 | R:ByaiSystemConfigList.java,SystemConfigListGroupVo,SystemConfigListDTO | A:- | S:分组聚合MAX去重,关键字LIKE模糊,collection一对多按param_seq排序
ByaiSystemConfigMapper.xml[MSC5M]: F:系统配置SQL映射,按查询条件检索系统配置列表 | R:ByaiSystemConfigMapper.java,ByaiSystemConfig,SystemConfigVo | A:- | S:resultMap继承,keyword多字段模糊匹配,param_id降序,cacheJson由Redis补充不映射

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/station/===
StationMapper.xml[MO5KS]: F:驻地组织树SQL映射,支持树查/用户驻地/路径递归查下属 | R:StationMapper.java,Station.java | A:- | S:po_station自关联station_id_path路径模糊匹配下属,inner join po_users按userId查驻地,getStationTree按父级/关键字/类型/海外多条件过滤

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/superassist/===
FeignPythonToolService.xml[MKN5M]: F:数字员工知识目录(SsSuperassistKwCatalog)表字段映射,含会话类型/数据集/目录关联及企业租户隔离字段 | R:SsSuperassistKwCatalog,SsSuperassistKwCatalogMapper | A:- | S:resultMap基础字段映射,kw_catalog_id主键,enterprise_id多租户,文件名与namespace不一致(实为知识目录Mapper)
SuasSuperassistMapper.xml[ME5DM]: F:数字员工超级助理MyBatis映射文件,当前为空映射 | R:SuasSuperassistMapper.java | A:- | S:空mapper占位,多租户实体超级助理持久化映射,无自定义SQL
SuasSuperassistResourcePrivilegeMapper.xml[MEM7BM]: F:超级助理资源权限SQL映射,助理可见可用资源权限增查 | R:SuasSuperassistResourcePrivilegeMapper.java,SuasSuperassistResourcePrivilege | A:- | S:条件查询/按助理ID查/关联ss_resource查资源名描述/单条插入/批量插入,privilege_type三层授权,按create_time倒序
SuasSuperassistSubAgentMapper.xml[MEM31T]: F:超级助理子智能体Mapper的XML映射文件(空映射,仅声明namespace) | R:SuasSuperassistSubAgentMapper.java | A:- | S:MyBatis映射,无自定义SQL,CRUD全由生成器或注解承载

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/system/===
SequenceMapper.xml[MD5DS]: F:多数据库序列号生成SQL映射(Udal/Oracle/PostgreSQL/MySQL自增) | R:SequenceMapper.java | A:- | S:nextval序列查询,MySQL插入空id获取自增主键,定期清理历史id行,适配多数据源方言
SysAppVersionMapper.xml[MSY3ST]: F:系统APP版本Mapper映射,按设备类型查最新版本 | R:SysAppVersionMapper.java,SysAppVersion | A:- | S:resultMap字段映射,selectLatestVersionByDeviceType按publish_time降序limit1

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/tag/===
ByaiTagRelationMapper.xml[MOB5BS]: F:标签关系SQL映射,对象-标签多对多关联查询/删除/批量插入 | R:ByaiTagRelationMapper.java,ByaiTagRelation | A:- | S:按objType+objId查标签ID,批量查,先删后插,insertBatch多库适配(pg/mysql/oracle)

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/template/===
ResourceTemplateRelationMapper.xml[MOB5BT]: F:资源-模板关联关系SQL映射,提供按资源/模板/用户查询及批量插入删除 | R:ResourceTemplateRelationMapper.java,ResourceTemplateRelation | A:- | S:deleteByResourceId,selectByResourceIdAndUserId,batchInsert,selectByTemplateId,selectByTemplateIdAndResourceId,selectByResourceIds返回Map含memory_rule_id
TemplateRuleInfoMapper.xml[MTO5KS]: F:模版规则信息SQL映射,支持条件分页查询及资源关联记忆规则查询 | R:TemplateRuleInfoMapper.java,TemplateRuleInfo,resource_template_relation | A:- | S:selectByCondition动态条件JOIN资源表分页,selectByConditionWithMemoryRuleId返Map含memoryRuleId,按resourceId/userId查询,resourceIds批量IN查询,模糊rule_name/content,时间段过滤,create_time DESC排序

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/users/===
UsersMapper.xml[MOR8MBS]: F:用户Mapper SQL,按组织/岗位/工位(含子级路径)查用户、用户详情VO、按unionId/邮箱/姓名查询及批量更新 | R:UsersMapper.java,Users,UsersOrgVo,UsersDetailVo,StringListTypeHandler | A:- | S:多库适配(postgresql/oracle/mysql聚合函数),path_code子级递归,GROUP_CONCAT用户类型,foreach批量,suas_superassist关联数字员工
**注**: C维度锚点为8(高频),B=OR(ORG组织),D含M(多租户)B(批量)S(>100行)

UsersMapper.xml[MOR8MBL]: F:用户Mapper SQL,按组织/岗位/工位(含子级路径)查用户、用户详情VO、按unionId/邮箱/姓名查询及批量更新 | R:UsersMapper.java,Users,UsersOrgVo,UsersDetailVo,StringListTypeHandler | A:- | S:多库适配(postgresql/oracle/mysql聚合函数),path_code子级递归,GROUP_CONCAT用户类型,foreach批量更新,suas_superassist关联数字员工
UsersOrganizationMapper.xml[MO5BM]: F:用户组织关系MyBatis映射,批量保存/统计/查询用户组织岗位关系及按组织岗位驻地批量查用户 | R:UsersOrganizationMapper.java,UsersOrganization,UsersOrganizationVo,UsersOrgPostVo | A:- | S:saveBatch批量插入,countExcludeCurrent统计,selectUsersOrganizationVoList左联组织岗位表collection嵌套,selectUsersInBatch多条件UNION ALL查user_id

===byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/workspace/===
ByaiSessionWorkspaceMapper.xml[MFI8BT]: F:会话工作区SQL映射,批量插入/批量标记存在/按会话查询文件列表 | R:ByaiSessionWorkspaceMapper.java,ByaiSessionWorkspace | A:- | S:多库兼容批量insert,updateIsExistByIds批量置1,selectBySession按会话+关键词模糊查create_time倒序

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/cache/===
ShareBfmUser.java: F:BFM共享用户缓存数据类(用户ID/名称/密码/账户/组织/驻地/来源系统等字段)

===byclaw-be/src/main/java/com/iwhalecloud/byai/common/page/===
PageInfo.java: F:通用分页结果封装类

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/conversation/===
FeedbackMsgInfo.java: F:会话反馈处理信息实体

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/file/===
Files.java: F:文件实体类对应byai_files表

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/memory/===
MemoryLibrary.java: F:记忆库实体,关联数字员工/超级助手与用户记忆库
ResourceRuleEnabled.java: F:资源规则启用状态表实体(资源模版关联/启用开关)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/message/===
MessageShareLink.java: F:消息分享链接实体(message_share_link表)
MessageShareLinkMessage.java: F:消息分享链接与消息多对多关联实体(对应message_share_link_message表)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/monitor/===
MonitorTarget.java: F:监控目标表实体(数字员工监控目标,含可用性/告警/质量等级字段)

===byclaw-be/src/main/java/com/iwhalecloud/byai/manager/entity/token/===
UserAccessToken.java: F:用户访问令牌实体(po_user_access_token,含令牌值/状态/有效期/企业归属)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/common/share/bean/===
Organization.java: F:组织实体数据类(编码/名称/类型/层级/父级/路径)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/auth/vo/===
AuthVo.java: F:授权信息VO(红黑名单授权对象/资源类型/操作类型)

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/log/dto/===
BatchTrackLogDto.java: F:批量埋点日志DTO,封装TrackLog列表

===byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/showcase/strategy/model/===
ShowcaseDetailDto.java: F:成果空间详情数据传输对象
ShowcaseDownloadResult.java: F:成果空间下载结果不可变值对象,封装文件字节流/文件名/内容类型
ShowcaseStoragePayload.java: F:成果对象存储处理过程数据载体,在下载原始文件与上传对象存储间传递文件内容/名称/媒体类型/对象URL/文件ID等上下文

