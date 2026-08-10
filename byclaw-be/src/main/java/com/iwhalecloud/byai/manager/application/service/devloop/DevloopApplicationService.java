package com.iwhalecloud.byai.manager.application.service.devloop;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.client.FeignDataCloudService;
import com.iwhalecloud.byai.common.feign.request.datacloud.InvokeActionReq;
import com.iwhalecloud.byai.common.feign.request.datacloud.Params;
import com.iwhalecloud.byai.common.feign.request.datacloud.QueryByKnowledgeReq;
import com.iwhalecloud.byai.common.feign.response.DataCloudResponse;
import com.iwhalecloud.byai.common.feign.response.datacloud.InvokeActionResp;
import com.iwhalecloud.byai.common.feign.response.datacloud.QueryByKnowledgeResp;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.job.DevloopPatService;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.domain.devloop.service.*;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorManifestCommandResolver;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;
import com.iwhalecloud.byai.manager.domain.connector.provider.dingtalk.DwsAuthorizationCommandPolicy;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.domain.session.service.ByaiSessionService;
import com.iwhalecloud.byai.manager.dto.devloop.ListObjectFileDto;
import com.iwhalecloud.byai.manager.dto.devloop.ListObjectFilePkIdDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ManualRequirementDeleteDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ManualRequirementDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ManualRequirementUpdateDTO;
import com.iwhalecloud.byai.manager.dto.devloop.OperationRequirementDTO;
import com.iwhalecloud.byai.manager.dto.devloop.OperationAccountDTO;
import com.iwhalecloud.byai.manager.dto.devloop.OperationRequirementStartDTO;
import com.iwhalecloud.byai.manager.dto.devloop.OperationTaskDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ObjectFileDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ObjectFileGroupDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ObjectFileSaveDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ScanSourceDTO;
import com.iwhalecloud.byai.manager.dto.devloop.IntegrationEnvDTO;
import com.iwhalecloud.byai.manager.dto.devloop.IntegrationSuiteDTO;
import com.iwhalecloud.byai.manager.dto.devloop.DefaultAgentDTO;
import com.iwhalecloud.byai.manager.dto.devloop.TesterConfigDTO;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskListQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskStateDto;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskViewDto;
import com.iwhalecloud.byai.manager.dto.devloop.E2eStatusDto;
import com.iwhalecloud.byai.manager.dto.devloop.IntegrationResultDto;
import com.iwhalecloud.byai.manager.dto.devloop.RequirementPresplitDTO;
import com.iwhalecloud.byai.manager.dto.devloop.RequirementPresplitResultDto;
import com.iwhalecloud.byai.manager.dto.devloop.RequirementSplitDTO;
import com.iwhalecloud.byai.manager.dto.devloop.UpdateTaskStatusDto;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.devloop.*;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanRequireItemMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionExtMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.MultiAgentMetadata;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.session.dto.SessionMembersDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiPromptService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.util.threadPoolUti.ThreadPoolUtil;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.io.ByteArrayOutputStream;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.Executor;
import java.util.stream.Stream;

/**
 * 研发闭环应用服务 聚合扫描源管理、扫描执行、日志查询、PAT管理、钉钉群搜索等业务逻辑（项目管理见 ProjectApplicationService）
 */
@Slf4j
@Service
public class DevloopApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(DevloopApplicationService.class);

    /** 本地文件存储根(NFS 挂载点),与 LocalStorageService 同源配置;用于拼会话工作区绝对路径读本地 git 变更。 */
    @Value("${file.storage.local.path:${byclaw.sandbox.volume.file-root:/tmp/byclaw-storage}}")
    private String fileStorageRoot;

    /** 会话私有工作区目录名,即 {bucket}/by/.sessions 里的 by 段,与前端会话空间口径一致。 */
    private static final String SESSION_WORKSPACE_SEGMENT = "by/.sessions";

    private static final String DELETE_FLAG_DELETED = "1";

    /** 所有用户共用的默认项目分组 ID，查询会话时必须再按创建人隔离。 */
    private static final Long DEFAULT_PROJECT_ID = -1L;

    /** v2 状态投影终态；只有明确完成的任务才释放 agent 并发额度。 */
    private static final String TASK_STATUS_COMPLETED = "completed";

    /** 单个数字员工并发运行任务上限的全局配置键；缺省 1，超过则该 agent 本轮不再接新任务，避免 codeagent OOM。 */
    private static final String AGENT_MAX_CONCURRENT_CODE = "DEVLOOP_AGENT_MAX_CONCURRENT";

    private static final int AGENT_MAX_CONCURRENT_DEFAULT = 1;

    /** 运营任务复用 byai_session.session_name，名称长度必须遵循现有会话主表的255字符限制。 */
    private static final int OPERATION_SESSION_NAME_MAX_LENGTH = 255;

    /** 运营需求描述和采集主题统一限制 1000 字，避免超长配置影响列表、详情和任务提示词。 */
    private static final int OPERATION_REQUIREMENT_TEXT_MAX_LENGTH = 1000;

    /** 手工录入需求复用扫描条目存储，但不作为可扫描渠道。 */
    private static final String MANUAL_SOURCE_TYPE = "manual";

    /** 数据库存储语言无关的内部标识；展示名称在每次请求时根据当前语言解析。 */
    private static final String MANUAL_SOURCE_NAME = MANUAL_SOURCE_TYPE;

    /**
     * 手工录入内容的持久化包裹标识。外部扫描内容仍按原文存储，读取时只识别该流程创建的记录， 不改变已有渠道内容。
     */
    private static final String MANUAL_REQUIREMENT_CONTENT_KEY = "manualRequirement";

    /** 手工需求 JSON 包裹中持久化的稳定、语言无关的来源标识。 */
    private static final Set<String> MANUAL_REQUIREMENT_ORIGIN_TYPES = Set.of("manual", "customer_feedback",
        "internal_proposal");

    /** 仅用于内部 JSON 包裹的独立 Mapper，避免受 HTTP JSON 全局配置影响。 */
    private static final ObjectMapper MANUAL_REQUIREMENT_MAPPER = new ObjectMapper();

    /**
     * 研发任务 LLM 对话异步执行线程池。 TtlExecutors 包装以透传 CurrentUserHolder 的 LoginInfo；任务创建接口据此立即返回， chat 在后台执行，避免前端等待数分钟。
     */
    private static final Executor TASK_CHAT_EXECUTOR = ThreadPoolUtil.getThreadPool(2, 8, 100, 60, "devloop-task-chat");

    @Autowired
    private ProjectMapper projectMapper;

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    @Autowired
    private ByaiSessionMapper byaiSessionMapper;

    @Autowired
    private SessionExtService sessionExtService;

    @Autowired
    private ScanRequireItemMapper scanRequireItemMapper;

    @Autowired
    private ScanSourceService scanSourceService;

    @Autowired
    private IntegrationEnvService integrationEnvService;

    @Autowired
    private IntegrationSuiteService integrationSuiteService;

    @Autowired
    private DefaultAgentService defaultAgentService;

    @Autowired
    private IntegrationRunService integrationRunService;

    @Autowired
    private TesterConfigService testerConfigService;

    @Autowired
    private ScanItemTaskService scanItemTaskService;

    @Autowired
    private RequirementPresplitService requirementPresplitService;

    @Autowired
    private DevloopPhaseService devloopPhaseService;

    @Autowired
    private DangerousScriptGuard dangerousScriptGuard;

    @Autowired
    private ScanLogService scanLogService;

    @Autowired
    private GitHubIssueScanService gitHubIssueScanService;

    @Autowired
    private DingtalkScanService dingtalkScanService;

    @Autowired
    private DingtalkTodoScanService dingtalkTodoScanService;

    @Autowired
    private DwsAuthService dwsAuthService;

    @Autowired
    private ConnectorInfoService connectorInfoService;

    @Autowired
    private ConnectorManifestCommandResolver connectorManifestCommandResolver;

    @Autowired
    private DevloopPatService patService;

    @Autowired
    private ProjectMemberService projectMemberService;

    @Autowired
    private OperationTaskSessionService operationTaskSessionService;

    @Autowired
    private OperationAccountService operationAccountService;

    @Autowired
    private ProjectObjectFileService projectObjectFileService;

    /** 运营任务模板目录服务由 Spring 管理，供模板列表、详情和任务启动复用。 */
    @Autowired
    private OperationTaskTemplateService operationTaskTemplateService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private AssistantChatService assistantChatService;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Autowired
    private DevloopScoringService scoringService;

    @Autowired
    private DevloopTaskStateReader taskStateReader;

    @Autowired
    private GitHubCompareService gitHubCompareService;

    @Autowired
    private LocalGitChangeService localGitChangeService;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SsSandboxRecordMapper sandboxRecordMapper;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private AiPromptService aiPromptService;

    @Autowired
    private UserBucketNamingService userBucketNamingService;

    @Autowired
    private FeignDataCloudService feignDataCloudService;

    @Autowired
    private ByaiSessionService byaiSessionService;

    /** 创建扫描源 */
    public ResponseUtil<Map<String, Object>> createScanSource(ScanSourceDTO dto) {
        if (dto != null && ScanSourceService.OPERATION_SOURCE_TYPES.contains(dto.getSourceType())) {
            // 运营需求必须经过专用接口补齐负责人和完成时间，不能从渠道配置入口绕过校验。
            return ResponseUtil.failRes(I18nUtil.get("devloop.source.type.unsupported", dto.getSourceType()));
        }
        ScanSource source = new ScanSource();
        source.setProjectId(dto.getProjectId());
        source.setSourceName(dto.getSourceName());
        source.setSourceType(dto.getSourceType());
        source.setConfig(dto.getConfig());
        source.setCronExpr(dto.getCronExpr());
        source.setEnabled(dto.getEnabled() != null ? dto.getEnabled() : "1");
        source.setRepoId(dto.getRepoId());
        source.setConfirmMode(dto.getConfirmMode() != null ? dto.getConfirmMode() : "manual");
        source.setScoreThreshold(dto.getScoreThreshold() != null ? dto.getScoreThreshold() : 70);
        source.setCreateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        ScanSource created = scanSourceService.create(source);

        Map<String, Object> result = new HashMap<>();
        result.put("sourceId", created.getSourceId());
        return ResponseUtil.successResponse(result);
    }

    /** 修改扫描源配置（名称、config、cron）。仅创建者可改。 */
    public ResponseUtil<Void> updateScanSource(ScanSourceDTO dto) {
        String denied = requireSourceCreator(dto.getSourceId());
        if (denied != null) {
            return ResponseUtil.failRes(denied);
        }
        String operationDenied = rejectOperationSourceMutation(dto.getSourceId());
        if (operationDenied != null) {
            return ResponseUtil.failRes(operationDenied);
        }
        ScanSource source = new ScanSource();
        source.setSourceId(dto.getSourceId());
        source.setSourceName(dto.getSourceName());
        source.setConfig(dto.getConfig());
        source.setCronExpr(dto.getCronExpr());
        source.setRepoId(dto.getRepoId());
        source.setConfirmMode(dto.getConfirmMode());
        source.setScoreThreshold(dto.getScoreThreshold());
        source.setUpdateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        scanSourceService.update(source);
        return ResponseUtil.successResponse(null);
    }

    /** 删除扫描源。仅创建者可删。 */
    public ResponseUtil<Void> deleteScanSource(Long sourceId) {
        String denied = requireSourceCreator(sourceId);
        if (denied != null) {
            return ResponseUtil.failRes(denied);
        }
        String operationDenied = rejectOperationSourceMutation(sourceId);
        if (operationDenied != null) {
            return ResponseUtil.failRes(operationDenied);
        }
        scanSourceService.delete(sourceId);
        return ResponseUtil.successResponse(null);
    }

    /**
     * 校验当前登录用户是否为该扫描源创建者。是则返回 null(放行);否则返回错误提示。 后端硬控制:前端隐藏按钮只是体验,越权改删/授权必须在服务端挡住。
     */
    private String requireSourceCreator(Long sourceId) {
        if (sourceId == null) {
            return I18nUtil.get("devloop.source.parameter.required");
        }
        ScanSource source = scanSourceService.findById(sourceId);
        if (source == null) {
            return I18nUtil.get("devloop.source.not.found");
        }
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (currentUserId == null || !String.valueOf(currentUserId).equals(source.getCreateBy())) {
            return I18nUtil.get("devloop.source.creator.required");
        }
        return null;
    }

    /** 查询项目可配置的扫描渠道；手工来源只是扫描日志基础设施，不能展示在渠道配置页。 */
    public ResponseUtil<List<Map<String, Object>>> listScanSources(Long projectId) {
        List<Map<String, Object>> list = scanSourceService.listByProjectId(projectId).stream()
            .filter(source -> !MANUAL_SOURCE_TYPE.equals(source.getSourceType())
                && !ScanSourceService.OPERATION_SOURCE_TYPES.contains(source.getSourceType()))
            .map(this::scanSourceToVo).collect(java.util.stream.Collectors.toList());
        return ResponseUtil.successResponse(list);
    }

    /** 渠道配置大面板按名称后端搜索并分页返回，手工来源和运营需求源均不计入研发渠道总数。 */
    public ResponseUtil<PageInfo<Map<String, Object>>> listScanSources(Long projectId, String keyword, int pageNum,
        int pageSize) {
        // 研发渠道页排除全部运营需求类型，避免新增的知识整理需求混入研发资源列表。
        Set<String> excludedSourceTypes = new HashSet<>(ScanSourceService.OPERATION_SOURCE_TYPES);
        excludedSourceTypes.add(MANUAL_SOURCE_TYPE);
        Page<ScanSource> sourcePage = scanSourceService.listByProjectIdPage(projectId, keyword, excludedSourceTypes,
            pageNum, pageSize);
        PageInfo<Map<String, Object>> result = new PageInfo<>();
        result.setPageNum((int) sourcePage.getCurrent());
        result.setPageSize((int) sourcePage.getSize());
        result.setTotal(sourcePage.getTotal());
        result.setTotalPages((int) sourcePage.getPages());
        List<Map<String, Object>> sourceList = sourcePage.getRecords().stream().map(this::scanSourceToVo)
            .collect(java.util.stream.Collectors.toList());
        result.setList(sourceList);
        return ResponseUtil.successResponse(result);
    }

    /** 扫描源对外视图：白名单字段，刻意排除 createBy/updateBy/时间戳/deleteFlag 等内部字段。 */
    private Map<String, Object> scanSourceToVo(ScanSource s) {
        Map<String, Object> map = new HashMap<>();
        map.put("sourceId", s.getSourceId());
        map.put("sourceName", s.getSourceName());
        map.put("sourceType", s.getSourceType());
        map.put("config", s.getConfig());
        map.put("cronExpr", s.getCronExpr());
        map.put("enabled", s.getEnabled());
        map.put("repoId", s.getRepoId());
        map.put("confirmMode", s.getConfirmMode());
        map.put("scoreThreshold", s.getScoreThreshold());
        map.put("lastScanTime", s.getLastScanTime());
        // 创建者信息:前端据此判断"当前用户是否创建者",控制授权/编辑/删除入口;createByName 供展示。
        map.put("createBy", s.getCreateBy());
        map.put("createByName", resolveUserName(parseUserId(s.getCreateBy())));
        return map;
    }

    // ========== 集成测试环境 ==========

    /** 创建集成测试环境 */
    public ResponseUtil<Map<String, Object>> createIntegrationEnv(IntegrationEnvDTO dto) {
        IntegrationEnv env = new IntegrationEnv();
        applyIntegrationEnvDto(env, dto, null);
        env.setCreateBy(CurrentUserHolder.getCurrentUserId());
        IntegrationEnv created = integrationEnvService.create(env);

        Map<String, Object> result = new HashMap<>();
        result.put("envId", created.getEnvId());
        return ResponseUtil.successResponse(result);
    }

    /** 更新集成测试环境 */
    public ResponseUtil<Void> updateIntegrationEnv(IntegrationEnvDTO dto) {
        IntegrationEnv env = new IntegrationEnv();
        env.setEnvId(dto.getEnvId());
        // 更新前载入原值:密码留空需继承旧密文,避免整列 JSON 覆盖把已存密文清掉。
        IntegrationEnv existing = integrationEnvService.findById(dto.getEnvId());
        applyIntegrationEnvDto(env, dto, existing);
        env.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        integrationEnvService.update(env);
        return ResponseUtil.successResponse(null);
    }

    /** 删除集成测试环境 */
    public ResponseUtil<Void> deleteIntegrationEnv(Long envId) {
        integrationEnvService.delete(envId);
        return ResponseUtil.successResponse(null);
    }

    /** 查询项目下的集成测试环境列表 */
    public ResponseUtil<List<Map<String, Object>>> listIntegrationEnvs(Long projectId) {
        List<Map<String, Object>> list = integrationEnvService.listByProjectId(projectId).stream()
            .map(this::integrationEnvToVo).collect(java.util.stream.Collectors.toList());
        return ResponseUtil.successResponse(list);
    }

    /** DTO → 实体字段拷贝(projectId 仅创建时来自入参,更新时不改归属项目)。 */
    private void applyIntegrationEnvDto(IntegrationEnv env, IntegrationEnvDTO dto, IntegrationEnv existing) {
        // 保存即过高危闸门:环境准备 stages 会在测试机上执行,含删库/格式化等命令直接拒绝入库。
        validateStagesSafety(dto.getStages());
        env.setProjectId(dto.getProjectId());
        env.setEnvName(dto.getEnvName());
        env.setAddress(dto.getAddress());
        env.setOrchestrator(dto.getOrchestrator());
        env.setCaseSource(dto.getCaseSource());
        env.setConnProtocol(dto.getConnProtocol());
        env.setConnHost(dto.getConnHost());
        env.setConnPort(dto.getConnPort());
        env.setConnUser(dto.getConnUser());
        env.setConnAuth(dto.getConnAuth());
        // 连接凭据存 SM4 密文,不再是 po_user_private_param 的 key。前端传明文密码/私钥;
        // 留空表示"保持原值"——不 set,靠 updateById 只更新非 null 列跳过,避免误清空。
        if (StringUtils.isNotBlank(dto.getConnCredentialRef())) {
            env.setConnCredentialRef(Sm4Util.encrypt(dto.getConnCredentialRef()));
        }
        env.setConnWorkdir(dto.getConnWorkdir());
        env.setStages(dto.getStages());
        // 测试账号密码同样存密文;整列 JSON 覆盖写,故留空密码需按账号 id 从原值继承旧密文。
        env.setTestAccounts(
            encryptTestAccounts(dto.getTestAccounts(), existing == null ? null : existing.getTestAccounts()));
    }

    // 逐个 stage 过高危闸门;命中即抛,由全局异常处理包成 ResponseUtil.fail 回前端。
    private void validateStagesSafety(String stagesJson) {
        if (StringUtils.isBlank(stagesJson)) {
            return;
        }
        JSONArray stages = JSON.parseArray(stagesJson);
        if (stages == null) {
            return;
        }
        for (int i = 0; i < stages.size(); i++) {
            JSONObject stage = stages.getJSONObject(i);
            if (stage == null) {
                continue;
            }
            String label = StringUtils.defaultIfBlank(stage.getString("name"), "环境阶段-" + (i + 1));
            String hit = dangerousScriptGuard.detect(label, stage.getString("script"));
            if (hit != null) {
                throw new IllegalArgumentException(hit);
            }
        }
    }

    // 遍历测试账号,把明文 credentialRef 加密为 SM4 密文;账号密码留空则沿用同 id 旧密文(编辑仅改用户名等场景)。
    private String encryptTestAccounts(String incomingJson, String existingJson) {
        if (StringUtils.isBlank(incomingJson)) {
            return incomingJson;
        }
        JSONArray accounts = JSON.parseArray(incomingJson);
        if (accounts == null) {
            return incomingJson;
        }
        Map<String, String> oldCipherById = new HashMap<>();
        JSONArray existingAccounts = StringUtils.isBlank(existingJson) ? null : JSON.parseArray(existingJson);
        if (existingAccounts != null) {
            for (int i = 0; i < existingAccounts.size(); i++) {
                JSONObject acc = existingAccounts.getJSONObject(i);
                if (acc != null && StringUtils.isNotBlank(acc.getString("id"))) {
                    oldCipherById.put(acc.getString("id"), acc.getString("credentialRef"));
                }
            }
        }
        for (int i = 0; i < accounts.size(); i++) {
            JSONObject acc = accounts.getJSONObject(i);
            if (acc == null) {
                continue;
            }
            String pwd = acc.getString("credentialRef");
            if (StringUtils.isNotBlank(pwd)) {
                acc.put("credentialRef", Sm4Util.encrypt(pwd));
            }
            else {
                // 留空:沿用旧密文;新账号无旧值则置空,执行时按缺失处理。
                acc.put("credentialRef", oldCipherById.getOrDefault(acc.getString("id"), ""));
            }
        }
        return accounts.toJSONString();
    }

    // 回显时把每个账号的密文 credentialRef 抹成空串,补 hasCredential 布尔供前端展示"已设密码";密文绝不出库到浏览器。
    private String maskTestAccounts(String testAccountsJson) {
        if (StringUtils.isBlank(testAccountsJson)) {
            return testAccountsJson;
        }
        JSONArray accounts = JSON.parseArray(testAccountsJson);
        if (accounts == null) {
            return testAccountsJson;
        }
        for (int i = 0; i < accounts.size(); i++) {
            JSONObject acc = accounts.getJSONObject(i);
            if (acc == null) {
                continue;
            }
            acc.put("hasCredential", StringUtils.isNotBlank(acc.getString("credentialRef")));
            acc.put("credentialRef", "");
        }
        return accounts.toJSONString();
    }

    private Map<String, Object> integrationEnvToVo(IntegrationEnv e) {
        Map<String, Object> map = new HashMap<>();
        map.put("envId", e.getEnvId());
        map.put("projectId", e.getProjectId());
        map.put("envName", e.getEnvName());
        map.put("address", e.getAddress());
        map.put("orchestrator", e.getOrchestrator());
        map.put("caseSource", e.getCaseSource());
        map.put("connProtocol", e.getConnProtocol());
        map.put("connHost", e.getConnHost());
        map.put("connPort", e.getConnPort());
        map.put("connUser", e.getConnUser());
        map.put("connAuth", e.getConnAuth());
        // 安全:密文绝不回显,只告知前端是否已配置;编辑时密码框留空即保持原值。
        map.put("hasConnCredential", StringUtils.isNotBlank(e.getConnCredentialRef()));
        map.put("connWorkdir", e.getConnWorkdir());
        map.put("stages", e.getStages());
        // 测试账号回传时抹掉密文,仅保留是否已设密码标记(hasCredential),不泄露任何凭据值。
        map.put("testAccounts", maskTestAccounts(e.getTestAccounts()));
        map.put("createBy", e.getCreateBy());
        map.put("createByName", resolveUserName(e.getCreateBy()));
        map.put("createTime", e.getCreateTime());
        return map;
    }

    // ========== 端到端测试用例集 ==========

    /** 创建测试用例集 */
    public ResponseUtil<Map<String, Object>> createIntegrationSuite(IntegrationSuiteDTO dto) {
        IntegrationSuite suite = new IntegrationSuite();
        applyIntegrationSuiteDto(suite, dto);
        suite.setCreateBy(CurrentUserHolder.getCurrentUserId());
        IntegrationSuite created = integrationSuiteService.create(suite);

        Map<String, Object> result = new HashMap<>();
        result.put("suiteId", created.getSuiteId());
        return ResponseUtil.successResponse(result);
    }

    /** 更新测试用例集 */
    public ResponseUtil<Void> updateIntegrationSuite(IntegrationSuiteDTO dto) {
        IntegrationSuite suite = new IntegrationSuite();
        suite.setSuiteId(dto.getSuiteId());
        applyIntegrationSuiteDto(suite, dto);
        suite.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        integrationSuiteService.update(suite);
        return ResponseUtil.successResponse(null);
    }

    /** 删除测试用例集 */
    public ResponseUtil<Void> deleteIntegrationSuite(Long suiteId) {
        integrationSuiteService.delete(suiteId);
        return ResponseUtil.successResponse(null);
    }

    /** 启用/停用测试用例集 */
    public ResponseUtil<Void> toggleIntegrationSuite(Long suiteId, String enabled) {
        integrationSuiteService.toggle(suiteId, enabled);
        return ResponseUtil.successResponse(null);
    }

    /** 查询项目下的测试用例集列表 */
    public ResponseUtil<List<Map<String, Object>>> listIntegrationSuites(Long projectId) {
        List<Map<String, Object>> list = integrationSuiteService.listByProjectId(projectId).stream()
            .map(this::integrationSuiteToVo).collect(java.util.stream.Collectors.toList());
        return ResponseUtil.successResponse(list);
    }

    /** DTO → 实体字段拷贝(projectId 仅创建时来自入参,更新时不改归属项目)。 */
    private void applyIntegrationSuiteDto(IntegrationSuite suite, IntegrationSuiteDTO dto) {
        // 保存即过高危闸门:套件 runCommand 会在测试机上执行,含破坏性命令直接拒绝入库。
        String hit = dangerousScriptGuard.detect("套件命令", dto.getRunCommand());
        if (hit != null) {
            throw new IllegalArgumentException(hit);
        }
        suite.setProjectId(dto.getProjectId());
        suite.setSuiteName(dto.getSuiteName());
        suite.setRunner(dto.getRunner());
        suite.setSourceType(dto.getSourceType());
        suite.setRepoId(dto.getRepoId());
        suite.setSource(dto.getSource());
        suite.setBranch(dto.getBranch());
        suite.setRunCommand(dto.getRunCommand());
        suite.setWorkdir(dto.getWorkdir());
        suite.setReportPath(dto.getReportPath());
        suite.setCaseCount(dto.getCaseCount());
        suite.setEnabled(dto.getEnabled());
        suite.setManualFile(dto.getManualFile());
    }

    private Map<String, Object> integrationSuiteToVo(IntegrationSuite s) {
        Map<String, Object> map = new HashMap<>();
        map.put("suiteId", s.getSuiteId());
        map.put("projectId", s.getProjectId());
        map.put("suiteName", s.getSuiteName());
        map.put("runner", s.getRunner());
        map.put("sourceType", s.getSourceType());
        map.put("repoId", s.getRepoId());
        map.put("source", s.getSource());
        map.put("branch", s.getBranch());
        map.put("runCommand", s.getRunCommand());
        map.put("workdir", s.getWorkdir());
        map.put("reportPath", s.getReportPath());
        map.put("caseCount", s.getCaseCount());
        map.put("enabled", s.getEnabled());
        map.put("manualFile", s.getManualFile());
        map.put("createBy", s.getCreateBy());
        map.put("createByName", resolveUserName(s.getCreateBy()));
        map.put("createTime", s.getCreateTime());
        return map;
    }

    // ========== 默认助理 ==========

    /** 查询某作用域(projectId 缺省/0=全局默认,>0=项目覆盖)的原始配置。 */
    public ResponseUtil<Map<String, Object>> getDefaultAgent(Long projectId) {
        DefaultAgent entity = defaultAgentService.findByScope(projectId);
        return ResponseUtil.successResponse(defaultAgentToVo(entity, projectId));
    }

    /** 查询项目各角色生效的默认助理(项目覆盖合并到全局默认之上)。 */
    public ResponseUtil<Map<String, Object>> resolveDefaultAgent(Long projectId) {
        DefaultAgent merged = defaultAgentService.resolveForProject(projectId);
        return ResponseUtil.successResponse(defaultAgentToVo(merged, projectId));
    }

    /** 保存某作用域默认助理配置(每作用域唯一,upsert)。 */
    public ResponseUtil<Void> saveDefaultAgent(DefaultAgentDTO dto) {
        DefaultAgent entity = new DefaultAgent();
        entity.setProjectId(dto.getProjectId());
        entity.setArchitectAgentId(dto.getArchitectAgentId());
        entity.setArchitectAgentName(dto.getArchitectAgentName());
        entity.setRequirementAgentId(dto.getRequirementAgentId());
        entity.setRequirementAgentName(dto.getRequirementAgentName());
        entity.setCoderAgentId(dto.getCoderAgentId());
        entity.setCoderAgentName(dto.getCoderAgentName());
        entity.setTesterAgentId(dto.getTesterAgentId());
        entity.setTesterAgentName(dto.getTesterAgentName());
        defaultAgentService.save(entity, CurrentUserHolder.getCurrentUserId());
        return ResponseUtil.successResponse(null);
    }

    /** 实体 → VO;entity 为空时返回各角色为空的占位,前端按空处理为未配置。 */
    private Map<String, Object> defaultAgentToVo(DefaultAgent entity, Long projectId) {
        Map<String, Object> map = new HashMap<>();
        map.put("projectId", entity != null && entity.getProjectId() != null ? entity.getProjectId() : projectId);
        map.put("architectAgentId", entity == null ? null : entity.getArchitectAgentId());
        map.put("architectAgentName", entity == null ? null : entity.getArchitectAgentName());
        map.put("requirementAgentId", entity == null ? null : entity.getRequirementAgentId());
        map.put("requirementAgentName", entity == null ? null : entity.getRequirementAgentName());
        map.put("coderAgentId", entity == null ? null : entity.getCoderAgentId());
        map.put("coderAgentName", entity == null ? null : entity.getCoderAgentName());
        map.put("testerAgentId", entity == null ? null : entity.getTesterAgentId());
        map.put("testerAgentName", entity == null ? null : entity.getTesterAgentName());
        return map;
    }

    // ========== 独立测试数字员工配置 ==========

    /** 查询项目的独立测试员工配置;无记录回填出厂默认,前端始终拿到完整可编辑配置。 */
    public ResponseUtil<Map<String, Object>> getTesterConfig(Long projectId) {
        TesterConfig entity = testerConfigService.findByProject(projectId);
        return ResponseUtil.successResponse(testerConfigToVo(entity, projectId));
    }

    /** 保存项目的独立测试员工配置(每项目唯一,upsert)。 */
    public ResponseUtil<Void> saveTesterConfig(TesterConfigDTO dto) {
        TesterConfig entity = new TesterConfig();
        entity.setProjectId(dto.getProjectId());
        entity.setEnabled(boolToFlag(dto.getEnabled(), "1"));
        TesterConfigDTO.Schedule schedule = dto.getSchedule();
        entity.setCron(schedule == null ? null : schedule.getCron());
        entity.setCronLabel(schedule == null ? null : schedule.getCronLabel());
        entity
            .setTimezone(schedule == null || schedule.getTimezone() == null ? "Asia/Shanghai" : schedule.getTimezone());
        TesterConfigDTO.Admission admission = dto.getAdmission();
        entity.setRequireAllCoded(boolToFlag(admission == null ? null : admission.getRequireAllCoded(), "1"));
        entity.setMaxConcurrentReqs(
            admission == null || admission.getMaxConcurrentReqs() == null ? 2 : admission.getMaxConcurrentReqs());
        TesterConfigDTO.Kickback kickback = dto.getKickback();
        entity.setAutoAttribute(boolToFlag(kickback == null ? null : kickback.getAutoAttribute(), "1"));
        entity.setCreateDefectWhenUnclear(
            boolToFlag(kickback == null ? null : kickback.getCreateDefectWhenUnclear(), "1"));
        entity.setMaxRounds(kickback == null || kickback.getMaxRounds() == null ? 3 : kickback.getMaxRounds());
        testerConfigService.save(entity, CurrentUserHolder.getCurrentUserId());
        return ResponseUtil.successResponse(null);
    }

    /**
     * 手动触发一次项目批量集成:对项目下所有「启用」用例集 × 指定环境各起一次真实 run,秒回 runId 列表。 需求级就绪批量与失败打回属 V2 引擎,尚未落地;当前手动执行复用单套件 startRun
     * 原语覆盖全部启用套件。
     */
    public ResponseUtil<Map<String, Object>> runTesterBatch(Long projectId, Long envId) {
        List<IntegrationSuite> enabledSuites = integrationSuiteService.listByProjectId(projectId).stream()
            .filter(s -> "1".equals(s.getEnabled())).collect(java.util.stream.Collectors.toList());
        if (enabledSuites.isEmpty()) {
            return ResponseUtil.fail("项目下没有启用的测试用例集");
        }
        Long operatorId = CurrentUserHolder.getCurrentUserId();
        List<Long> runIds = new java.util.ArrayList<>();
        for (IntegrationSuite suite : enabledSuites) {
            // 显式钉死 tester:这个入口就是「执行独立测试员工」,不能因为全局配置被改成 backend 而名不符实。
            IntegrationRun run = integrationRunService.startRun(suite.getSuiteId(), envId, operatorId, null,
                IntegrationRunExecutor.EXECUTOR_MODE_TESTER);
            runIds.add(run.getRunId());
        }
        Map<String, Object> result = new HashMap<>();
        result.put("runIds", runIds);
        result.put("suiteCount", enabledSuites.size());
        return ResponseUtil.successResponse(result);
    }

    /**
     * 需求级集成聚合看板:把项目下已拆解的需求(scan_item_task)按 (需求→多仓库任务) 组装成前端 RequirementIntegration[]。 环节/coded 由 DevloopPhaseService
     * 从会话消息实时投影;需求就绪 = 其下所有子任务 coder 环节 done; 最近一次集成结果按 requirement_id 反查 integration_run;打回记录来自各会话真实的 [PHASE] REJECT
     * 打点。
     */
    public ResponseUtil<List<Map<String, Object>>> listRequirementIntegrations(Long projectId) {
        List<ScanItemTask> tasks = scanItemTaskService.listByProject(projectId);
        if (tasks.isEmpty()) {
            return ResponseUtil.successResponse(new ArrayList<>());
        }
        // 需求→子任务分组;保序(listByProject 已按 createTime 升序),让看板需求顺序稳定。
        Map<Long, List<ScanItemTask>> tasksByReq = new LinkedHashMap<>();
        for (ScanItemTask t : tasks) {
            tasksByReq.computeIfAbsent(t.getRequirementId(), k -> new ArrayList<>()).add(t);
        }
        // 该项目所有挂需求的执行,一次取尽后按需求取最新,避免逐需求查库。
        Map<Long, IntegrationRun> latestRunByReq = new HashMap<>();
        for (IntegrationRun run : integrationRunService.listWithRequirementByProject(projectId)) {
            latestRunByReq.putIfAbsent(run.getRequirementId(), run);
        }
        // 需求与仓库一次性批量取尽,避免看板逐需求/逐子任务 selectById 造成 N+1 查询。
        Map<Long, ScanRequireItem> itemById = batchLoadItems(tasksByReq.keySet());
        Map<Long, ProjectRepo> repoById = batchLoadRepos(tasks);
        // 单轮内存缓存 sessionId→快照:同一会话在就绪判定与环节展示间只投影一次。
        Map<Long, DevloopPhaseService.PhaseSnapshot> snapshotCache = new HashMap<>();
        List<Map<String, Object>> board = new ArrayList<>();
        for (Map.Entry<Long, List<ScanItemTask>> entry : tasksByReq.entrySet()) {
            ScanRequireItem item = itemById.get(entry.getKey());
            if (item == null) {
                continue;
            }
            board.add(requirementIntegrationToVo(item, entry.getValue(), latestRunByReq.get(entry.getKey()), repoById,
                snapshotCache));
        }
        return ResponseUtil.successResponse(board);
    }

    /** 需求 id → 需求,一次批量取尽。空集合直接返回空表,规避 MyBatis-Plus 空 IN 生成非法 SQL。 */
    private Map<Long, ScanRequireItem> batchLoadItems(Collection<Long> requirementIds) {
        if (requirementIds.isEmpty()) {
            return Collections.emptyMap();
        }
        Map<Long, ScanRequireItem> byId = new HashMap<>();
        for (ScanRequireItem item : scanRequireItemMapper.selectBatchIds(requirementIds)) {
            byId.put(item.getItemId(), item);
        }
        return byId;
    }

    /** 仓库 id → 仓库,一次批量取尽子任务涉及的仓库。空集合直接返回空表,规避空 IN 非法 SQL。 */
    private Map<Long, ProjectRepo> batchLoadRepos(List<ScanItemTask> tasks) {
        Set<Long> repoIds = new HashSet<>();
        for (ScanItemTask task : tasks) {
            if (task.getRepoId() != null) {
                repoIds.add(task.getRepoId());
            }
        }
        if (repoIds.isEmpty()) {
            return Collections.emptyMap();
        }
        Map<Long, ProjectRepo> byId = new HashMap<>();
        for (ProjectRepo repo : projectRepoMapper.selectBatchIds(repoIds)) {
            byId.put(repo.getRepoId(), repo);
        }
        return byId;
    }

    /** 一个需求 + 其子任务 + 最近执行 → 前端 RequirementIntegration。 */
    private Map<String, Object> requirementIntegrationToVo(ScanRequireItem item, List<ScanItemTask> tasks,
        IntegrationRun latestRun, Map<Long, ProjectRepo> repoById,
        Map<Long, DevloopPhaseService.PhaseSnapshot> snapshotCache) {
        List<Map<String, Object>> taskVos = new ArrayList<>();
        List<Map<String, Object>> kickbackTasks = new ArrayList<>();
        boolean allCoded = true;
        for (ScanItemTask task : tasks) {
            DevloopPhaseService.PhaseSnapshot snap = snapshotFor(task.getSessionId(), snapshotCache);
            ProjectRepo repo = task.getRepoId() != null ? repoById.get(task.getRepoId()) : null;
            String repoName = repo != null && repo.getRepoFullName() != null ? repo.getRepoFullName() : "";
            String branch = task.getSessionId() != null
                ? buildBranchName(detectTaskType(item, item.getTitle()), task.getSessionId())
                : "";
            boolean coded = isPhaseDone(snap, "coder");
            allCoded = allCoded && coded;
            taskVos.add(requirementTaskToVo(task, repoName, branch, snap, coded));
            appendKickback(kickbackTasks, snap, repoName, branch);
        }
        String status = deriveReqIntegrationStatus(allCoded, latestRun);
        Map<String, Object> map = new HashMap<>();
        map.put("reqId", String.valueOf(item.getItemId()));
        map.put("reqNo", StringUtils.defaultString(item.getOriginId(), String.valueOf(item.getItemId())));
        map.put("reqName", StringUtils.defaultString(item.getTitle()));
        map.put("tasks", taskVos);
        map.put("status", status);
        // 轮次 = 最近执行的打回轮次(打回一次 +1);无执行为 0。
        map.put("round",
            latestRun != null && latestRun.getKickbackTo() != null && !latestRun.getKickbackTo().isEmpty()
                ? maxRound(tasks, snapshotCache)
                : (latestRun != null ? 1 : 0));
        map.put("lastRunId", latestRun != null ? String.valueOf(latestRun.getRunId()) : "");
        map.put("lastRunAt", latestRun != null ? formatDateTime(latestRun.getCreateTime()) : "");
        map.put("passRate",
            latestRun != null && nvl(latestRun.getTotal()) > 0
                ? nvl(latestRun.getPassed()) + "/" + nvl(latestRun.getTotal())
                : "");
        map.put("kickbackTasks", kickbackTasks);
        return map;
    }

    /** 子任务 → 前端 RequirementTask;phase 收敛到前端枚举 coder/reviewer/tester/pr/done。 */
    private Map<String, Object> requirementTaskToVo(ScanItemTask task, String repoName, String branch,
        DevloopPhaseService.PhaseSnapshot snap, boolean coded) {
        Map<String, Object> map = new HashMap<>();
        map.put("id", String.valueOf(task.getTaskId()));
        map.put("repo", repoName);
        map.put("branch", branch);
        map.put("phase", clampReqTaskPhase(snap));
        map.put("coded", coded);
        return map;
    }

    /** 取会话环节快照(带单轮缓存);无会话或未启动返回空快照,视为未就绪。 */
    private DevloopPhaseService.PhaseSnapshot snapshotFor(Long sessionId,
        Map<Long, DevloopPhaseService.PhaseSnapshot> cache) {
        if (sessionId == null) {
            return devloopPhaseService.emptySnapshot();
        }
        return cache.computeIfAbsent(sessionId, devloopPhaseService::buildSnapshot);
    }

    /** 快照中某环节是否 done。 */
    private boolean isPhaseDone(DevloopPhaseService.PhaseSnapshot snap, String phaseKey) {
        if (snap == null || snap.getPhases() == null) {
            return false;
        }
        for (DevloopPhaseService.PhaseState p : snap.getPhases()) {
            if (phaseKey.equals(p.getKey())) {
                return DevloopPhaseService.ST_DONE.equals(p.getStatus());
            }
        }
        return false;
    }

    /** 当前环节收敛到前端 RequirementTask.phase 枚举:coder 前的环节统一显示 coder,全通过显示 done。 */
    private String clampReqTaskPhase(DevloopPhaseService.PhaseSnapshot snap) {
        if (snap == null || snap.getCurrentPhase() == null) {
            return "coder";
        }
        if (isPhaseDone(snap, "pr")) {
            return "done";
        }
        String cur = snap.getCurrentPhase();
        if ("reviewer".equals(cur) || "tester".equals(cur) || "pr".equals(cur)) {
            return cur;
        }
        return "coder";
    }

    /** 需求集成状态机:最近执行的终态优先,无执行时按是否全就绪落 ready/waiting_ready。 */
    private String deriveReqIntegrationStatus(boolean allCoded, IntegrationRun latestRun) {
        if (latestRun != null) {
            String st = latestRun.getStatus();
            if ("running".equals(st)) {
                return "running";
            }
            if ("passed".equals(st)) {
                return "passed";
            }
            if ("failed".equals(st) || "error".equals(st) || "timeout".equals(st)) {
                return "failed";
            }
        }
        return allCoded ? "ready" : "waiting_ready";
    }

    /** 打回条目取自会话真实 [PHASE] REJECT 打点的最后一条,避免凭空构造归因。 */
    private void appendKickback(List<Map<String, Object>> kickbackTasks, DevloopPhaseService.PhaseSnapshot snap,
        String repoName, String branch) {
        if (snap == null || snap.getKickbacks() == null || snap.getKickbacks().isEmpty()) {
            return;
        }
        DevloopPhaseService.Kickback last = snap.getKickbacks().get(snap.getKickbacks().size() - 1);
        Map<String, Object> kb = new HashMap<>();
        kb.put("repo", repoName);
        kb.put("branch", branch);
        kb.put("reason", StringUtils.defaultString(last.getReason()));
        kickbackTasks.add(kb);
    }

    /** 需求下各子任务快照的最大轮次,作为需求集成轮次展示。 */
    private int maxRound(List<ScanItemTask> tasks, Map<Long, DevloopPhaseService.PhaseSnapshot> cache) {
        int max = 1;
        for (ScanItemTask t : tasks) {
            DevloopPhaseService.PhaseSnapshot snap = snapshotFor(t.getSessionId(), cache);
            if (snap != null) {
                max = Math.max(max, snap.getRound());
            }
        }
        return max;
    }

    // ========== 需求级就绪批量集成(定时调度入口) ==========

    /**
     * 定时批量集成入口:遍历所有启用测试配置的项目,按各自 cron 到点后挑「就绪」需求触发集成。 由 DevloopIntegrationBatchJob 持分布式锁后单节点调用;单个项目失败不影响其余项目。
     */
    public void runScheduledIntegrationBatches() {
        for (TesterConfig config : testerConfigService.listEnabled()) {
            try {
                runBatchForProject(config);
            }
            catch (Exception e) {
                logger.error("[IntegrationBatch] 项目 {} 批量集成失败", config.getProjectId(), e);
            }
        }
    }

    /**
     * 失败打回引擎:扫所有「待打回」的失败执行,按项目策略归因目标环节并驱动会话回到该环节重工。 达到 maxRounds 上限则停手,按 createDefectWhenUnclear 决定是否建集成缺陷需求交人工;
     * 每条失败执行经 kickbackAt 幂等闸门只处理一次。由 DevloopIntegrationBatchJob 持锁后单节点调用。
     */
    public void runKickbackSweep() {
        List<IntegrationRun> pending = integrationRunService.listPendingKickback();
        if (pending.isEmpty()) {
            return;
        }
        // 项目策略按需缓存,避免同项目多条失败执行重复查配置。
        Map<Long, TesterConfig> configCache = new HashMap<>();
        Map<Long, DevloopPhaseService.PhaseSnapshot> snapshotCache = new HashMap<>();
        for (IntegrationRun run : pending) {
            try {
                handleKickback(run, configCache, snapshotCache);
            }
            catch (Exception e) {
                logger.error("[Kickback] 处理失败执行异常, runId={}", run.getRunId(), e);
            }
        }
    }

    /**
     * 单条失败执行的打回:autoAttribute 开启且未超轮次时驱动各子任务会话回目标环节重工; autoAttribute 关闭或轮次耗尽则停手,按 createDefectWhenUnclear 建集成缺陷交人工。
     * 无论重工还是停手,处理完都写 kickbackAt 闭合幂等闸门,避免下一轮重复驱动。
     */
    private void handleKickback(IntegrationRun run, Map<Long, TesterConfig> configCache,
        Map<Long, DevloopPhaseService.PhaseSnapshot> snapshotCache) {
        Long projectId = run.getProjectId();
        Long requirementId = run.getRequirementId();
        TesterConfig config = configCache.computeIfAbsent(projectId, testerConfigService::findByProject);
        List<ScanItemTask> tasks = scanItemTaskService.listByRequirement(requirementId);
        // 目标环节取执行侧已记的归因(finishSuccessOrFailure 落库,默认 coder)。
        String target = StringUtils.defaultIfBlank(run.getKickbackTo(), "coder");
        boolean autoAttribute = config == null || !"0".equals(config.getAutoAttribute());
        boolean createDefect = config == null || !"0".equals(config.getCreateDefectWhenUnclear());
        int maxRounds = config == null || config.getMaxRounds() == null ? 3 : config.getMaxRounds();
        int currentRound = maxRound(tasks, snapshotCache);

        // autoAttribute 关闭 = 不自动归因驱动重工,失败交人工判定;轮次耗尽同样停手交人工。
        boolean stopAndEscalate = !autoAttribute || currentRound >= maxRounds;
        if (stopAndEscalate) {
            if (createDefect) {
                createIntegrationDefect(run, requirementId, projectId, target, currentRound);
            }
            integrationRunService.markKickbackHandled(run.getRunId(), target);
            logger.info("[Kickback] 需求 {} 停止自动重工(autoAttribute={} 轮次={}/{} 建缺陷={}),转人工", requirementId, autoAttribute,
                currentRound, maxRounds, createDefect);
            return;
        }

        int driven = 0;
        for (ScanItemTask task : tasks) {
            if (task.getSessionId() == null) {
                continue;
            }
            driveSessionRework(task.getSessionId(), projectId, target, StringUtils.defaultString(run.getReason()));
            driven++;
        }
        integrationRunService.markKickbackHandled(run.getRunId(), target);
        logger.info("[Kickback] 需求 {} 失败(runId={})驱动 {} 个会话回到 {} 环节重工", requirementId, run.getRunId(), driven, target);
    }

    /** 测试员工超时上限:超过后仍无 tester DONE/REJECT 打点则判 timeout,避免 run 永久 running。 */
    private static final long INTEGRATION_TESTER_TIMEOUT_MS = 60L * 60 * 1000;

    /** 结果根目录,与 IntegrationRunExecutor.E2E_RESULT_DIR 同一口径:提示词下发它,这里回填给看板。 */
    private static final String E2E_RESULT_DIR = "/by/.sessions/%s/e2e-result";

    /**
     * 集成测试结果回收:扫「已下发测试员工、仍 running」的执行,按会话 [PHASE] tester 打点判定终态。 tester DONE=通过、tester REJECT=失败(读结构化结果文件补
     * total/passed/failed,失败记 kickbackTo 供打回引擎接手); 无打点且超时判 timeout。收尾只写本 run,不驱动重工——重工仍由 runKickbackSweep 幂等处理。 由
     * DevloopIntegrationBatchJob 持锁后单节点调用,与批量触发、打回同一周期。
     */
    public void runIntegrationResultSweep() {
        List<IntegrationRun> running = integrationRunService.listRunningWithSession();
        for (IntegrationRun run : running) {
            try {
                recoverIntegrationResult(run);
            }
            catch (Exception e) {
                logger.error("[IntegrationResult] 回收执行结果异常, runId={}", run.getRunId(), e);
            }
        }
    }

    /**
     * 单条执行的结果回收:读会话 tester 环节状态决定终态。 done→passed;rejected→failed 并记 coder 打回;两者都未到则看是否超时,超时判 timeout,否则保持 running 等下轮。
     */
    private void recoverIntegrationResult(IntegrationRun run) {
        DevloopPhaseService.PhaseSnapshot snapshot = devloopPhaseService.buildSnapshot(run.getSessionId());
        String testerStatus = phaseStatus(snapshot, "tester");

        if (DevloopPhaseService.ST_DONE.equals(testerStatus)) {
            applyIntegrationResult(run, "passed", null);
            return;
        }
        if (DevloopPhaseService.ST_REJECTED.equals(testerStatus)) {
            String reason = firstTesterRejectReason(snapshot);
            applyIntegrationResult(run, "failed", StringUtils.defaultIfBlank(reason, "测试未通过,存在失败用例"));
            return;
        }
        // 尚无 tester 终态打点:超时才收口,否则留待下轮继续等待员工完成。
        long ageMs = System.currentTimeMillis() - run.getStartedAt().getTime();
        if (ageMs >= INTEGRATION_TESTER_TIMEOUT_MS) {
            applyIntegrationResult(run, "timeout", "测试数字员工执行超时未回流结果");
        }
    }

    /**
     * 落 run 终态:读结构化结果文件补 total/passed/failed/skipped(缺失按 0);失败/超时记 coder 打回归因, 供 runKickbackSweep 接手驱动重工。durationSec 从
     * startedAt 到现在计算。
     */
    private void applyIntegrationResult(IntegrationRun run, String markerStatus, String reason) {
        // status.json 是规范页定义的真相源,信息比旧五字段文件全(带 message/截图路径);缺失才回退。
        E2eStatusDto e2eStatus = tryReadE2eStatus(run);
        IntegrationResultDto result = e2eStatus != null ? toResultDto(e2eStatus) : tryReadIntegrationResult(run);
        // 打点决定"员工干完了没",status.json 决定"结果是什么"。二者只在 error 这类细分上不同:
        // 打点只有 DONE/REJECT 两档,分不出"用例失败"与"构建/环境错误没跑到用例",而打回口径不同。
        String status = refineStatus(markerStatus, e2eStatus, run);
        if (e2eStatus != null && StringUtils.isNotBlank(e2eStatus.getReason())) {
            reason = e2eStatus.getReason();
        }
        int total = result != null && result.getTotal() != null ? result.getTotal() : 0;
        int passed = result != null && result.getPassed() != null ? result.getPassed() : 0;
        int failed = result != null && result.getFailed() != null ? result.getFailed() : 0;
        int skipped = result != null && result.getSkipped() != null ? result.getSkipped() : 0;
        // 算不平以分项之和为准,规则由 Totals.reconciledTotal 单点持有(说明见那里)。
        int sum = passed + failed + skipped;
        if (total != sum) {
            logger.warn("[IntegrationResult] runId={} 结果算不平, total={} 分项和={},以分项和为准", run.getRunId(), total, sum);
            total = sum;
        }
        run.setTotal(total);
        run.setPassed(passed);
        run.setFailed(failed);
        run.setSkipped(skipped);
        run.setResultDir(e2eStatus != null ? E2E_RESULT_DIR.formatted(run.getSessionId()) : run.getResultDir());
        // 结果详情弹窗按 suites[].failedCases 展示失败用例;从结构化结果拼一条套件结果,保留失败用例名。
        run.setSuitesJson(e2eStatus != null ? buildSuitesJsonFromStatus(run, status, e2eStatus)
            : buildSuitesJson(run, status, result));
        run.setStatus(status);
        if (!"passed".equals(status)) {
            run.setKickbackTo("coder");
            run.setReason(reason);
        }
        run.setFinishedAt(new Date());
        run.setDurationSec((int) ((System.currentTimeMillis() - run.getStartedAt().getTime()) / 1000));
        integrationRunService.update(run);
        logger.info("[IntegrationResult] runId={} 收尾 status={} total={} failed={}", run.getRunId(), status,
            run.getTotal(), run.getFailed());
    }

    /**
     * status.json 版 suites 拼装:比旧结果文件多带失败摘要、截图路径与报告/日志路径, 结果详情弹窗因此能显示"为什么挂"而不只是"哪条挂"。artifacts 是相对结果根目录的路径。
     */
    private String buildSuitesJsonFromStatus(IntegrationRun run, String status, E2eStatusDto e2eStatus) {
        IntegrationSuite suite = integrationSuiteService.findById(run.getSuiteId());
        String suiteName = suite != null ? StringUtils.defaultString(suite.getSuiteName()) : "";
        JSONArray suites = new JSONArray();
        List<E2eStatusDto.Suite> statusSuites = e2eStatus.getSuites();
        if (statusSuites == null || statusSuites.isEmpty()) {
            // 员工写了 totals 但没写 suites 明细:仍产出一条,避免详情弹窗空白。
            return buildSuitesJson(run, status, toResultDto(e2eStatus));
        }
        for (E2eStatusDto.Suite s : statusSuites) {
            JSONArray failedCases = new JSONArray();
            if (s.getFailedCases() != null) {
                for (E2eStatusDto.FailedCase fc : s.getFailedCases()) {
                    JSONObject item = new JSONObject(true);
                    item.put("caseId", StringUtils.defaultString(fc.getCaseName()));
                    item.put("message", StringUtils.defaultString(fc.getMessage()));
                    JSONArray artifacts = new JSONArray();
                    if (fc.getArtifacts() != null) {
                        artifacts.addAll(fc.getArtifacts());
                    }
                    item.put("artifacts", artifacts);
                    failedCases.add(item);
                }
            }
            JSONObject suiteResult = new JSONObject(true);
            suiteResult.put("suiteId", StringUtils.defaultIfBlank(s.getId(), String.valueOf(run.getSuiteId())));
            suiteResult.put("name", suiteName);
            suiteResult.put("status",
                StringUtils.defaultIfBlank(s.getStatus(), "passed".equals(status) ? "passed" : "failed"));
            suiteResult.put("total", nvl(run.getTotal()));
            suiteResult.put("passed", nvl(run.getPassed()));
            suiteResult.put("failed", nvl(run.getFailed()));
            suiteResult.put("durationSec", nvl(run.getDurationSec()));
            suiteResult.put("reportPath", StringUtils.defaultString(s.getReport()));
            suiteResult.put("logPath", StringUtils.defaultString(s.getLog()));
            suiteResult.put("failedCases", failedCases);
            suites.add(suiteResult);
        }
        return suites.toJSONString();
    }

    /** 把测试员工的结构化结果拼成前端 suites 契约(单套件一条),失败用例名映射为 failedCases[].caseId。 */
    private String buildSuitesJson(IntegrationRun run, String status, IntegrationResultDto result) {
        IntegrationSuite suite = integrationSuiteService.findById(run.getSuiteId());
        JSONArray failedCases = new JSONArray();
        if (result != null && result.getFailedCases() != null) {
            for (String name : result.getFailedCases()) {
                JSONObject fc = new JSONObject(true);
                fc.put("caseId", StringUtils.defaultString(name));
                fc.put("message", "");
                fc.put("artifacts", new JSONArray());
                failedCases.add(fc);
            }
        }
        JSONObject suiteResult = new JSONObject(true);
        suiteResult.put("suiteId", String.valueOf(run.getSuiteId()));
        suiteResult.put("name", suite != null ? StringUtils.defaultString(suite.getSuiteName()) : "");
        suiteResult.put("status", "passed".equals(status) ? "passed" : "failed");
        suiteResult.put("total", nvl(run.getTotal()));
        suiteResult.put("passed", nvl(run.getPassed()));
        suiteResult.put("failed", nvl(run.getFailed()));
        suiteResult.put("durationSec", nvl(run.getDurationSec()));
        suiteResult.put("reportPath", "");
        suiteResult.put("logPath", "");
        suiteResult.put("failedCases", failedCases);
        JSONArray suites = new JSONArray();
        suites.add(suiteResult);
        return suites.toJSONString();
    }

    /** status.json 里 run 级终态的封闭取值;非终态(running/preparing 等)不参与收尾判定。 */
    private static final Set<String> E2E_TERMINAL_STATUS = Set.of("passed", "failed", "error", "timeout", "cancelled");

    /**
     * 用 status.json 细化打点得出的终态。打点是收尾闸门(员工是否干完),这里只在员工明确写了 终态且与打点不同时采信文件——典型是打点 REJECT 但实际是 error(构建/环境错,没跑到用例)。
     * 超时收尾不细化:那是平台判的,员工没写完文件,采信它会把超时说成通过。
     */
    private String refineStatus(String markerStatus, E2eStatusDto e2eStatus, IntegrationRun run) {
        if (e2eStatus == null || "timeout".equals(markerStatus)) {
            return markerStatus;
        }
        String fileStatus = StringUtils.lowerCase(StringUtils.trimToEmpty(e2eStatus.getStatus()));
        if (!E2E_TERMINAL_STATUS.contains(fileStatus) || fileStatus.equals(markerStatus)) {
            return markerStatus;
        }
        logger.info("[IntegrationResult] runId={} status.json({}) 细化打点终态({})", run.getRunId(), fileStatus,
            markerStatus);
        return fileStatus;
    }

    private E2eStatusDto tryReadE2eStatus(IntegrationRun run) {
        try {
            LoginInfo owner = loginApplicationService.getLoginInfo(run.getCreateBy());
            if (owner == null || StringUtils.isBlank(owner.getUserCode())) {
                return null;
            }
            return taskStateReader.readE2eStatus(owner.getUserCode(), run.getSessionId());
        }
        catch (Exception e) {
            logger.warn("[IntegrationResult] 读 status.json 失败, runId={}, sessionId={}", run.getRunId(),
                run.getSessionId(), e);
            return null;
        }
    }

    /** status.json 的 totals/失败用例名摊平成旧五字段结构,让下游计数与看板逻辑保持单一路径。 */
    private IntegrationResultDto toResultDto(E2eStatusDto status) {
        IntegrationResultDto dto = new IntegrationResultDto();
        E2eStatusDto.Totals totals = status.getTotals();
        if (totals != null) {
            // 这里就算平,不把自相矛盾的 total 往下游传。
            dto.setTotal(totals.reconciledTotal());
            dto.setPassed(totals.getPassed());
            dto.setFailed(totals.getFailed());
            dto.setSkipped(totals.getSkipped());
        }
        List<String> names = new ArrayList<>();
        if (status.getSuites() != null) {
            for (E2eStatusDto.Suite suite : status.getSuites()) {
                if (suite.getFailedCases() == null) {
                    continue;
                }
                for (E2eStatusDto.FailedCase fc : suite.getFailedCases()) {
                    names.add(StringUtils.defaultString(fc.getCaseName()));
                }
            }
        }
        dto.setFailedCases(names);
        return dto;
    }

    private IntegrationResultDto tryReadIntegrationResult(IntegrationRun run) {
        try {
            LoginInfo owner = loginApplicationService.getLoginInfo(run.getCreateBy());
            if (owner == null || StringUtils.isBlank(owner.getUserCode())) {
                return null;
            }
            return taskStateReader.readIntegrationResult(owner.getUserCode(), run.getSessionId());
        }
        catch (Exception e) {
            logger.warn("[IntegrationResult] 读结果文件失败, runId={}, sessionId={}", run.getRunId(), run.getSessionId(), e);
            return null;
        }
    }

    /** 从快照取某环节状态;缺失按未开始。 */
    private String phaseStatus(DevloopPhaseService.PhaseSnapshot snapshot, String phaseKey) {
        if (snapshot == null || snapshot.getPhases() == null) {
            return DevloopPhaseService.ST_PENDING;
        }
        for (DevloopPhaseService.PhaseState p : snapshot.getPhases()) {
            if (phaseKey.equals(p.getKey())) {
                return p.getStatus();
            }
        }
        return DevloopPhaseService.ST_PENDING;
    }

    /** 取 tester 环节最近一次打回原因,作为失败 reason。 */
    private String firstTesterRejectReason(DevloopPhaseService.PhaseSnapshot snapshot) {
        if (snapshot == null || snapshot.getKickbacks() == null) {
            return null;
        }
        String reason = null;
        for (DevloopPhaseService.Kickback k : snapshot.getKickbacks()) {
            if ("tester".equals(k.getFrom())) {
                reason = k.getReason();
            }
        }
        return reason;
    }

    /**
     * 驱动一个会话回到目标环节重工:向既有会话发一条重工指令消息,由数字员工自身产出 [PHASE] <target> REJECT 打点完成回退(打点只信数字员工回答,后端不伪造标记)。 agentId
     * 必须显式带上:targetAgentResolver 不从会话反查,缺失会静默不触发。
     */
    private void driveSessionRework(Long sessionId, Long projectId, String target, String reason) {
        ByaiSession session = byaiSessionMapper.selectById(sessionId);
        if (session == null || session.getCreatorId() == null) {
            logger.warn("[Kickback] 会话 {} 不存在或无创建人,跳过重工驱动", sessionId);
            return;
        }
        Long userId = session.getCreatorId();
        ProjectMember member = projectMemberService.findByProjectAndUser(projectId, userId);
        if (member == null || member.getAgentId() == null) {
            logger.warn("[Kickback] 会话 {} 创建人 {} 未绑定数字员工,跳过重工驱动", sessionId, userId);
            return;
        }
        LoginInfo loginInfo = loginApplicationService.getLoginInfo(userId);
        if (loginInfo == null) {
            logger.warn("[Kickback] 会话 {} 创建人 {} 无登录信息,跳过重工驱动", sessionId, userId);
            return;
        }
        AssistantChatDto chatDto = new AssistantChatDto();
        chatDto.setSessionId(sessionId);
        chatDto.setAgentId(member.getAgentId());
        chatDto.setProjectId(projectId);
        chatDto.setAccessTerminal("DevLoop");
        chatDto.setClientRequestId(AssistantChatService.getClientRequestId());
        chatDto.setChatContent(buildReworkPrompt(target, reason));
        // 复用建任务的「提交后异步执行」通道:chat 耗时数分钟,不阻塞打回扫描。
        submitTaskChatAfterCommit(chatDto, loginInfo, sessionId);
    }

    /** 重工指令提示词:告知集成失败与目标环节,要求数字员工打 REJECT 标记并修复。 */
    private String buildReworkPrompt(String target, String reason) {
        String template = byaiSystemConfigService.findByParamCode("DEVLOOP_TASK_KICKBACK_PROMPT");
        if (template == null || template.isEmpty()) {
            template = DEFAULT_KICKBACK_PROMPT_TEMPLATE;
        }
        return template.replace("${target}", target != null ? target : "coder").replace("${reason}",
            reason != null ? reason : "");
    }

    /** 达到最大轮次仍失败:建一条集成缺陷需求(挂项目 manual 来源),交人工排查,不再自动重工。 */
    private void createIntegrationDefect(IntegrationRun run, Long requirementId, Long projectId, String target,
        int round) {
        ScanRequireItem origin = scanRequireItemMapper.selectById(requirementId);
        String originTitle = origin != null ? StringUtils.defaultString(origin.getTitle())
            : String.valueOf(requirementId);
        String title = "[集成缺陷] " + originTitle + "(第" + round + "轮仍失败)";
        String content = "需求集成在第 " + round + " 轮仍失败,已达最大重工轮次,转人工排查。\n" + "目标环节: " + target + "\n失败原因: "
            + StringUtils.defaultString(run.getReason()) + "\n关联执行 runId: " + run.getRunId();
        ScanSource source = findOrCreateManualSource(projectId);
        ScanLog log = scanLogService.createLog(source.getSourceId(), projectId);
        scanLogService.createItem(log.getLogId(), source.getSourceId(), title, content, null, null, "add");
        scanLogService.completeLog(log.getLogId(), 1, 1);
    }

    /** 打回重工提示词兜底:DB 未配置 DEVLOOP_TASK_KICKBACK_PROMPT 时使用。 */
    private static final String DEFAULT_KICKBACK_PROMPT_TEMPLATE = "本任务的集成测试未通过,需要回到「${target}」环节修复后重新交付。\n\n"
        + "## 集成失败原因\n${reason}\n\n" + "## 工作要求\n"
        + "1. 先用 self-developed-rules skill 打点 [PHASE] ${target} REJECT 集成测试失败,记录本次打回原因与目标环节。\n"
        + "2. 回到目标分支定位并修复导致集成失败的问题,完成后自测确保编译与相关测试通过。\n" + "3. 修复改动提交并推送到原任务分支,提交信息说明本次为集成失败重工。\n"
        + "4. 若失败原因不清或无法复现,明确说明遇到的问题,不要臆造修复。\n\n" + "请开始重工处理。";

    /**
     * 单项目一次批量集成:cron 到点校验 → 选就绪需求(受并发额度约束)→ 对每个启用套件各起一次挂需求的 run。 就绪 = 其下所有子任务 coder 环节 done(requireAllCoded
     * 关闭时不校验)且尚无挂需求的执行; 失败后的重集成属打回引擎(Phase D)显式触发,不由本批量循环重复起。
     */
    private void runBatchForProject(TesterConfig config) {
        Long projectId = config.getProjectId();
        // 挂需求的执行只由批量写入,故最新一条即「上次批量时间」,据此判断本项目 cron 是否到点。
        List<IntegrationRun> reqRuns = integrationRunService.listWithRequirementByProject(projectId);
        Date lastBatchAt = reqRuns.isEmpty() ? null : reqRuns.get(0).getCreateTime();
        if (!isBatchDue(config.getCron(), config.getTimezone(), lastBatchAt)) {
            return;
        }
        List<IntegrationSuite> enabledSuites = integrationSuiteService.listByProjectId(projectId).stream()
            .filter(s -> "1".equals(s.getEnabled())).collect(java.util.stream.Collectors.toList());
        if (enabledSuites.isEmpty()) {
            logger.info("[IntegrationBatch] 项目 {} 无启用套件,跳过", projectId);
            return;
        }
        List<IntegrationEnv> envs = integrationEnvService.listByProjectId(projectId);
        if (envs.isEmpty()) {
            logger.info("[IntegrationBatch] 项目 {} 无集成环境,跳过", projectId);
            return;
        }
        Long envId = envs.get(0).getEnvId();

        // 按需求取最新执行:判断是否在跑(占额度)与是否已有挂需求执行(不重复入选)。
        Map<Long, IntegrationRun> latestRunByReq = new HashMap<>();
        for (IntegrationRun run : reqRuns) {
            latestRunByReq.putIfAbsent(run.getRequirementId(), run);
        }
        boolean requireAllCoded = !"0".equals(config.getRequireAllCoded());
        Map<Long, DevloopPhaseService.PhaseSnapshot> snapshotCache = new HashMap<>();
        Map<Long, List<ScanItemTask>> tasksByReq = new LinkedHashMap<>();
        for (ScanItemTask t : scanItemTaskService.listByProject(projectId)) {
            tasksByReq.computeIfAbsent(t.getRequirementId(), k -> new ArrayList<>()).add(t);
        }
        // 并发额度:同一时刻在跑的需求数不超过 maxConcurrentReqs;已在跑的先扣掉。
        int maxConcurrent = config.getMaxConcurrentReqs() == null ? 2 : config.getMaxConcurrentReqs();
        int running = 0;
        List<Long> readyReqIds = new ArrayList<>();
        for (Map.Entry<Long, List<ScanItemTask>> entry : tasksByReq.entrySet()) {
            IntegrationRun latest = latestRunByReq.get(entry.getKey());
            if (latest != null) {
                if ("running".equals(latest.getStatus())) {
                    running++;
                }
                // 已有挂需求执行:重集成由打回引擎接管,批量不重复入选。
                continue;
            }
            if (requireAllCoded && !allTasksCoded(entry.getValue(), snapshotCache)) {
                continue;
            }
            readyReqIds.add(entry.getKey());
        }
        int slots = maxConcurrent - running;
        if (slots <= 0 || readyReqIds.isEmpty()) {
            return;
        }
        Long operatorId = config.getUpdateBy() != null ? config.getUpdateBy() : config.getCreateBy();
        int admitted = 0;
        for (Long reqId : readyReqIds) {
            if (admitted >= slots) {
                break;
            }
            for (IntegrationSuite suite : enabledSuites) {
                integrationRunService.startRun(suite.getSuiteId(), envId, operatorId, reqId);
            }
            admitted++;
        }
        logger.info("[IntegrationBatch] 项目 {} 触发 {} 个就绪需求 × {} 个套件", projectId, admitted, enabledSuites.size());
    }

    /** 需求下所有子任务的 coder 环节是否都 done(空需求视为未就绪)。 */
    private boolean allTasksCoded(List<ScanItemTask> tasks, Map<Long, DevloopPhaseService.PhaseSnapshot> cache) {
        if (tasks.isEmpty()) {
            return false;
        }
        for (ScanItemTask t : tasks) {
            if (!isPhaseDone(snapshotFor(t.getSessionId(), cache), "coder")) {
                return false;
            }
        }
        return true;
    }

    /**
     * 本项目批量 cron 是否到点:以上次批量时间为基准算下一次应跑时间,已过则到点。 首次(无上次批量)、cron 为空、或解析失败时到点(避免漏跑),按配置时区比较。
     */
    private boolean isBatchDue(String cron, String timezone, Date lastBatchAt) {
        if (cron == null || cron.trim().isEmpty() || lastBatchAt == null) {
            return true;
        }
        java.time.ZoneId zone = resolveZone(timezone);
        try {
            org.springframework.scheduling.support.CronExpression expr = org.springframework.scheduling.support.CronExpression
                .parse(toSpringCron(cron));
            java.time.LocalDateTime last = java.time.LocalDateTime.ofInstant(lastBatchAt.toInstant(), zone);
            java.time.LocalDateTime nextDue = expr.next(last);
            return nextDue != null && !nextDue.isAfter(java.time.LocalDateTime.now(zone));
        }
        catch (Exception e) {
            logger.warn("[IntegrationBatch] 无效 cron '{}',本次按到点处理", cron, e);
            return true;
        }
    }

    /** 解析配置时区,非法或为空退回 Asia/Shanghai(与出厂默认一致)。 */
    private java.time.ZoneId resolveZone(String timezone) {
        if (timezone == null || timezone.trim().isEmpty()) {
            return java.time.ZoneId.of("Asia/Shanghai");
        }
        try {
            return java.time.ZoneId.of(timezone.trim());
        }
        catch (Exception e) {
            return java.time.ZoneId.of("Asia/Shanghai");
        }
    }

    /** 5 段 Unix cron(分 时 日 月 周)补秒位成 Spring 6 段;已是 6 段原样返回。 */
    private String toSpringCron(String cron) {
        String trimmed = cron.trim();
        return trimmed.split("\\s+").length == 5 ? "0 " + trimmed : trimmed;
    }

    /** 实体 → 嵌套 VO(对齐前端 TesterConfig);entity 为空时返回出厂默认,前端可直接编辑保存。 */
    private Map<String, Object> testerConfigToVo(TesterConfig entity, Long projectId) {
        Map<String, Object> map = new HashMap<>();
        map.put("projectId", entity != null && entity.getProjectId() != null ? entity.getProjectId() : projectId);
        map.put("enabled", entity == null || !"0".equals(entity.getEnabled()));

        Map<String, Object> schedule = new HashMap<>();
        schedule.put("cron", entity == null ? "0 2 * * *" : entity.getCron());
        schedule.put("cronLabel", entity == null ? "每日 02:00" : entity.getCronLabel());
        schedule.put("timezone",
            entity == null || entity.getTimezone() == null ? "Asia/Shanghai" : entity.getTimezone());
        map.put("schedule", schedule);

        Map<String, Object> admission = new HashMap<>();
        admission.put("requireAllCoded", entity == null || !"0".equals(entity.getRequireAllCoded()));
        admission.put("maxConcurrentReqs",
            entity == null || entity.getMaxConcurrentReqs() == null ? 2 : entity.getMaxConcurrentReqs());
        map.put("admission", admission);

        Map<String, Object> kickback = new HashMap<>();
        kickback.put("autoAttribute", entity == null || !"0".equals(entity.getAutoAttribute()));
        kickback.put("createDefectWhenUnclear", entity == null || !"0".equals(entity.getCreateDefectWhenUnclear()));
        kickback.put("maxRounds", entity == null || entity.getMaxRounds() == null ? 3 : entity.getMaxRounds());
        map.put("kickback", kickback);
        return map;
    }

    /** Boolean → CHAR(1) 标记;null 取给定默认。 */
    private String boolToFlag(Boolean value, String defaultFlag) {
        if (value == null) {
            return defaultFlag;
        }
        return value ? "1" : "0";
    }

    // ========== 集成测试执行 ==========

    /**
     * 触发一次「执行测试」:秒回 runId,后台异步跑 stages + 套件命令并轮询。 executorMode 由前端弹框按次指定(默认 backend 直跑,便于人工调试);传空走全局配置的正式形态。
     */
    public ResponseUtil<Map<String, Object>> startIntegrationRun(Long suiteId, Long envId, String executorMode) {
        IntegrationRun run = integrationRunService.startRun(suiteId, envId, CurrentUserHolder.getCurrentUserId(), null,
            executorMode);
        Map<String, Object> result = new HashMap<>();
        result.put("runId", run.getRunId());
        return ResponseUtil.successResponse(result);
    }

    /** 查询一次执行的完整结果(对齐前端 IntegrationRunResult),供轮询。 */
    public ResponseUtil<Map<String, Object>> getIntegrationRun(Long runId) {
        IntegrationRun run = integrationRunService.getRun(runId);
        if (run == null) {
            return ResponseUtil.fail("执行记录不存在: " + runId);
        }
        List<IntegrationRunStep> steps = integrationRunService.listSteps(runId);
        return ResponseUtil.successResponse(runToResultVo(run, steps));
    }

    /**
     * 按需读取该次执行的报告原文,供前端下载/在线预览。原文不落库,每次查看重新去环境机取。 方法名以 get 开头,保证 SSH 往返期间不占用写事务与数据库连接。
     */
    public ResponseUtil<Map<String, Object>> getIntegrationRunReport(Long runId) {
        // tester 模式的报告已由员工拷进沙箱结果目录,直接读;读不到才回退 SSH 去环境机取
        // (backend 直跑模式的报告只在环境机上)。
        Map<String, Object> sandboxReport = trySandboxReport(runId);
        if (sandboxReport != null) {
            return ResponseUtil.successResponse(sandboxReport);
        }
        IntegrationRunExecutor.ReportContent report = integrationRunService.getRunReport(runId);
        if (report.getError() != null) {
            return ResponseUtil.fail(report.getError());
        }
        Map<String, Object> result = new HashMap<>();
        result.put("path", report.getPath());
        result.put("content", report.getContent());
        return ResponseUtil.successResponse(result);
    }

    /**
     * 从沙箱结果目录读报告。路径取 status.json 里该套件的 report 字段(相对结果根目录), 不猜路径:员工可能按不同套件ID命名。取不到返回 null 让调用方走 SSH 回退。
     */
    private Map<String, Object> trySandboxReport(Long runId) {
        try {
            IntegrationRun run = integrationRunService.getRun(runId);
            if (run == null || run.getSessionId() == null) {
                return null;
            }
            LoginInfo owner = loginApplicationService.getLoginInfo(run.getCreateBy());
            if (owner == null || StringUtils.isBlank(owner.getUserCode())) {
                return null;
            }
            E2eStatusDto status = taskStateReader.readE2eStatus(owner.getUserCode(), run.getSessionId());
            if (status == null || status.getSuites() == null || status.getSuites().isEmpty()) {
                return null;
            }
            String reportPath = status.getSuites().get(0).getReport();
            String content = taskStateReader.readE2eArtifactText(owner.getUserCode(), run.getSessionId(), reportPath);
            if (StringUtils.isBlank(content)) {
                return null;
            }
            Map<String, Object> result = new HashMap<>();
            result.put("path", reportPath);
            result.put("content", content);
            return result;
        }
        catch (Exception e) {
            logger.warn("[IntegrationReport] 读沙箱报告失败, runId={}", runId, e);
            return null;
        }
    }

    /** 查询某套件的历史执行列表。 */
    public ResponseUtil<List<Map<String, Object>>> listIntegrationRuns(Long suiteId) {
        List<Map<String, Object>> list = integrationRunService.listBySuiteId(suiteId).stream().map(this::runToHistoryVo)
            .collect(java.util.stream.Collectors.toList());
        return ResponseUtil.successResponse(list);
    }

    /** 查询某环境的历史执行列表。 */
    public ResponseUtil<List<Map<String, Object>>> listIntegrationRunsByEnv(Long envId) {
        List<Map<String, Object>> list = integrationRunService.listByEnvId(envId).stream().map(this::runToHistoryVo)
            .collect(java.util.stream.Collectors.toList());
        return ResponseUtil.successResponse(list);
    }

    /** run + steps + 解析出的 suites 组装成前端 IntegrationRunResult 契约(camelCase)。 */
    private Map<String, Object> runToResultVo(IntegrationRun run, List<IntegrationRunStep> steps) {
        Map<String, Object> map = new HashMap<>();
        map.put("runId", String.valueOf(run.getRunId()));
        map.put("version", "");
        map.put("status", run.getStatus());
        map.put("round", 1);
        map.put("branch", StringUtils.defaultString(run.getBranch()));
        map.put("commit", StringUtils.defaultString(run.getCommitRef()));
        IntegrationEnv env = integrationEnvService.findById(run.getEnvId());
        map.put("envName", env != null ? env.getEnvName() : "");
        map.put("startedAt", formatDateTime(run.getStartedAt()));
        map.put("finishedAt", formatDateTime(run.getFinishedAt()));
        map.put("durationSec", run.getDurationSec());

        Map<String, Object> totals = new HashMap<>();
        totals.put("total", nvl(run.getTotal()));
        totals.put("passed", nvl(run.getPassed()));
        totals.put("failed", nvl(run.getFailed()));
        totals.put("skipped", nvl(run.getSkipped()));
        map.put("totals", totals);

        map.put("kickbackTo", StringUtils.defaultString(run.getKickbackTo()));
        map.put("reason", StringUtils.defaultString(run.getReason()));
        map.put("resultDir", StringUtils.defaultString(run.getResultDir()));
        // suites 由 executor 解析 JUnit 后落 suites_json;无报告时为空数组。
        map.put("suites", StringUtils.isNotBlank(run.getSuitesJson()) ? JSON.parseArray(run.getSuitesJson())
            : new java.util.ArrayList<>());
        // steps 明细:前端渲染逐步进度(契约外的补充字段,便于展示执行过程)。
        map.put("steps", steps.stream().map(this::runStepToVo).collect(java.util.stream.Collectors.toList()));
        return map;
    }

    private Map<String, Object> runStepToVo(IntegrationRunStep s) {
        Map<String, Object> map = new HashMap<>();
        map.put("seq", s.getSeq());
        map.put("stepType", s.getStepType());
        map.put("stepName", s.getStepName());
        map.put("exitCode", s.getExitCode());
        map.put("status", s.getStatus());
        map.put("durationSec", s.getDurationSec());
        map.put("logText", s.getLogText());
        map.put("startedAt", s.getStartedAt());
        map.put("finishedAt", s.getFinishedAt());
        return map;
    }

    /** run 组装成历史列表项(对齐前端 integrationHistoryList)。 */
    private Map<String, Object> runToHistoryVo(IntegrationRun run) {
        Map<String, Object> map = new HashMap<>();
        map.put("runId", String.valueOf(run.getRunId()));
        map.put("suiteId", run.getSuiteId());
        map.put("status", run.getStatus());
        map.put("branch", StringUtils.defaultString(run.getBranch()));
        map.put("round", 1);
        int total = nvl(run.getTotal());
        int passed = nvl(run.getPassed());
        map.put("passRate", total > 0 ? Math.round(passed * 100.0 / total) : 0);
        map.put("total", total);
        map.put("passed", passed);
        map.put("failed", nvl(run.getFailed()));
        map.put("kickbackTo", StringUtils.defaultString(run.getKickbackTo()));
        map.put("reason", StringUtils.defaultString(run.getReason()));
        map.put("durationSec", run.getDurationSec());
        map.put("time", formatDateTime(run.getCreateTime()));
        map.put("createByName", resolveUserName(run.getCreateBy()));
        return map;
    }

    private int nvl(Integer v) {
        return v == null ? 0 : v;
    }

    /** run 时间统一格式化为 yyyy-MM-dd HH:mm:ss 字符串,前端直接展示,避免 Date 序列化歧义。 */
    private String formatDateTime(Date date) {
        if (date == null) {
            return "";
        }
        return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(date);
    }

    /** 字符串 userId 转 Long,非法返回 null(供 resolveUserName 等按 Long 取用户名)。 */
    private Long parseUserId(String userId) {
        if (userId == null || userId.trim().isEmpty()) {
            return null;
        }
        try {
            return Long.valueOf(userId.trim());
        }
        catch (NumberFormatException e) {
            return null;
        }
    }

    /** 启用或停用扫描源 */
    public ResponseUtil<Void> toggleScanSource(Long sourceId, String enabled) {
        String operationDenied = rejectOperationSourceMutation(sourceId);
        if (operationDenied != null) {
            return ResponseUtil.failRes(operationDenied);
        }
        ScanSource source = new ScanSource();
        source.setSourceId(sourceId);
        source.setEnabled(enabled);
        scanSourceService.update(source);
        return ResponseUtil.successResponse(null);
    }

    /**
     * 运营需求由专用接口管理；通用扫描源接口不能绕过“启动后不可编辑、不可暂停恢复”的业务规则。 研发渠道继续沿用原有修改、删除和启停流程。
     */
    private String rejectOperationSourceMutation(Long sourceId) {
        ScanSource source = sourceId == null ? null : scanSourceService.findById(sourceId);
        if (source != null && ScanSourceService.OPERATION_SOURCE_TYPES.contains(source.getSourceType())) {
            return I18nUtil.get("devloop.operationRequirement.source.manage.forbidden");
        }
        return null;
    }

    /** 手动触发一次扫描，根据源类型调用对应扫描服务 */
    public ResponseUtil<Map<String, Object>> triggerScan(Long sourceId) {
        ScanSource source = scanSourceService.findById(sourceId);
        if (source == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.source.not.found"));
        }

        List<ScanRequireItem> items;
        String type = source.getSourceType();
        if ("github_issue".equals(type)) {
            String pat = patService.getGitHubPat(source.getCreateBy());
            if (pat == null) {
                return ResponseUtil.failRes(I18nUtil.get("devloop.github.pat.not.configured"));
            }
            items = gitHubIssueScanService.scan(source, pat);
        }
        else if ("dingtalk".equals(type)) {
            items = dingtalkScanService.scan(source);
            if (items == null) {
                return ResponseUtil.failRes(I18nUtil.get("devloop.dingtalk.scan.failed"));
            }
        }
        else if ("dingtalk_todo".equals(type)) {
            items = dingtalkTodoScanService.scan(source);
            if (items == null) {
                return ResponseUtil.failRes(I18nUtil.get("devloop.dingtalk.todo.scan.failed"));
            }
        }
        else {
            return ResponseUtil.failRes(I18nUtil.get("devloop.source.type.unsupported", type));
        }

        // 一次 LLM 调用完成拆分+评分，返回派发列表（子需求+未拆分条），再按确认规则派生
        List<ScanRequireItem> dispatchItems = scoringService.splitAndScore(items);
        autoDeriveForSource(source, dispatchItems);

        Map<String, Object> result = new HashMap<>();
        result.put("createdCount", dispatchItems.size());
        return ResponseUtil.successResponse(result);
    }

    /** 查询扫描日志列表 */
    public ResponseUtil<List<Map<String, Object>>> listScanLogs(Long sourceId, int limit) {
        List<ScanLog> logs = scanLogService.listBySourceId(sourceId, limit);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ScanLog l : logs) {
            Map<String, Object> map = new HashMap<>();
            map.put("logId", l.getLogId());
            map.put("scanTime", l.getScanTime());
            map.put("foundCount", l.getFoundCount());
            map.put("createdCount", l.getCreatedCount());
            map.put("status", l.getStatus());
            map.put("errorMsg", l.getErrorMsg());
            list.add(map);
        }
        return ResponseUtil.successResponse(list);
    }

    /** 查询单次扫描的详细条目 */
    public ResponseUtil<List<Map<String, Object>>> listScanRequireItems(Long logId) {
        List<ScanRequireItem> items = scanLogService.listItemsByLogId(logId);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ScanRequireItem item : items) {
            list.add(toRequirementMap(item));
        }
        return ResponseUtil.successResponse(list);
    }

    /**
     * 按扫描源直接查询已收集的需求(action=created)，供需求列表展示。 需求随日志滚动，按“最近N条日志”遍历会漏掉早期扫到的需求，故直接按 source 查条目。
     */
    public ResponseUtil<List<Map<String, Object>>> listRequirementsBySource(Long sourceId) {
        List<ScanRequireItem> items = scanLogService.listCreatedItemsBySource(sourceId);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ScanRequireItem item : items) {
            list.add(toRequirementMap(item));
        }
        return ResponseUtil.successResponse(list);
    }

    /**
     * 按项目一次查全部需求(action=created)，DB 层按创建时间倒序，供需求列表直查。 只查两次(源列表 + 条目 IN 源)，替代前端逐源循环请求(N+1)与内存排序；顺带回填
     * sourceName/sourceType。
     */
    public ResponseUtil<List<Map<String, Object>>> listRequirementsByProject(Long projectId) {
        return listRequirementsByProject(projectId, null);
    }

    /** 按项目查询已收集需求，并仅按需求名称筛选匹配的条目。 */
    public ResponseUtil<List<Map<String, Object>>> listRequirementsByProject(Long projectId, String title) {
        List<ScanSource> sources = scanSourceService.listByProjectId(projectId).stream()
            .filter(source -> !ScanSourceService.OPERATION_SOURCE_TYPES.contains(source.getSourceType()))
            .collect(java.util.stream.Collectors.toList());
        if (sources.isEmpty()) {
            return ResponseUtil.successResponse(new ArrayList<>());
        }
        Map<Long, ScanSource> sourceById = new HashMap<>();
        List<Long> sourceIds = new ArrayList<>();
        for (ScanSource s : sources) {
            sourceById.put(s.getSourceId(), s);
            sourceIds.add(s.getSourceId());
        }
        List<ScanRequireItem> items = scanLogService.listCreatedItemsBySources(sourceIds, title);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ScanRequireItem item : items) {
            list.add(toRequirementMap(item, sourceById.get(item.getSourceId())));
        }
        return ResponseUtil.successResponse(list);
    }

    /**
     * 新建手工需求，复用扫描日志存储，使需求列表、任务启动和任务详情继续沿用既有关联链路。 每个项目只维护一个禁用的内部来源，不参与定时扫描或渠道配置。
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Map<String, Object>> createManualRequirement(ManualRequirementDTO dto) {
        if (dto == null || dto.getProjectId() == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.projectId.required"));
        }
        String title = StringUtils.trimToNull(dto.getTitle());
        if (title == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.title.required"));
        }
        String originalContent = StringUtils.trimToNull(dto.getOriginalContent());
        if (originalContent == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.originalContent.required"));
        }
        String originType = StringUtils.defaultIfBlank(dto.getSourceType(), "manual").trim();
        if (!MANUAL_REQUIREMENT_ORIGIN_TYPES.contains(originType)) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.sourceType.unsupported"));
        }
        if (!isProjectRepo(dto.getProjectId(), dto.getRepoId())) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.repo.invalid"));
        }

        ScanSource source = findOrCreateManualSource(dto.getProjectId());
        ScanLog log = scanLogService.createLog(source.getSourceId(), dto.getProjectId());
        ScanRequireItem item = scanLogService.createItem(
            log.getLogId(), source.getSourceId(), title, serializeManualRequirementContent(originType, dto.getBranch(),
                dto.getRepoId(), originalContent, dto.getProductContent()),
            "manual:" + UUID.randomUUID(), null, "created");
        scanLogService.completeLog(log.getLogId(), 1, 1);

        return ResponseUtil.successResponse(toRequirementMap(item, source));
    }

    /**
     * 修改手工录入需求。需求必须仍未启动，且通过内部 manual 来源和 JSON 包裹双重识别， 防止扫描渠道需求被误改。
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Map<String, Object>> updateManualRequirement(ManualRequirementUpdateDTO dto) {
        if (dto == null || dto.getItemId() == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.itemId.required"));
        }
        String title = StringUtils.trimToNull(dto.getTitle());
        if (title == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.title.required"));
        }
        String originalContent = StringUtils.trimToNull(dto.getOriginalContent());
        if (originalContent == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.originalContent.required"));
        }
        String originType = StringUtils.defaultIfBlank(dto.getSourceType(), "manual").trim();
        if (!MANUAL_REQUIREMENT_ORIGIN_TYPES.contains(originType)) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.sourceType.unsupported"));
        }

        ScanRequireItem item = scanRequireItemMapper.selectById(dto.getItemId());
        ScanSource source = getEditableManualRequirementSource(item);
        if (source == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.edit.forbidden"));
        }
        if (!isProjectRepo(source.getProjectId(), dto.getRepoId())) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.repo.invalid"));
        }

        ScanRequireItem updateItem = new ScanRequireItem();
        updateItem.setTitle(title);
        updateItem.setContent(serializeManualRequirementContent(originType, dto.getBranch(), dto.getRepoId(),
            originalContent, dto.getProductContent()));
        LambdaUpdateWrapper<ScanRequireItem> updateWrapper = new LambdaUpdateWrapper<ScanRequireItem>()
            .eq(ScanRequireItem::getItemId, dto.getItemId()).eq(ScanRequireItem::getAction, "created")
            .isNull(ScanRequireItem::getSessionId);
        if (scanRequireItemMapper.update(updateItem, updateWrapper) == 0) {
            // 与创建任务并发时，由条件更新保证已启动需求不会被覆盖。
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.edit.forbidden"));
        }

        item.setTitle(updateItem.getTitle());
        item.setContent(updateItem.getContent());
        return ResponseUtil.successResponse(toRequirementMap(item, source));
    }

    /**
     * 删除手工录入需求。先验证手工且未启动，再核对所属项目创建者，最后使用条件删除应对并发启动任务。
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> deleteManualRequirement(ManualRequirementDeleteDTO dto) {
        if (dto == null || dto.getItemId() == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.itemId.required"));
        }

        ScanRequireItem item = scanRequireItemMapper.selectById(dto.getItemId());
        ScanSource source = getEditableManualRequirementSource(item);
        if (source == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.delete.forbidden"));
        }

        Project project = projectMapper.selectById(source.getProjectId());
        if (project == null || DELETE_FLAG_DELETED.equals(project.getDeleteFlag())) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.project.notFound"));
        }
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (currentUserId == null || !currentUserId.equals(project.getCreateBy())) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.delete.creator.required"));
        }

        LambdaQueryWrapper<ScanRequireItem> deleteWrapper = new LambdaQueryWrapper<ScanRequireItem>()
            .eq(ScanRequireItem::getItemId, dto.getItemId()).eq(ScanRequireItem::getAction, "created")
            .isNull(ScanRequireItem::getSessionId);
        if (scanRequireItemMapper.delete(deleteWrapper) == 0) {
            // 与创建任务并发时，由条件删除保证已启动需求不会被删除。
            return ResponseUtil.failRes(I18nUtil.get("devloop.manualRequirement.delete.forbidden"));
        }
        return ResponseUtil.successResponse(null);
    }

    /**
     * 返回可编辑的手工需求来源；未启动、内部 manual 来源且内容可解析时才放行。 该校验同时保证外部扫描需求保持原有只读行为。
     */
    private ScanSource getEditableManualRequirementSource(ScanRequireItem item) {
        if (item == null || item.getSourceId() == null || item.getSessionId() != null
            || !"created".equals(item.getAction())) {
            return null;
        }
        ScanSource source = scanSourceService.findById(item.getSourceId());
        if (source == null || !MANUAL_SOURCE_TYPE.equals(source.getSourceType())) {
            return null;
        }
        return parseManualRequirementContent(item.getContent()) == null ? null : source;
    }

    /**
     * 每个项目复用一个禁用来源，因为扫描条目、任务派生和需求查询都通过 sourceId 关联。 该来源永不作为外部扫描渠道被调度。
     */
    private ScanSource findOrCreateManualSource(Long projectId) {
        for (ScanSource source : scanSourceService.listByProjectId(projectId)) {
            if (MANUAL_SOURCE_TYPE.equals(source.getSourceType())) {
                return source;
            }
        }

        ScanSource source = new ScanSource();
        source.setProjectId(projectId);
        source.setSourceName(MANUAL_SOURCE_NAME);
        source.setSourceType(MANUAL_SOURCE_TYPE);
        source.setConfig("{}");
        source.setEnabled("0");
        source.setConfirmMode("manual");
        source.setCreateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        return scanSourceService.create(source);
    }

    /**
     * 校验关联仓库归属当前项目。手工需求的仓库可为空，以兼容历史数据和项目尚未配置仓库的场景。
     */
    private boolean isProjectRepo(Long projectId, Long repoId) {
        return repoId == null || findProjectRepo(projectId, repoId) != null;
    }

    /**
     * 按项目范围查找仓库，避免请求参数或历史异常数据关联到其他项目的仓库。
     */
    private ProjectRepo findProjectRepo(Long projectId, Long repoId) {
        if (projectId == null || repoId == null) {
            return null;
        }
        ProjectRepo repo = projectRepoMapper.selectById(repoId);
        return repo != null && projectId.equals(repo.getProjectId()) ? repo : null;
    }

    /**
     * 将语言无关字段保存为带命名空间的 JSON 包裹，而不存已渲染的文案。 既可无歧义解析，也兼容历史和第三方渠道的纯文本扫描内容。
     */
    private String serializeManualRequirementContent(String originType, String branch, Long repoId,
        String originalContent, String productContent) {
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("sourceType", originType);
        content.put("branch", StringUtils.trimToEmpty(branch));
        // 仓库归属写入单条需求，项目共用的 manual 扫描源不保存 repoId，避免互相覆盖。
        content.put("repoId", repoId);
        content.put("originalContent", originalContent);
        content.put("productContent", StringUtils.trimToEmpty(productContent));
        try {
            return MANUAL_REQUIREMENT_MAPPER.writeValueAsString(Map.of(MANUAL_REQUIREMENT_CONTENT_KEY, content));
        }
        catch (Exception e) {
            throw new IllegalStateException(I18nUtil.get("devloop.manualRequirement.content.serialize.failed"), e);
        }
    }

    private Map<String, Object> toRequirementMap(ScanRequireItem item) {
        return toRequirementMap(item, null);
    }

    /**
     * 扫描条目转统一需求视图；手工来源名称与内容在读取时国际化，避免持久化内部标识和已渲染文案。
     */
    private Map<String, Object> toRequirementMap(ScanRequireItem item, ScanSource source) {
        Map<String, Object> map = new HashMap<>();
        map.put("itemId", item.getItemId());
        map.put("title", item.getTitle());
        // 需求列表展开态需要展示完整内容，并据 sessionId 判断是否已启动。
        ManualRequirementContent manualContent = parseManualRequirementContent(item.getContent());
        map.put("content", manualContent != null ? formatManualRequirementContent(manualContent) : item.getContent());
        map.put("originId", item.getOriginId());
        map.put("originUrl", item.getOriginUrl());
        map.put("action", item.getAction());
        map.put("sessionId", item.getSessionId());
        map.put("score", item.getScore());
        map.put("priority", item.getPriority());
        map.put("scoreDetail", item.getScoreDetail());
        map.put("createTime", item.getCreateTime());
        map.put("sourceId", item.getSourceId());
        if (manualContent != null) {
            map.put("manualSourceType", manualContent.sourceType());
            map.put("branch", manualContent.branch());
            // 历史手工需求 JSON 中没有 repoId 时返回 null，继续沿用项目仓库兜底逻辑。
            map.put("repoId", manualContent.repoId());
            map.put("originalContent", manualContent.originalContent());
            map.put("productContent", manualContent.productContent());
        }
        if (source != null) {
            map.put("sourceName",
                MANUAL_SOURCE_TYPE.equals(source.getSourceType())
                    ? I18nUtil.get("devloop.manualRequirement.source.name")
                    : source.getSourceName());
            map.put("sourceType", source.getSourceType());
        }
        return map;
    }

    /**
     * 获取需求视图和 LLM 任务提示词共用的可读描述。 格式化在当前执行上下文完成，再交给异步会话执行。
     */
    private String getRequirementContent(ScanRequireItem item) {
        if (item == null) {
            return "";
        }
        ManualRequirementContent manualContent = parseManualRequirementContent(item.getContent());
        return manualContent != null ? formatManualRequirementContent(manualContent)
            : StringUtils.defaultString(item.getContent());
    }

    /**
     * 仅解析手工录入 JSON 包裹；格式错误、缺失包裹或字段不完整时返回 {@code null}， 保留已有扫描需求的原始内容路径。
     */
    private ManualRequirementContent parseManualRequirementContent(String content) {
        if (StringUtils.isBlank(content)) {
            return null;
        }
        try {
            JsonNode root = MANUAL_REQUIREMENT_MAPPER.readTree(content);
            JsonNode manual = root.path(MANUAL_REQUIREMENT_CONTENT_KEY);
            if (!manual.isObject()) {
                return null;
            }
            String originalContent = StringUtils.trimToNull(manual.path("originalContent").asText());
            if (originalContent == null) {
                return null;
            }
            JsonNode repoIdNode = manual.path("repoId");
            // 兼容未保存 repoId 的历史 JSON；仅接受正整数，异常值视为未关联仓库。
            Long repoId = repoIdNode.isIntegralNumber() && repoIdNode.canConvertToLong() && repoIdNode.asLong() > 0
                ? repoIdNode.asLong()
                : null;
            return new ManualRequirementContent(manual.path("sourceType").asText("manual"),
                manual.path("branch").asText(""), repoId, originalContent, manual.path("productContent").asText(""));
        }
        catch (Exception ignored) {
            return null;
        }
    }

    /**
     * 使用当前请求语言格式化持久化的手工字段。禁止把结果再存回库： 后续读取者的语言可能不同，JSON 包裹保持语言无关。
     */
    private String formatManualRequirementContent(ManualRequirementContent content) {
        StringBuilder description = new StringBuilder();
        description.append(I18nUtil.get("devloop.manualRequirement.content.source",
            manualRequirementOriginLabel(content.sourceType()))).append('\n');
        if (StringUtils.isNotBlank(content.branch())) {
            description.append(I18nUtil.get("devloop.manualRequirement.content.branch", content.branch())).append('\n');
        }
        if (StringUtils.isNotBlank(content.productContent())) {
            description.append(I18nUtil.get("devloop.manualRequirement.content.product")).append('\n')
                .append(content.productContent()).append("\n\n");
        }
        description.append(I18nUtil.get("devloop.manualRequirement.content.original")).append('\n')
            .append(content.originalContent());
        return description.toString();
    }

    /** 将持久化来源标识转换为当前语言的展示名称。 */
    private String manualRequirementOriginLabel(String originType) {
        return switch (originType) {
            case "customer_feedback" -> I18nUtil.get("devloop.manualRequirement.origin.customerFeedback");
            case "internal_proposal" -> I18nUtil.get("devloop.manualRequirement.origin.internalProposal");
            default -> I18nUtil.get("devloop.manualRequirement.origin.manual");
        };
    }

    /**
     * 根据知识库资源 ID 分页查询对象基本信息，可选按知识库目录列表和对象名称进一步过滤。返回结果不包含对象的 properties 和 actions。
     *
     * @param paramReq 请求对象
     * @return QueryByKnowledgeResp
     */
    public QueryByKnowledgeResp queryObjectsByKnowledge(QueryByKnowledgeReq paramReq) {
        DataCloudResponse<QueryByKnowledgeResp> resp = feignDataCloudService.queryObjectsByKnowledge(paramReq);
        return resp.getData();
    }

    /**
     * 保存对象实例到知识库
     *
     * @param params 请求参数
     * @return InvokeActionResp
     */
    public InvokeActionResp saveObjectInstanceToKb(Params params) {
        InvokeActionReq invokeActionReq = new InvokeActionReq();
        invokeActionReq.setParams(params);
        DataCloudResponse<InvokeActionResp> response = feignDataCloudService.invokeAction(invokeActionReq);
        return response.getData();
    }

    /**
     * 批量保存或更新项目业务对象关联文件。
     *
     * @param objectFileSaveDTO 批量保存请求
     * @return 保存后的实体列表
     */
    public List<ProjectObjectFile> saveOrUpdateObjectFiles(ObjectFileSaveDTO objectFileSaveDTO) {

        List<ObjectFileDTO> objectFiles = objectFileSaveDTO.getObjectFiles();
        if (ListUtil.isEmpty(objectFiles)) {
            return Collections.emptyList();
        }

        List<ProjectObjectFile> resultList = new ArrayList<>(objectFiles.size());

        for (ObjectFileDTO objectFileDTO : objectFiles) {
            ProjectObjectFile projectObjectFile = new ProjectObjectFile();
            projectObjectFile.setSessionId(objectFileDTO.getSessionId());
            projectObjectFile.setObjectName(objectFileDTO.getObjectName());
            projectObjectFile.setObjectCode(objectFileDTO.getObjectCode());
            projectObjectFile.setFileName(objectFileDTO.getFileName());
            projectObjectFile.setFilePath(objectFileDTO.getFilePath());
            projectObjectFile.setVersion(objectFileDTO.getVersion());
            projectObjectFile.setStatusCd(objectFileDTO.getStatusCd());
            projectObjectFile.setExtContent(objectFileDTO.getExtContent());

            ProjectObjectFile exist = this.findExist(objectFileDTO);
            if (exist != null) {
                projectObjectFile.setId(exist.getId());
                projectObjectFile.setUpdateTime(new Date());
                projectObjectFileService.update(projectObjectFile);
            }
            else {
                projectObjectFileService.save(projectObjectFile);
            }

            resultList.add(projectObjectFile);
        }

        return resultList;
    }

    /**
     * 查询文件是否存在
     *
     * @param objectFileDTO 查询对象
     * @return ProjectObjectFile
     */
    private ProjectObjectFile findExist(ObjectFileDTO objectFileDTO) {

        // 如果有主键，先根据主键查询
        ProjectObjectFile projectObjectFile = projectObjectFileService.findById(objectFileDTO.getId());
        if (projectObjectFile != null) {
            return projectObjectFile;
        }

        // 如果没有根据名称查询
        return projectObjectFileService.findByBizKey(objectFileDTO.getSessionId(), objectFileDTO.getObjectCode(),
            objectFileDTO.getFileName());
    }

    /**
     * 按项目、会话查询业务对象关联文件，并按 objectCode、objectName 归类返回。
     *
     * @param listObjectFileDto 查询条件
     * @return 按业务对象归类后的文件组列表
     */
    public Collection<ObjectFileGroupDTO> listProjectObjectFiles(ListObjectFileDto listObjectFileDto) {

        List<ProjectObjectFile> projectObjectFiles = projectObjectFileService.listProjectObjectFiles(listObjectFileDto);
        if (projectObjectFiles == null || projectObjectFiles.isEmpty()) {
            return Collections.emptyList();
        }

        Map<String, ObjectFileGroupDTO> objectFileGroupMap = new LinkedHashMap<>();
        for (ProjectObjectFile projectObjectFile : projectObjectFiles) {
            String groupKey = projectObjectFile.getObjectCode();
            ObjectFileGroupDTO objectFileGroupDTO = objectFileGroupMap.get(groupKey);
            if (objectFileGroupDTO == null) {
                objectFileGroupDTO = new ObjectFileGroupDTO();
                objectFileGroupDTO.setObjectCode(projectObjectFile.getObjectCode());
                objectFileGroupDTO.setObjectName(projectObjectFile.getObjectName());
                objectFileGroupDTO.setProjectObjectFiles(new ArrayList<>());
                objectFileGroupMap.put(groupKey, objectFileGroupDTO);
            }
            objectFileGroupDTO.getProjectObjectFiles().add(projectObjectFile);
        }

        return objectFileGroupMap.values();
    }

    /**
     * 查询运营任务对象信息
     *
     * @param listObjectFilePkIdDto 查询入参
     * @return ResponseUtil
     */
    public List<Map<String, Object>> listObjectById(ListObjectFilePkIdDto listObjectFilePkIdDto) {
        Long sessionId = listObjectFilePkIdDto.getSessionId();
        List<ByaiSessionExt> byaiSessionExts = sessionExtService.selectBySessionId(sessionId);
        String oploopTaskConfig = this.getOploopTaskConfig(byaiSessionExts);
        if (StringUtil.isEmpty(oploopTaskConfig)) {
            return null;
        }

        Map<String, Object> oploopTaskConfigMap = JSON.parseObject(oploopTaskConfig, Map.class);

        List<Map<String, Object>> resultList = new ArrayList<>();
        // 来源
        List<Map<String, Object>> sourceList = (List<Map<String, Object>>) oploopTaskConfigMap.get("sourceOntology");
        for (int i = 0; sourceList != null && i < sourceList.size(); i++) {
            // 查询接口与执行接口使用同一套本体字段归一化，避免返回结构因入口不同而不一致。
            Map<String, Object> ontologyMap = enrichOperationTaskOntology(sourceList.get(i));
            ontologyMap.put("ontologyConfigType", "source");
            resultList.add(ontologyMap);
        }

        // 目标
        List<Map<String, Object>> targetList = (List<Map<String, Object>>) oploopTaskConfigMap.get("ontology");
        for (int i = 0; targetList != null && i < targetList.size(); i++) {
            Map<String, Object> ontologyMap = enrichOperationTaskOntology(targetList.get(i));
            ontologyMap.put("ontologyConfigType", "target");
            resultList.add(ontologyMap);
        }

        return resultList;
    }

    /**
     * 获取配置属性
     *
     * @param byaiSessionExts 扩展字段
     * @return String
     */
    private String getOploopTaskConfig(List<ByaiSessionExt> byaiSessionExts) {
        for (ByaiSessionExt byaiSessionExt : byaiSessionExts) {
            String extParamCode = byaiSessionExt.getExtParamCode();
            String extParamValue = byaiSessionExt.getExtParamValue();
            if ("oploop_task_config".equalsIgnoreCase(extParamCode)) {
                return extParamValue;
            }
        }
        return null;
    }

    /**
     * 更新任务的状态
     *
     * @param updateTaskStatusDto 更新入参
     */
    public void updateTaskStatus(UpdateTaskStatusDto updateTaskStatusDto) {
        Long sessionId = updateTaskStatusDto.getSessionId();
        ByaiSessionExt byaiSessionExt = sessionExtService.findOneByExtParamCode(sessionId, "oploop_task_status");
        if (byaiSessionExt == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "Task not exists");
        }

        byaiSessionExt.setExtParamValue(updateTaskStatusDto.getTaskStatus());
        sessionExtService.update(byaiSessionExt);
    }

    /** 手工需求 JSON 包裹中携带的已解析、语言无关的数据。 */
    private record ManualRequirementContent(String sourceType, String branch, Long repoId, String originalContent,
        String productContent) {
    }

    @Autowired
    private UserPrivateParamMapper userPrivateParamMapper;

    /** 保存GitHub PAT，SM4加密存储 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> saveGitHubPat(String pat) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        String paramKey = "GH_TOKEN";

        LambdaQueryWrapper<UserPrivateParam> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(UserPrivateParam::getUserId, userId).eq(UserPrivateParam::getParamKey, paramKey)
            .eq(UserPrivateParam::getDeleteFlag, "0");

        var existing = userPrivateParamMapper.selectOne(wrapper);
        String encrypted = Sm4Util.encrypt(pat);
        String last4 = pat.length() > 4 ? pat.substring(pat.length() - 4) : pat;

        if (existing != null) {
            existing.setParamValueCipher(encrypted);
            existing.setParamValueLast4(last4);
            existing.setUpdateTime(new Date());
            userPrivateParamMapper.updateById(existing);
        }
        else {
            var param = new UserPrivateParam();
            param.setParamId(sequenceService.nextVal());
            param.setUserId(userId);
            param.setParamKey(paramKey);
            param.setParamValueCipher(encrypted);
            param.setParamValueLast4(last4);
            param.setDescription("GitHub Personal Access Token");
            param.setStatus("1");
            param.setCreateTime(new Date());
            param.setDeleteFlag("0");
            userPrivateParamMapper.insert(param);
        }
        return ResponseUtil.successResponse(null);
    }

    /** 检查当前用户是否已配置GitHub PAT */
    public ResponseUtil<Map<String, Object>> checkGitHubPat() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        String paramKey = "GH_TOKEN";

        LambdaQueryWrapper<UserPrivateParam> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(UserPrivateParam::getUserId, userId).eq(UserPrivateParam::getParamKey, paramKey)
            .eq(UserPrivateParam::getDeleteFlag, "0");

        var existing = userPrivateParamMapper.selectOne(wrapper);
        Map<String, Object> result = new HashMap<>();
        result.put("hasPat", existing != null);
        if (existing != null) {
            result.put("last4", existing.getParamValueLast4());
        }
        return ResponseUtil.successResponse(result);
    }

    private static final String DWS_BIN = "dws";

    /** 通过DWS CLI搜索钉钉群 */
    public ResponseUtil<List<Map<String, Object>>> searchDingtalkGroups(String query) {
        List<Map<String, Object>> groups = new ArrayList<>();
        try {
            List<String> cmd = new ArrayList<>();
            cmd.add(DWS_BIN);
            cmd.add("chat");
            cmd.add("search");
            cmd.add("--query");
            cmd.add(query);
            cmd.add("--format");
            cmd.add("json");

            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            // 群搜索由当前登录用户发起:按其身份隔离 dws 环境(禁 keychain + DWS_CONFIG_DIR + XDG_DATA_HOME)。
            dwsAuthService.applyUserDwsEnv(pb.environment(), CurrentUserHolder.getCurrentUserId());
            Process process = pb.start();

            StringBuilder output = new StringBuilder();
            try (var reader = new java.io.BufferedReader(new java.io.InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line);
                }
            }

            boolean finished = process.waitFor(30, java.util.concurrent.TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                return ResponseUtil.failRes(I18nUtil.get("devloop.dingtalk.search.timeout"));
            }

            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            com.fasterxml.jackson.databind.JsonNode root = mapper.readTree(output.toString());
            com.fasterxml.jackson.databind.JsonNode groupsNode = root.path("result").path("groups");
            if (groupsNode.isArray()) {
                for (com.fasterxml.jackson.databind.JsonNode conv : groupsNode) {
                    Map<String, Object> g = new HashMap<>();
                    g.put("openConversationId", conv.path("openConversationId").asText(""));
                    g.put("name", conv.path("title").asText(""));
                    groups.add(g);
                }
            }
        }
        catch (Exception e) {
            log.error("DingTalk group search failed", e);
            return ResponseUtil.failRes(I18nUtil.get("devloop.dingtalk.search.failed", e.getMessage()));
        }
        return ResponseUtil.successResponse(groups);
    }

    // ========== 研发任务 ==========

    /**
     * 需求 AI 预拆:查需求正文与项目仓库清单,交给模型产出子任务草稿,只读不落库。 前端拿到草稿后允许编辑,点启动才调 {@link #splitTask} 一次性建会话,预拆与落库分离。
     */
    public ResponseUtil<RequirementPresplitResultDto> getRequirementPresplit(RequirementPresplitDTO dto) {
        if (dto == null || dto.getProjectId() == null || dto.getSourceItemId() == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.requirement.not.found"));
        }
        ScanRequireItem item = scanRequireItemMapper.selectById(dto.getSourceItemId());
        if (item == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.requirement.not.found"));
        }
        List<ProjectRepo> repos = projectRepoMapper
            .selectList(new LambdaQueryWrapper<ProjectRepo>().eq(ProjectRepo::getProjectId, dto.getProjectId()));
        return ResponseUtil.successResponse(requirementPresplitService.getPresplitDraft(item.getTitle(),
            item.getContent(), repos, getCurrentRequestLanguage()));
    }

    /** 从需求创建任务（前端手动启动入口，身份取当前登录用户） */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Map<String, Object>> createTask(Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        Long sourceItemId = params.containsKey("sourceItemId") ? Long.valueOf(params.get("sourceItemId").toString())
            : null;
        String title = params.containsKey("title") && params.get("title") != null ? params.get("title").toString()
            : null;
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        return deriveTask(currentUserId, loginInfo, projectId, sourceItemId, title);
    }

    /**
     * 需求拆分为多仓库子任务:一个需求拆成 N 个子任务,各自 repo/分支/承接员工,子任务间依赖(DAG)落库。 MVP:依赖只记录不控制顺序,全部子任务立即各起会话。防重与单任务启动共用需求 sessionId 闸门。
     * rowId 是前端临时ID,先给每个子任务预分配真实 taskId 建映射,再把 dependsOn 的 rowId 翻译成 taskId 存库。
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Map<String, Object>> splitTask(RequirementSplitDTO dto) {
        Long projectId = dto.getProjectId();
        Long sourceItemId = dto.getSourceItemId();
        List<RequirementSplitDTO.SplitTask> tasks = dto.getTasks();
        if (projectId == null || sourceItemId == null || tasks == null || tasks.isEmpty()) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.split.tasks.required"));
        }
        // 防重复启动:需求已关联会话则拒,与单任务启动同一闸门。
        ScanRequireItem sourceItem = scanRequireItemMapper.selectById(sourceItemId);
        if (sourceItem == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.repository.not.found"));
        }
        if (sourceItem.getSessionId() != null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.requirement.already.started"));
        }

        Long operatorId = CurrentUserHolder.getCurrentUserId();
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        String taskType = detectTaskType(sourceItem, sourceItem.getTitle());
        String projectDesc = StringUtils.isNotBlank(sourceItem.getContent()) ? getRequirementContent(sourceItem)
            : sourceItem.getTitle();

        // 先解析并校验全部子任务的 agent/repo,再动手建会话:失败(缺绑定/仓库不属项目)在无副作用时就返回,
        // 避免半拆状态。@Transactional 的 rollbackFor 只在抛异常时生效,return failRes 不回滚,所以必须先校验后落库。
        List<ResolvedSplitTask> resolved = new ArrayList<>();
        for (RequirementSplitDTO.SplitTask task : tasks) {
            Long agentId = resolveAgentIdForAssignee(task.getAssigneeId(), projectId);
            if (agentId == null) {
                return ResponseUtil.failRes(I18nUtil.get("devloop.task.agent.required"));
            }
            ProjectRepo repo = findProjectRepo(projectId, task.getRepoId());
            if (repo == null) {
                return ResponseUtil.failRes(I18nUtil.get("devloop.task.repository.not.found"));
            }
            String title = StringUtils.isNotBlank(task.getTitle()) ? task.getTitle() : sourceItem.getTitle();
            resolved.add(new ResolvedSplitTask(task, agentId, repo, title));
        }

        // 校验通过后再预分配 taskId,建 rowId→taskId 映射,供依赖翻译。
        Map<String, Long> taskIdByRow = new LinkedHashMap<>();
        for (RequirementSplitDTO.SplitTask task : tasks) {
            taskIdByRow.put(task.getRowId(), sequenceService.nextVal());
        }

        List<Map<String, Object>> created = new ArrayList<>();
        Long firstSessionId = null;
        for (ResolvedSplitTask item : resolved) {
            RequirementSplitDTO.SplitTask task = item.task();
            ProjectRepo repo = item.repo();
            SessionStart started = startOneSession(item.agentId(), projectId, item.title(), projectDesc, taskType, repo,
                task.getBranch(), loginInfo);
            if (firstSessionId == null) {
                firstSessionId = started.sessionId();
            }
            // 依赖 rowId → 真实 taskId 逗号串;引用不到的 rowId 跳过,避免存悬空ID。
            String dependsOn = translateDeps(task.getDependsOn(), taskIdByRow);
            scanItemTaskService.insertSubtaskWithDeps(taskIdByRow.get(task.getRowId()), sourceItemId, projectId,
                repo.getRepoId(), started.sessionId(), dependsOn, operatorId);

            Map<String, Object> vo = new HashMap<>();
            vo.put("taskId", taskIdByRow.get(task.getRowId()));
            vo.put("repoId", repo.getRepoId());
            vo.put("sessionId", started.sessionId());
            vo.put("branch", started.branchName());
            vo.put("dependsOn", dependsOn);
            created.add(vo);
        }

        // 需求回写入度0(第一个)子任务的会话,满足"已启动"判定/防重/跳转;拆分多会话由子任务表承载。
        ScanRequireItem update = new ScanRequireItem();
        update.setItemId(sourceItemId);
        update.setSessionId(firstSessionId);
        scanRequireItemMapper.updateById(update);

        Map<String, Object> result = new HashMap<>();
        result.put("sessionId", firstSessionId);
        result.put("tasks", created);
        return ResponseUtil.successResponse(result);
    }

    /** 依赖 rowId 列表翻译成真实 taskId 逗号串;映射不到的 rowId(用户误引用/已删)跳过,不存悬空ID。 */
    private String translateDeps(List<String> depRowIds, Map<String, Long> taskIdByRow) {
        if (depRowIds == null || depRowIds.isEmpty()) {
            return null;
        }
        List<String> resolved = new ArrayList<>();
        for (String rowId : depRowIds) {
            Long depTaskId = taskIdByRow.get(rowId);
            if (depTaskId != null) {
                resolved.add(String.valueOf(depTaskId));
            }
        }
        return resolved.isEmpty() ? null : String.join(",", resolved);
    }

    /**
     * 从需求派生任务（会话）核心逻辑，不依赖登录 ThreadLocal 取当前用户，供手动启动与定时自动派生复用。 userId 用于成员/agent 校验，loginInfo 透传给异步 chat（自动派生时由源创建者的
     * LoginInfo 构造）。
     */
    private ResponseUtil<Map<String, Object>> deriveTask(Long userId, LoginInfo loginInfo, Long projectId,
        Long sourceItemId, String title) {
        // 防止重复启动：该需求已关联会话则拒绝重复启动
        if (sourceItemId != null) {
            ScanRequireItem existing = scanRequireItemMapper.selectById(sourceItemId);
            if (existing != null && existing.getSessionId() != null) {
                return ResponseUtil.failRes(I18nUtil.get("devloop.task.requirement.already.started"));
            }
        }

        // 校验用户是否绑定了数字员工
        ProjectMember member = projectMemberService.findByProjectAndUser(projectId, userId);
        if (member == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.project.member.required"));
        }
        if (member.getAgentId() == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.agent.required"));
        }
        Long agentId = member.getAgentId();

        if (sourceItemId != null && (title == null || title.isEmpty())) {
            ScanRequireItem item = scanRequireItemMapper.selectById(sourceItemId);
            if (item != null)
                title = item.getTitle();
        }
        if (title == null || title.isEmpty()) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.title.required"));
        }

        // 将手工需求 JSON 按当前执行上下文的语言渲染后，再写入异步 LLM 提示词。
        // 普通扫描内容经 getRequirementContent 处理时保持原样。
        ScanRequireItem sourceItem = sourceItemId != null ? scanRequireItemMapper.selectById(sourceItemId) : null;
        String description = sourceItem != null && StringUtils.isNotBlank(sourceItem.getContent())
            ? getRequirementContent(sourceItem)
            : title;
        String taskType = detectTaskType(sourceItem, title);

        // 手工需求优先使用其 JSON 内的 repoId，不修改项目共用 manual 来源，避免影响其他手工需求。
        ProjectRepo repo = resolveTaskRepo(projectId, sourceItem);
        if (repo == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.repository.not.found"));
        }

        // 会话即任务:建会话+算分支+写提示词+登记事务后异步 chat,单任务与拆分共用 startOneSession。
        // 分支名由后端按会话ID生成(单任务无用户自定义分支入口),故 explicitBranch 传 null。
        SessionStart started = startOneSession(agentId, projectId, title, description, taskType, repo, null, loginInfo);
        Long sessionId = started.sessionId();

        // 需求项回写 sessionId，标记“已启动”并支持跳转会话
        if (sourceItemId != null) {
            ScanRequireItem item = new ScanRequireItem();
            item.setItemId(sourceItemId);
            item.setSessionId(sessionId);
            scanRequireItemMapper.updateById(item);
            // 登记需求→仓库子任务，让需求级就绪聚合与批量集成按 (需求,仓库) 维度可查，不再仅靠 1:1 的 sessionId 绑定。
            scanItemTaskService.upsertOnStart(sourceItemId, projectId, repo.getRepoId(), sessionId, userId);
        }

        Map<String, Object> result = new HashMap<>();
        result.put("agentId", agentId);
        result.put("sessionId", sessionId);
        result.put("branchName", started.branchName());
        result.put("title", title);
        return ResponseUtil.successResponse(result);
    }

    /** 一次会话启动的产物:会话ID + 最终分支名(前端自定义优先,否则后端按会话生成)。 */
    private record SessionStart(Long sessionId, String branchName) {
    }

    /** 拆单子任务校验通过后的解析结果:agent/repo/标题已确定,供后续建会话前先整批校验、无副作用地失败返回。 */
    private record ResolvedSplitTask(RequirementSplitDTO.SplitTask task, Long agentId, ProjectRepo repo, String title) {
    }

    /**
     * 建一个开发会话并挂上完整任务提示词,事务提交后异步触发 LLM 对话。 分支名依赖 sessionId,故先建会话拿 id 再算分支;explicitBranch 非空时(拆分场景用户填写)优先采用。
     * 不落库需求/子任务,由调用方按单任务或拆分各自登记,保持本方法只管"起一个会话"。
     */
    private SessionStart startOneSession(Long agentId, Long projectId, String title, String description,
        String taskType, ProjectRepo repo, String explicitBranch, LoginInfo loginInfo) {
        // 先用 title 作会话内容让会话名可读,建成后再覆盖为完整提示词供异步 chat 使用。
        AssistantChatDto chatDto = new AssistantChatDto();
        chatDto.setSessionId(null);
        chatDto.setAgentId(agentId);
        chatDto.setProjectId(projectId);
        chatDto.setChatContent(title);
        chatDto.setAccessTerminal("DevLoop");
        chatDto.setClientRequestId(AssistantChatService.getClientRequestId());
        assistantChatService.createGroupChatSession(chatDto);
        Long sessionId = chatDto.getSessionId();

        String branchName = StringUtils.isNotBlank(explicitBranch) ? explicitBranch.trim()
            : buildBranchName(taskType, sessionId);
        Project project = projectMapper.selectById(projectId);
        String projectName = project != null ? project.getProjectName() : "";
        chatDto.setChatContent(buildTaskPrompt(projectName, repo, branchName, taskType, title, description));

        // 事务提交后再异步触发 chat：确保异步线程能读到本事务已建的 session。
        submitTaskChatAfterCommit(chatDto, loginInfo, sessionId);
        return new SessionStart(sessionId, branchName);
    }

    /**
     * 定时扫描完成后按确认规则自动派生任务，并在项目内做负载均衡： auto=全部待派；score=综合分达阈值(默认70)才待派；manual=不派。 候选执行人=项目内绑定了数字员工的成员；按各自当前「进行中」任务数从低到高选，
     * 单 agent 并发达上限(全局 cap，默认1)则跳过，避免一股脑丢给 codeagent 导致 OOM。 全员已满则本轮不派，留待下轮重新捞取未启动需求（轻量排队）。
     * 每条任务以「被选中成员本人」身份创建（负责人=该成员，用其绑定 agent 执行）。
     */
    public void autoDeriveForSource(ScanSource source, List<ScanRequireItem> newItems) {
        if (source == null) {
            return;
        }
        String mode = source.getConfirmMode();
        boolean autoAll = "auto".equalsIgnoreCase(mode);
        boolean byScore = "score".equalsIgnoreCase(mode);
        if (!autoAll && !byScore) {
            return;
        }
        Long projectId = source.getProjectId();
        int threshold = source.getScoreThreshold() != null ? source.getScoreThreshold() : 70;

        // 待派需求 = 本轮新增 + 本源历史未启动(sessionId=null)，合并去重；后者实现“上轮全忙、本轮补派”的轻量排队
        List<ScanRequireItem> pending = collectPendingItems(source, newItems, byScore, threshold);
        // 新增 vs 重捞拆分统计：新增=本轮扫到的未启动条数，重捞=历史未启动补进来的条数
        int newCount = 0;
        if (newItems != null) {
            for (ScanRequireItem it : newItems) {
                if (it.getItemId() != null && it.getSessionId() == null) {
                    newCount++;
                }
            }
        }
        int requeueCount = Math.max(0, pending.size() - newCount);
        if (pending.isEmpty()) {
            log.info("[DevloopAuto] 源 {} 无待派需求(新增0/重捞0)，跳过", source.getSourceId());
            return;
        }

        // 候选执行人：项目内绑定了数字员工的成员；无候选直接跳过
        List<ProjectMember> candidates = new ArrayList<>();
        for (ProjectMember m : projectMemberService.listByProjectId(projectId)) {
            if (m.getAgentId() != null && m.getUserId() != null) {
                candidates.add(m);
            }
        }
        if (candidates.isEmpty()) {
            log.warn("[DevloopAuto] 项目 {} 无绑定数字员工的成员，跳过自动派生", projectId);
            return;
        }

        int cap = agentMaxConcurrent();
        // 各 agent 当前在跑任务数（内存累加，避免一轮把需求全砸给同一空闲 agent）
        Map<Long, Integer> loadByAgent = new HashMap<>();
        for (ProjectMember m : candidates) {
            loadByAgent.put(m.getAgentId(), countRunningTasksByAgent(projectId, m.getAgentId()));
        }

        int dispatched = 0;
        int failed = 0;
        int skippedByCap = 0;
        LoginInfo previous = CurrentUserHolder.getLoginInfo();
        try {
            for (ScanRequireItem item : pending) {
                ProjectMember chosen = pickLeastLoadedMember(candidates, loadByAgent, cap);
                if (chosen == null) {
                    // 全员满 cap：本轮不再派，剩余需求下轮重新捞取
                    skippedByCap = pending.size() - dispatched - failed;
                    break;
                }
                LoginInfo memberLogin = loginApplicationService.getLoginInfo(chosen.getUserId());
                if (memberLogin == null) {
                    log.warn("[DevloopAuto] 无法加载成员 {} 登录信息，跳过其本次派发", chosen.getUserId());
                    failed++;
                    // 该成员本轮不可用：临时置满，避免死循环反复选中
                    loadByAgent.put(chosen.getAgentId(), cap);
                    continue;
                }
                try {
                    CurrentUserHolder.setLoginInfo(memberLogin);
                    ResponseUtil<Map<String, Object>> res = deriveTask(chosen.getUserId(), memberLogin, projectId,
                        item.getItemId(), item.getTitle());
                    if (res != null && res.getCode() == ResponseUtil.SUCCESS) {
                        // 派发成功才计入负载，供后续需求继续均衡
                        loadByAgent.merge(chosen.getAgentId(), 1, Integer::sum);
                        dispatched++;
                    }
                    else {
                        failed++;
                        log.warn("[DevloopAuto] 自动派生失败, item={}, member={}, msg={}", item.getItemId(),
                            chosen.getUserId(), res != null ? res.getMsg() : "null");
                    }
                }
                catch (Exception e) {
                    failed++;
                    log.error("[DevloopAuto] 自动派生异常, item={}, member={}", item.getItemId(), chosen.getUserId(), e);
                }
                finally {
                    CurrentUserHolder.clearLoginInfo();
                }
            }
            // 每轮派发结果汇总：观察补派是否正常工作(新增/重捞/实际派/满cap跳过/失败)
            log.info("[DevloopAuto] 源 {} 派发汇总: 新增{} 重捞{} 候选员工{} cap{} -> 实际派{} 满cap跳过{} 失败{}", source.getSourceId(),
                newCount, requeueCount, candidates.size(), cap, dispatched, skippedByCap, failed);
        }
        finally {
            // 还原上下文：线程池复用，避免把身份泄漏给后续任务
            if (previous != null) {
                CurrentUserHolder.setLoginInfo(previous);
            }
            else {
                CurrentUserHolder.clearLoginInfo();
            }
        }
    }

    /**
     * 收集本源待派需求：本轮新增 + 历史未启动(sessionId=null)，按 itemId 去重。 score 模式仅保留综合分达阈值者。历史未启动的参与，实现全忙跳过后下轮自动补派。
     */
    private List<ScanRequireItem> collectPendingItems(ScanSource source, List<ScanRequireItem> newItems,
        boolean byScore, int threshold) {
        Map<Long, ScanRequireItem> byId = new LinkedHashMap<>();
        if (newItems != null) {
            for (ScanRequireItem it : newItems) {
                if (it.getItemId() != null && it.getSessionId() == null) {
                    byId.put(it.getItemId(), it);
                }
            }
        }
        for (ScanRequireItem it : scanLogService.listCreatedItemsBySource(source.getSourceId())) {
            if (it.getItemId() != null && it.getSessionId() == null) {
                byId.putIfAbsent(it.getItemId(), it);
            }
        }
        List<ScanRequireItem> result = new ArrayList<>();
        for (ScanRequireItem it : byId.values()) {
            // 疑似/确认重复的不派发，只放行 normal 与人工判过“其实不同”(not_dup)；空值兼容历史数据视为 normal
            String dedup = it.getDedupStatus();
            if (dedup != null && !"normal".equals(dedup) && !"not_dup".equals(dedup)) {
                continue;
            }
            if (byScore) {
                Integer s = it.getScore();
                if (s == null || s < threshold) {
                    continue;
                }
            }
            result.add(it);
        }
        return result;
    }

    /** 选负载最低且未达 cap 的成员；全员已满返回 null。候选已按 createTime 升序，天然稳定轮转。 */
    private ProjectMember pickLeastLoadedMember(List<ProjectMember> candidates, Map<Long, Integer> loadByAgent,
        int cap) {
        ProjectMember best = null;
        int bestLoad = Integer.MAX_VALUE;
        for (ProjectMember m : candidates) {
            int load = loadByAgent.getOrDefault(m.getAgentId(), 0);
            if (load < cap && load < bestLoad) {
                best = m;
                bestLoad = load;
            }
        }
        return best;
    }

    /** 某 agent 在指定项目下未完成任务数：状态来自 v2 会话投影，状态不可用时按占用额度处理。 */
    private int countRunningTasksByAgent(Long projectId, Long agentId) {
        List<ByaiSession> sessions = byaiSessionMapper.selectList(new LambdaQueryWrapper<ByaiSession>()
            .eq(ByaiSession::getProjectId, projectId).eq(ByaiSession::getObjectId, agentId));
        if (sessions.isEmpty()) {
            return 0;
        }
        int running = 0;
        for (ByaiSession session : sessions) {
            DevloopTaskStateDto state = tryReadTaskState(session);
            if (state == null || !TASK_STATUS_COMPLETED.equals(state.getStatus())) {
                running++;
            }
        }
        return running;
    }

    /** 读全局单 agent 并发上限；未配置或非法用默认值，最小为 1。 */
    private int agentMaxConcurrent() {
        String raw = byaiSystemConfigService.findByParamCode(AGENT_MAX_CONCURRENT_CODE);
        if (raw == null || raw.trim().isEmpty()) {
            return AGENT_MAX_CONCURRENT_DEFAULT;
        }
        try {
            return Math.max(1, Integer.parseInt(raw.trim()));
        }
        catch (NumberFormatException e) {
            log.warn("[DevloopAuto] 并发上限配置非法 {}，用默认 {}", raw, AGENT_MAX_CONCURRENT_DEFAULT);
            return AGENT_MAX_CONCURRENT_DEFAULT;
        }
    }

    /**
     * 在当前事务提交后，用 TTL 线程池异步执行 LLM 对话。 sessionId 已在事务内建好并写入 chatDto，chat 走“已有会话”分支，不会重复建会话。 无事务时（理论上不会发生）直接提交，保证仍能执行。
     */
    private void submitTaskChatAfterCommit(AssistantChatDto chatDto, LoginInfo loginInfo, Long taskId) {
        Runnable chatTask = () -> {
            try {
                assistantChatService.chat(chatDto, new ByteArrayOutputStream(), loginInfo);
            }
            catch (Exception e) {
                log.error("[DevloopTask] 异步 LLM chat 执行失败, taskId={}, sessionId={}", taskId, chatDto.getSessionId(), e);
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    TASK_CHAT_EXECUTOR.execute(chatTask);
                }
            });
        }
        else {
            TASK_CHAT_EXECUTOR.execute(chatTask);
        }
    }

    /** 判定任务类型：需求项含 bug/缺陷 标记归为 bug，否则为需求 */
    private String detectTaskType(ScanRequireItem item, String title) {
        String haystack = ((item != null && item.getTitle() != null ? item.getTitle() : "") + " "
            + getRequirementContent(item) + " " + (item != null && item.getAction() != null ? item.getAction() : "")
            + " " + (title != null ? title : "")).toLowerCase();
        if (haystack.contains("bug") || haystack.contains("缺陷") || haystack.contains("修复")) {
            return "bug";
        }
        return "需求";
    }

    /** 分支名策略：bug -> fix/task-{id}，其余 -> feat/task-{id} */
    private String buildBranchName(String taskType, Long taskId) {
        String prefix = "bug".equals(taskType) ? "fix" : "feat";
        return prefix + "/task-" + taskId;
    }

    /**
     * 解析任务目标仓库：手工需求先取自身 JSON 的 repoId，再取扫描源 repoId；均缺失时取项目首个仓库兜底。
     */
    private ProjectRepo resolveTaskRepo(Long projectId, ScanRequireItem item) {
        if (item != null) {
            ScanSource source = item.getSourceId() != null ? scanSourceService.findById(item.getSourceId()) : null;
            if (source != null && MANUAL_SOURCE_TYPE.equals(source.getSourceType())) {
                // 单条手工需求的仓库优先级最高，历史 JSON 缺少该字段时自然继续走后续兜底。
                ManualRequirementContent manualContent = parseManualRequirementContent(item.getContent());
                ProjectRepo manualRepo = manualContent != null ? findProjectRepo(projectId, manualContent.repoId())
                    : null;
                if (manualRepo != null) {
                    return manualRepo;
                }
            }
            ProjectRepo sourceRepo = source != null ? findProjectRepo(projectId, source.getRepoId()) : null;
            if (sourceRepo != null) {
                return sourceRepo;
            }
        }
        List<ProjectRepo> repos = projectRepoMapper
            .selectList(new LambdaQueryWrapper<ProjectRepo>().eq(ProjectRepo::getProjectId, projectId));
        return repos.isEmpty() ? null : repos.get(0);
    }

    /**
     * 获取当前请求语言；不依赖聊天基础设施工具类，避免运营任务接口在精简运行包中触发类加载失败。 异步任务没有请求上下文时统一回退中文，与原有 ChatUtils 行为保持一致。
     */
    private String getCurrentRequestLanguage() {
        try {
            if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
                Object language = attributes.getRequest().getAttribute(I18nUtil.LANGUAGE);
                if (language != null && StringUtils.isNotBlank(String.valueOf(language))) {
                    return String.valueOf(language);
                }
            }
        }
        catch (Exception ignored) {
            // 请求上下文可能在异步线程中不存在，按默认中文处理。
        }
        return I18nUtil.CHINSES;
    }

    /**
     * 构造任务启动提示词：从 byai_ai_prompt 取模板并填充占位符； 模板缺失时用内置兜底模板，保证任务始终可创建。
     */
    private String buildTaskPrompt(String projectName, ProjectRepo repo, String branchName, String taskType,
        String title, String description) {
        // language 从请求上下文取(前端经 header 传入，GlobalI18nFilter 已解析进 attribute)；
        // 异步/定时任务无请求上下文时由 getCurrentRequestLanguage 回退中文。
        String template = aiPromptService.findTemplateByCode("DEVLOOP_TASK_START_PROMPT", getCurrentRequestLanguage());
        if (template == null || template.isEmpty()) {
            template = DEFAULT_TASK_PROMPT_TEMPLATE;
        }
        String repoFullName = repo != null && repo.getRepoFullName() != null ? repo.getRepoFullName() : "";
        String repoUrl = repo != null && repo.getRepoUrl() != null ? repo.getRepoUrl() : repoFullName;
        String provider = repo != null ? repo.getProvider() : null;
        String repoCloneHint = buildRepoCloneHint(provider, repoUrl, repoFullName);
        return template.replace("${projectName}", projectName != null ? projectName : "").replace("${repoUrl}", repoUrl)
            .replace("${repoFullName}", repoFullName).replace("${branchName}", branchName != null ? branchName : "")
            .replace("${taskType}", taskType != null ? taskType : "").replace("${title}", title != null ? title : "")
            .replace("${repoCloneHint}", repoCloneHint)
            .replace("${description}", description != null ? description : "");
    }

    /** 各代码平台的公共域名与令牌注入约定;自建/私有实例靠显式 repoUrl 兜底,不在此拼接。 */
    private record RepoProviderSpec(String label, String host, String tokenEnv, String cloneUrlPrefix) {
    }

    private static final Map<String, RepoProviderSpec> REPO_PROVIDER_SPECS = Map.of(
        // GitLab 带令牌 clone 必须用 oauth2:token@ 前缀,与 github/gitea 的 $TOKEN@ 不同。
        "github", new RepoProviderSpec("GitHub", "github.com", "GH_TOKEN", "$GH_TOKEN@"), "gitlab",
        new RepoProviderSpec("GitLab", "gitlab.com", "GL_TOKEN", "oauth2:$GL_TOKEN@"), "gitea",
        new RepoProviderSpec("Gitea", "gitea.com", "GITEA_TOKEN", "$GITEA_TOKEN@"));

    /**
     * 按代码平台生成「仓库访问说明」段,填入模板 ${repoCloneHint} 占位符。 显式 repoUrl(自建/私有实例)优先直用;否则按平台公共域名 + 令牌变量拼带令牌的 clone 地址。
     */
    public static String buildRepoCloneHint(String provider, String repoUrl, String repoFullName) {
        RepoProviderSpec spec = repoProviderSpec(provider);
        // repoFullName 形如 owner/repo 才按公共域名拼接;显式 repoUrl 一律直用,兼容自建实例。
        boolean hasFullName = repoFullName != null && !repoFullName.trim().isEmpty();
        String cloneUrl;
        if (repoUrl != null && repoUrl.startsWith("http") && !repoUrl.equals(repoFullName)) {
            // 显式完整地址:在 https:// 后插入令牌前缀,让带令牌 clone 对自建实例同样生效。
            cloneUrl = tokenizedRepoCloneUrl(provider, repoUrl);
        }
        else if (hasFullName) {
            cloneUrl = "https://" + spec.cloneUrlPrefix() + spec.host() + "/" + repoFullName + ".git";
        }
        else {
            cloneUrl = "";
        }
        return "- 目标仓库全路径为 " + repoFullName + "，它可能是私有仓库；" + spec.label() + " 访问令牌(PAT)已配置在环境变量 " + spec.tokenEnv()
            + " 中，请直接使用它克隆和推送。\n" + "- 用带令牌的完整地址克隆：git clone " + cloneUrl + "\n"
            + "- 若提示仓库或分支不存在，通常是私有仓库权限问题，请确认已使用环境变量 " + spec.tokenEnv() + " 中的令牌，不要据此判定仓库不存在、也不要改为在本地新建独立项目。";
    }

    /**
     * 在 http(s):// 之后插入令牌前缀,得到带令牌的 clone 地址(令牌以 $VAR 形式留给 shell 展开,不含明文)。 必须手工拼接:前缀含 $GH_TOKEN 之类的 $,走 replaceFirst
     * 会被当成分组引用直接抛 IllegalArgumentException。 非 http(s) 地址(如 git@ SSH)原样返回,令牌注入对它无意义。
     */
    public static String tokenizedRepoCloneUrl(String provider, String repoUrl) {
        String prefix = repoProviderSpec(provider).cloneUrlPrefix();
        for (String scheme : new String[] {
            "https://", "http://"
        }) {
            if (StringUtils.startsWithIgnoreCase(repoUrl, scheme)) {
                return "https://" + prefix + repoUrl.substring(scheme.length());
            }
        }
        return repoUrl;
    }

    /** 平台令牌环境变量名,供集成测试等其它执行路径复用同一份平台约定。 */
    public static String repoProviderTokenEnv(String provider) {
        return repoProviderSpec(provider).tokenEnv();
    }

    /** 平台公共域名,仅在只有 owner/repo 时用于拼完整地址;自建实例应带显式 repoUrl。 */
    public static String repoProviderHost(String provider) {
        return repoProviderSpec(provider).host();
    }

    private static RepoProviderSpec repoProviderSpec(String provider) {
        return REPO_PROVIDER_SPECS.getOrDefault(StringUtils.lowerCase(StringUtils.defaultIfBlank(provider, "github")),
            REPO_PROVIDER_SPECS.get("github"));
    }

    /** 提示词模板兜底：DB 未配置 DEVLOOP_TASK_START_PROMPT 时使用，与 byai_ai_prompt 中的当前模板保持一致 */
    private static final String DEFAULT_TASK_PROMPT_TEMPLATE = "请处理以下任务：\n" + "## 任务信息\n" + "- 项目：${projectName}\n"
        + "- 代码仓库：${repoFullName}\n" + "- 目标分支：${branchName}（尚未创建，需你新建）\n" + "- 任务类型：${taskType}\n"
        + "- 任务标题：${title}\n\n" + "## 需求详情\n${description}\n\n" + "## 仓库访问说明\n" + "${repoCloneHint}\n\n" + "## 代码仓库\n"
        + "任务的代码克隆仓库路径需要遵循/by/.sessions/{sessionId}/{repoName}/\n\n" + "## 强制要求\n"
        + "acp下发任务告诉对方启动的时候必须要调用skill：self-developed-rules;\n"
        + "研发流程的输出文档如：需求文档、设计文档、测试文档保存在/by/.sessions/{sessionId}/下面";

    /** 数据库先分页，再读取当前页会话状态投影；单页最多触发 100 次 UserFS 定点读取。 */
    public ResponseUtil<PageInfo<DevloopTaskViewDto>> listTasks(DevloopTaskListQueryDto query) {
        if (query == null || query.getProjectId() == null) {
            return ResponseUtil.failRes(I18nUtil.get("project.id.required"));
        }
        final String taskStatus;
        try {
            query.normalizeAndValidate();
            taskStatus = normalizeTaskStatusFilter(query.getStatus());
        }
        catch (IllegalArgumentException e) {
            // DTO 可能在无 Spring 上下文的场景执行，接口返回前统一把校验文案转换为当前语言。
            String message = "创建时间开始值不能晚于结束值".equals(e.getMessage()) ? I18nUtil.get("devloop.task.date.range.invalid")
                : e.getMessage();
            return ResponseUtil.failRes(message);
        }

        LambdaQueryWrapper<ByaiSession> wrapper = new LambdaQueryWrapper<ByaiSession>()
            .eq(ByaiSession::getProjectId, query.getProjectId())
            .ge(query.getCreateTimeStart() != null, ByaiSession::getCreateTime, query.getCreateTimeStart())
            .le(query.getCreateTimeEnd() != null, ByaiSession::getCreateTime, query.getCreateTimeEnd());
        // 任务名称与会话标题一一对应，搜索仅匹配名称，分页总数与前端搜索结果一致。
        if (StringUtils.isNotBlank(query.getTaskName())) {
            // PostgreSQL 的 LIKE 区分大小写，任务名称统一小写后支持大小写混输搜索。
            wrapper.apply("LOWER(session_name) LIKE {0}",
                "%" + query.getTaskName().trim().toLowerCase(Locale.ROOT) + "%");
        }
        if (DEFAULT_PROJECT_ID.equals(query.getProjectId()) || Boolean.TRUE.equals(query.getOnlyMine())) {
            // 默认项目共用 -1 分组必须按创建人隔离；onlyMine 过滤同样只看当前登录用户的会话，两者叠加无害。
            wrapper.eq(ByaiSession::getCreatorId, CurrentUserHolder.getCurrentUserId());
        }
        wrapper.orderByDesc(ByaiSession::getCreateTime).orderByDesc(ByaiSession::getSessionId);

        if (taskStatus != null) {
            return listTasksByStatus(query, wrapper, taskStatus);
        }
        Page<ByaiSession> sessionPage = byaiSessionMapper
            .selectPage(new Page<>(query.getPageNum(), query.getPageSize()), wrapper);

        List<DevloopTaskViewDto> tasks = new ArrayList<>();
        for (ByaiSession session : sessionPage.getRecords()) {
            DevloopTaskStateDto state = tryReadTaskState(session);
            tasks.add(sessionAsTask(session, state, resolveTaskContext(session)));
        }

        PageInfo<DevloopTaskViewDto> result = new PageInfo<>();
        result.setPageNum((int) sessionPage.getCurrent());
        result.setPageSize((int) sessionPage.getSize());
        result.setTotal(sessionPage.getTotal());
        result.setTotalPages((int) sessionPage.getPages());
        result.setList(tasks);
        return ResponseUtil.successResponse(result);
    }

    /**
     * 任务状态保存在会话状态投影中，数据库没有可直接过滤的状态列。 因此状态看板查询需先读取状态投影，再对每个状态列独立分页，保证四列总数和加载更多结果准确。
     */
    private ResponseUtil<PageInfo<DevloopTaskViewDto>> listTasksByStatus(DevloopTaskListQueryDto query,
        LambdaQueryWrapper<ByaiSession> wrapper, String taskStatus) {
        List<ByaiSession> sessions = byaiSessionMapper.selectList(wrapper);
        List<DevloopTaskViewDto> tasks = new ArrayList<>();
        int matchedCount = 0;
        int offset = (query.getPageNum() - 1) * query.getPageSize();

        for (ByaiSession session : sessions) {
            DevloopTaskStateDto state = tryReadTaskState(session);
            if (!taskStatus.equals(resolveTaskStatusForFilter(state))) {
                continue;
            }
            if (matchedCount >= offset && tasks.size() < query.getPageSize()) {
                tasks.add(sessionAsTask(session, state, resolveTaskContext(session)));
            }
            matchedCount++;
        }

        PageInfo<DevloopTaskViewDto> result = new PageInfo<>();
        result.setPageNum(query.getPageNum());
        result.setPageSize(query.getPageSize());
        result.setTotal((long) matchedCount);
        result.setTotalPages((int) Math.ceil((double) matchedCount / query.getPageSize()));
        result.setList(tasks);
        return ResponseUtil.successResponse(result);
    }

    /** 将前端看板状态和会话状态投影的状态统一为内部筛选值。 */
    private String normalizeTaskStatusFilter(String status) {
        if (StringUtils.isBlank(status)) {
            return null;
        }
        switch (status.trim().toLowerCase(Locale.ROOT)) {
            case "pending":
            case "not_started":
                return "pending";
            case "running":
            case "in_progress":
                return "in_progress";
            case "paused":
                return "paused";
            case "done":
            case "completed":
                return "completed";
            default:
                throw new IllegalArgumentException(I18nUtil.get("devloop.task.status.invalid"));
        }
    }

    /** 状态投影缺失时沿用前端展示口径，归类到待开始列。 */
    private String resolveTaskStatusForFilter(DevloopTaskStateDto state) {
        String status = state == null ? null : normalizeTaskStatusFilter(state.getStatus());
        return status == null ? "pending" : status;
    }

    /** 查询单个任务详情：会话元数据来自数据库，状态来自 v2 会话投影。 */
    public ResponseUtil<DevloopTaskViewDto> getTaskDetail(Long sessionId) {
        ByaiSession session = byaiSessionMapper.selectById(sessionId);
        if (session == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.session.not.found"));
        }
        return ResponseUtil
            .successResponse(sessionAsTask(session, tryReadTaskState(session), resolveTaskContext(session)));
    }

    /** 直接按 sessionId 读取 v2 会话状态投影，不再解析消息或访问 session_ext。 */
    public ResponseUtil<DevloopTaskStateDto> getTaskPhases(Long sessionId) {
        if (sessionId == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.session.id.required"));
        }
        ByaiSession session = byaiSessionMapper.selectById(sessionId);
        if (session == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.session.not.found"));
        }
        try {
            return ResponseUtil.successResponse(readTaskState(session));
        }
        catch (Exception e) {
            log.warn("[Devloop] 读取任务状态失败, sessionId={}", sessionId, e);
            return ResponseUtil.successResponse(null);
        }
    }

    /**
     * 查询任务代码变更:workspace 架构采集 workspace 自身及 .gitmodules 中的实际子模块；无 workspace 时采集项目全部仓库。
     * 每个仓库均本地优先、远程兜底，最终扁平合并文件列表，并在文件项上标记所属 repoId。
     */
    public ResponseUtil<Map<String, Object>> getTaskChanges(Long sessionId) {
        if (sessionId == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.session.id.required"));
        }
        ByaiSession s = byaiSessionMapper.selectById(sessionId);
        if (s == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.session.not.found"));
        }
        // 代码变更是只读展示,任何本地/远程异常都不抛前端:顶层兜底,失败返回 http_error 空态并记日志。
        try {
            ScanRequireItem item = scanRequireItemMapper.selectOne(
                new LambdaQueryWrapper<ScanRequireItem>().eq(ScanRequireItem::getSessionId, sessionId).last("limit 1"));
            List<ProjectRepo> projectRepos = projectRepoMapper.selectList(new LambdaQueryWrapper<ProjectRepo>()
                .eq(ProjectRepo::getProjectId, s.getProjectId()).orderByAsc(ProjectRepo::getRepoId));
            ProjectRepo workspaceRepo = projectRepos.stream()
                .filter(candidate -> "workspace".equalsIgnoreCase(candidate.getRepoType())).findFirst().orElse(null);
            String headBranch = buildBranchName(detectTaskType(item, s.getSessionName()), sessionId);
            List<RepoWorkspace> repoWorkspaces = resolveTaskRepoWorkspaces(s, workspaceRepo, projectRepos);
            return ResponseUtil.successResponse(collectTaskChanges(s, repoWorkspaces, headBranch));
        }
        catch (Exception e) {
            // 兜底:任何未预期异常都吞掉,返回 http_error 空态,前端照常渲染"暂时无法获取代码变更"。
            log.error("[Devloop] 查询任务代码变更失败, sessionId={}", sessionId, e);
            return ResponseUtil.successResponse(errorChangesMap());
        }
    }

    /** 代码变更查询失败时的兜底空态:status=http_error,前端据此展示"暂时无法获取代码变更",不报错。 */
    private Map<String, Object> errorChangesMap() {
        Map<String, Object> map = new HashMap<>();
        map.put("status", "http_error");
        map.put("files", new ArrayList<>());
        map.put("fileCount", 0);
        return map;
    }

    /**
     * 查询任务单个文件的本地 diff(unified 文本)，供前端右侧预览抽屉逐行渲染。仅本地工作区口径；工作区不可用或出错时返回 status 非 ok，前端提示，不抛异常。
     */
    public ResponseUtil<Map<String, Object>> getTaskFileDiff(Long sessionId, Long repoId, String filePath) {
        if (sessionId == null || filePath == null || filePath.trim().isEmpty()) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.file.diff.parameters.required"));
        }
        try {
            ByaiSession s = byaiSessionMapper.selectById(sessionId);
            if (s == null) {
                return ResponseUtil.failRes(I18nUtil.get("devloop.task.session.not.found"));
            }
            ProjectRepo repo;
            if (repoId != null) {
                repo = projectRepoMapper.selectById(repoId);
            }
            else {
                // 兼容旧调用方：未指定仓库时，沿用任务关联需求、扫描源和项目首仓库的既有解析顺序。
                ScanRequireItem item = scanRequireItemMapper.selectOne(new LambdaQueryWrapper<ScanRequireItem>()
                    .eq(ScanRequireItem::getSessionId, sessionId).last("limit 1"));
                repo = resolveTaskRepo(s.getProjectId(), item);
            }
            if (repo == null || !s.getProjectId().equals(repo.getProjectId())) {
                return ResponseUtil.failRes(I18nUtil.get("devloop.task.repository.not.found"));
            }
            List<ProjectRepo> projectRepos = projectRepoMapper.selectList(new LambdaQueryWrapper<ProjectRepo>()
                .eq(ProjectRepo::getProjectId, s.getProjectId()).orderByAsc(ProjectRepo::getRepoId));
            ProjectRepo workspaceRepo = projectRepos.stream()
                .filter(candidate -> "workspace".equalsIgnoreCase(candidate.getRepoType())).findFirst().orElse(null);
            String baseBranch = StringUtils.isNotBlank(repo.getDefaultBranch()) ? repo.getDefaultBranch()
                : "main";
            Path workspaceDir = "workspace".equalsIgnoreCase(repo.getRepoType())
                ? resolveSessionWorkspace(s, repo.getRepoFullName())
                : resolveCodeRepoWorkspace(s, workspaceRepo, repo);

            LocalGitChangeService.FileDiffResult result = localGitChangeService.fileDiff(workspaceDir, baseBranch,
                filePath);
            Map<String, Object> map = new HashMap<>();
            map.put("status", result.getStatus().name().toLowerCase());
            map.put("filename", result.getFilename());
            map.put("diff", result.getDiff());
            map.put("message", result.getMessage());
            return ResponseUtil.successResponse(map);
        }
        catch (Exception e) {
            log.error("[Devloop] 查询文件 diff 失败, sessionId={}, file={}", sessionId, filePath, e);
            Map<String, Object> map = new HashMap<>();
            map.put("status", "git_error");
            map.put("filename", filePath);
            map.put("diff", null);
            return ResponseUtil.successResponse(map);
        }
    }

    /**
     * 定位会话中的业务代码仓库：workspace 架构从 .gitmodules 解析子模块路径，旧架构回退到会话一级目录。
     */
    private Path resolveCodeRepoWorkspace(ByaiSession session, ProjectRepo workspaceRepo, ProjectRepo codeRepo) {
        if (codeRepo == null) {
            return null;
        }
        if (workspaceRepo != null) {
            Path workspaceRoot = resolveSessionWorkspace(session, workspaceRepo.getRepoFullName());
            return new GitSubmodulePathResolver().resolve(workspaceRoot, codeRepo).orElse(null);
        }
        return resolveSessionWorkspace(session, codeRepo.getRepoFullName());
    }

    /** 按实际仓库布局生成本次变更查询目标；workspace 自身始终排在其子模块之前。 */
    private List<RepoWorkspace> resolveTaskRepoWorkspaces(ByaiSession session, ProjectRepo workspaceRepo,
        List<ProjectRepo> projectRepos) {
        List<RepoWorkspace> resolved = new ArrayList<>();
        if (workspaceRepo == null) {
            for (ProjectRepo repo : projectRepos) {
                resolved.add(new RepoWorkspace(repo, resolveSessionWorkspace(session, repo.getRepoFullName())));
            }
            return resolved;
        }

        Path workspaceRoot = resolveSessionWorkspace(session, workspaceRepo.getRepoFullName());
        resolved.add(new RepoWorkspace(workspaceRepo, workspaceRoot));
        List<ProjectRepo> codeRepos = projectRepos.stream()
            .filter(repo -> !"workspace".equalsIgnoreCase(repo.getRepoType())).toList();
        GitSubmodulePathResolver.SubmoduleResolution submoduleResolution = new GitSubmodulePathResolver()
            .resolveAllWithStatus(workspaceRoot, codeRepos);
        for (GitSubmodulePathResolver.ResolvedSubmodule submodule : submoduleResolution.submodules()) {
            resolved.add(new RepoWorkspace(submodule.repo(), submodule.path()));
        }
        // workspace 尚未克隆或 .gitmodules 不可读时无法按实际文件枚举；仅此时回退配置仓库，保留远程 compare 能力。
        if (!submoduleResolution.metadataAvailable()) {
            for (ProjectRepo codeRepo : codeRepos) {
                resolved.add(new RepoWorkspace(codeRepo, null));
            }
        }
        return resolved;
    }

    /** 汇总多个仓库的变更列表；顶层不再携带单一 repoId，每个文件使用自身仓库的 repoId。 */
    private Map<String, Object> collectTaskChanges(ByaiSession session, List<RepoWorkspace> repoWorkspaces,
        String headBranch) {
        Map<String, Object> aggregate = null;
        List<Map<String, Object>> files = new ArrayList<>();
        boolean hasLocalChanges = false;
        boolean usedRemote = false;
        String pat = null;
        boolean patLoaded = false;

        if (repoWorkspaces.isEmpty()) {
            Map<String, Object> noRepo = new HashMap<>();
            noRepo.put("status", "no_repo");
            noRepo.put("files", files);
            noRepo.put("fileCount", 0);
            noRepo.put("headBranch", headBranch);
            return noRepo;
        }

        for (RepoWorkspace repoWorkspace : repoWorkspaces) {
            ProjectRepo repo = repoWorkspace.repo();
            String baseBranch = StringUtils.isNotBlank(repo.getDefaultBranch()) ? repo.getDefaultBranch() : "main";
            Map<String, Object> repoChanges = null;
            try {
                LocalGitChangeService.LocalChangeResult local = localGitChangeService
                    .collectChanges(repoWorkspace.path(), baseBranch);
                if (local.getStatus() == LocalGitChangeService.LocalStatus.OK) {
                    repoChanges = localResultToMap(local, repo.getRepoFullName());
                    hasLocalChanges = true;
                }
                else {
                    log.info("[Devloop] 本地工作区变更不可用({}),回退远程 compare, sessionId={}, repoId={}",
                        local.getStatus(), session.getSessionId(), repo.getRepoId());
                }
            }
            catch (Exception e) {
                log.warn("[Devloop] 本地 git 变更采集异常,回退远程 compare, sessionId={}, repoId={}",
                    session.getSessionId(), repo.getRepoId(), e);
            }

            if (repoChanges == null) {
                if (!patLoaded) {
                    pat = patService.getGitHubPat(
                        session.getCreatorId() != null ? String.valueOf(session.getCreatorId()) : null);
                    patLoaded = true;
                }
                GitHubCompareService.CompareResult remote = gitHubCompareService.compare(repo.getRepoFullName(),
                    baseBranch, headBranch, pat);
                repoChanges = compareResultToMap(remote);
                usedRemote = true;
            }
            if (aggregate == null || "ok".equals(repoChanges.get("status"))) {
                aggregate = new HashMap<>(repoChanges);
            }
            appendRepoFiles(files, repoChanges.get("files"), repo.getRepoId(), (String) repoChanges.get("source"));
        }

        if (aggregate == null) {
            aggregate = errorChangesMap();
        }
        aggregate.remove("repoId");
        aggregate.put("files", files);
        aggregate.put("fileCount", files.size());
        aggregate.put("headBranch", headBranch);
        if (!files.isEmpty()) {
            aggregate.put("status", "ok");
        }
        if (hasLocalChanges) {
            aggregate.put("source", "local");
        }
        else if (usedRemote) {
            aggregate.put("source", "remote");
        }
        if (repoWorkspaces.size() > 1) {
            aggregate.remove("repoFullName");
            aggregate.remove("baseBranch");
            aggregate.remove("aheadBy");
            aggregate.remove("compareUrl");
            aggregate.remove("message");
        }
        return aggregate;
    }

    private void appendRepoFiles(List<Map<String, Object>> target, Object source, Long repoId, String changeSource) {
        if (!(source instanceof List<?> fileChanges)) {
            return;
        }
        for (Object fileChange : fileChanges) {
            if (fileChange instanceof Map<?, ?>) {
                @SuppressWarnings("unchecked")
                Map<String, Object> file = new HashMap<>((Map<String, Object>) fileChange);
                file.put("repoId", repoId);
                file.put("source", changeSource);
                target.add(file);
            }
        }
    }

    private record RepoWorkspace(ProjectRepo repo, Path path) {
    }

    /**
     * 拼会话工作区里 git 仓库的宿主机绝对路径:{nfs根}/{bucket}/by/.sessions/{sessionId}/{repoName}。 bucket 由创建者 userCode 解析;repoName 取
     * repoFullName 去掉 owner/ 前缀。任一环节缺失返回 null(走远程兜底)。
     */
    private Path resolveSessionWorkspace(ByaiSession session, String repoFullName) {
        if (repoFullName == null || repoFullName.trim().isEmpty() || session.getCreatorId() == null) {
            return null;
        }
        try {
            LoginInfo owner = loginApplicationService.getLoginInfo(session.getCreatorId());
            if (owner == null || StringUtils.isBlank(owner.getUserCode())) {
                return null;
            }
            String bucket = userBucketNamingService.buildUserBucketName(owner.getUserCode());
            String repoName = StringUtils.substringAfterLast(repoFullName, "/");
            if (StringUtils.isBlank(repoName)) {
                repoName = repoFullName;
            }
            return Paths.get(fileStorageRoot, bucket, SESSION_WORKSPACE_SEGMENT, String.valueOf(session.getSessionId()),
                repoName);
        }
        catch (Exception e) {
            log.warn("[Devloop] 解析会话工作区路径失败, sessionId={}", session.getSessionId(), e);
            return null;
        }
    }

    /** 本地变更结果转前端形状:与 compareResultToMap 同构,status/files 字段口径一致,前端无需区分来源。 */
    private Map<String, Object> localResultToMap(LocalGitChangeService.LocalChangeResult result, String repoFullName) {
        Map<String, Object> map = new HashMap<>();
        map.put("status", "ok");
        // 标记来源为本地,便于前端在需要时提示"含未推送改动";不识别该字段也不影响渲染。
        map.put("source", "local");
        map.put("repoFullName", repoFullName);
        map.put("baseBranch", result.getBaseBranch());
        map.put("headBranch", result.getHeadBranch());
        map.put("compareUrl", null);
        map.put("message", result.getMessage());
        List<Map<String, Object>> files = new ArrayList<>();
        for (LocalGitChangeService.LocalFileChange f : result.getFiles()) {
            Map<String, Object> fm = new HashMap<>();
            fm.put("filename", f.getFilename());
            fm.put("status", f.getStatus());
            fm.put("additions", f.getAdditions());
            fm.put("deletions", f.getDeletions());
            fm.put("previousFilename", f.getPreviousFilename());
            fm.put("blobUrl", null);
            files.add(fm);
        }
        map.put("files", files);
        map.put("fileCount", files.size());
        return map;
    }

    /** 比对结果转前端形状:状态字符串 + 分支信息 + 文件变更数组。 */
    private Map<String, Object> compareResultToMap(GitHubCompareService.CompareResult result) {
        Map<String, Object> map = new HashMap<>();
        // 状态转小写字符串,前端按 ok/no_repo/no_token/branch_not_found/http_error 分支渲染不同空态。
        map.put("status", result.getStatus().name().toLowerCase());
        // 来源标记为远程,与本地口径统一;前端可据此提示"仅远程已推送"。
        map.put("source", "remote");
        map.put("repoFullName", result.getRepoFullName());
        map.put("baseBranch", result.getBaseBranch());
        map.put("headBranch", result.getHeadBranch());
        map.put("aheadBy", result.getAheadBy());
        map.put("compareUrl", result.getCompareUrl());
        map.put("message", result.getMessage());
        List<Map<String, Object>> files = new ArrayList<>();
        for (GitHubCompareService.FileChange f : result.getFiles()) {
            Map<String, Object> fm = new HashMap<>();
            fm.put("filename", f.getFilename());
            fm.put("status", f.getStatus());
            fm.put("additions", f.getAdditions());
            fm.put("deletions", f.getDeletions());
            fm.put("previousFilename", f.getPreviousFilename());
            fm.put("blobUrl", f.getBlobUrl());
            files.add(fm);
        }
        map.put("files", files);
        map.put("fileCount", files.size());
        return map;
    }

    private DevloopTaskStateDto tryReadTaskState(ByaiSession session) {
        try {
            return readTaskState(session);
        }
        catch (Exception e) {
            log.warn("[Devloop] 读取任务状态失败, sessionId={}", session.getSessionId(), e);
            return null;
        }
    }

    private DevloopTaskStateDto readTaskState(ByaiSession session) {
        if (session.getCreatorId() == null) {
            throw new IllegalStateException("会话缺少创建者");
        }
        LoginInfo owner = loginApplicationService.getLoginInfo(session.getCreatorId());
        if (owner == null || StringUtils.isBlank(owner.getUserCode())) {
            throw new IllegalStateException("无法解析会话创建者");
        }
        return taskStateReader.read(owner.getUserCode(), session.getSessionId());
    }

    /**
     * 实时解析任务上下文：不落库，按需从关联链路查。需求/仓库优先级为：手工需求 JSON.repoId、扫描源 repoId、项目仓库； agent：session.objectId(数字员工resourceId) ->
     * 资源名；负责人：session.creatorId -> 用户名； 分支：由 taskType(据需求内容判定) + sessionId 确定性重算。关联信息变化后展示随之更新。
     */
    private Map<String, Object> resolveTaskContext(ByaiSession s) {
        Map<String, Object> ctx = new HashMap<>();
        Long sessionId = s.getSessionId();

        // 派生任务会把 sessionId 回写到需求项；据此还原需求与仓库。手动任务无此行，走项目兜底仓库。
        ScanRequireItem item = scanRequireItemMapper.selectOne(
            new LambdaQueryWrapper<ScanRequireItem>().eq(ScanRequireItem::getSessionId, sessionId).last("limit 1"));
        if (item != null) {
            ctx.put("requirementTitle", item.getTitle());
            ctx.put("requirementOriginId", item.getOriginId());
            ctx.put("sourceItemId", item.getItemId());
        }
        ProjectRepo repo = resolveTaskRepo(s.getProjectId(), item);
        ctx.put("repoFullName", repo != null ? repo.getRepoFullName() : null);

        String taskType = detectTaskType(item, s.getSessionName());
        ctx.put("branchName", buildBranchName(taskType, sessionId));

        // 同一次资源查询同时补齐任务详情所需的数字员工名称和头像，避免重复访问资源表。
        SsResource agentResource = resolveAgentResource(s.getObjectId());
        ctx.put("agentName",
            agentResource != null && agentResource.getResourceName() != null ? agentResource.getResourceName() : "");
        ctx.put("agentAvatar", agentResource != null ? agentResource.getAvatar() : "");
        ctx.put("assignee", resolveUserName(s.getCreatorId()));
        return ctx;
    }

    /** agentId(resourceId) -> 数字员工资源；查不到返回 null。 */
    private SsResource resolveAgentResource(Long agentId) {
        if (agentId == null) {
            return null;
        }
        return ssResourceMapper.selectByResourceId(agentId);
    }

    /** userId -> 用户名；查不到返回空串。 */
    private String resolveUserName(Long userId) {
        if (userId == null) {
            return "";
        }
        try {
            LoginInfo info = loginApplicationService.getLoginInfo(userId);
            return info != null && info.getUserName() != null ? info.getUserName() : "";
        }
        catch (Exception e) {
            log.warn("[Devloop] 解析负责人失败, userId={}", userId, e);
            return "";
        }
    }

    /** 会话元数据与 v2 状态投影合并为任务视图；状态文件不存在时保留元数据并标记不可用。 */
    private DevloopTaskViewDto sessionAsTask(ByaiSession session, DevloopTaskStateDto state,
        Map<String, Object> context) {
        DevloopTaskViewDto task = new DevloopTaskViewDto();
        task.setTaskId(session.getSessionId());
        task.setSessionId(session.getSessionId());
        task.setProjectId(session.getProjectId());
        task.setTitle(session.getSessionName());
        task.setSessionContent(session.getSessionContent());
        task.setCreateBy(session.getCreatorId());
        task.setCreateTime(session.getCreateTime());
        task.setUpdateTime(session.getUpdateTime());
        task.setStateAvailable(state != null);
        if (state != null) {
            task.setTraceId(state.getTraceId());
            task.setRevision(state.getRevision());
            task.setStatus(state.getStatus());
            task.setStatusLabel(state.getStatusLabel());
            task.setCurrentStage(state.getCurrentStage());
            task.setProgress(state.getProgress() != null ? state.getProgress().getPercent() : 0);
            task.setLoopCount(state.getLoopCount());
            task.setStageLoopCount(state.getStageLoopCount());
        }
        else {
            task.setProgress(0);
        }
        task.setAssignee(context != null ? (String) context.get("assignee") : null);
        task.setAgentName(context != null ? (String) context.get("agentName") : null);
        // 数字员工头像与名称同源返回，前端任务详情无需再次查询资源接口。
        task.setAvatar(context != null ? (String) context.get("agentAvatar") : null);
        task.setBranchName(context != null ? (String) context.get("branchName") : null);
        task.setRepoFullName(context != null ? (String) context.get("repoFullName") : null);
        task.setRequirementTitle(context != null ? (String) context.get("requirementTitle") : null);
        task.setRequirementOriginId(context != null ? (String) context.get("requirementOriginId") : null);
        task.setSourceItemId(context != null ? (Long) context.get("sourceItemId") : null);
        return task;
    }

    // ========== 项目成员 ==========

    // ========== DWS 钉钉授权 ==========

    /** 启动设备授权流程（异步启动dws进程，返回userCode和verificationUrl） */
    public ResponseUtil<Map<String, Object>> startDwsDeviceAuth() {
        Map<String, Object> result = dwsAuthService.startDeviceAuth(
            DwsAuthorizationCommandPolicy.command(dwsCommandCatalog(), "login", 0, "login")
        );
        if (Boolean.TRUE.equals(result.get("success"))) {
            return ResponseUtil.successResponse(result);
        }
        return ResponseUtil
            .failRes((String) result.getOrDefault("message", I18nUtil.get("devloop.dws.auth.start.failed")));
    }

    /** 检查DWS授权状态（前端轮询用）：新建源弹窗里当前用户给自己授权的场景，查当前登录用户。 */
    public ResponseUtil<Map<String, Object>> checkDwsAuthStatus() {
        return ResponseUtil.successResponse(buildDwsStatus(CurrentUserHolder.getCurrentUserId(), true));
    }

    /**
     * 按扫描源查授权状态：查该源【创建者】的授权(不是当前登录用户)，用于列表逐源展示。 额外返回 canAuthorize(当前登录用户==创建者才可授权) 与创建者名，供前端 (c) 文案与入口控制。
     */
    public ResponseUtil<Map<String, Object>> checkDwsAuthStatusBySource(Long sourceId) {
        ScanSource source = scanSourceService.findById(sourceId);
        if (source == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.source.not.found"));
        }
        Long creatorId = parseUserId(source.getCreateBy());
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        boolean canAuthorize = currentUserId != null && currentUserId.equals(creatorId);

        Map<String, Object> result = buildDwsStatus(creatorId, canAuthorize);
        result.put("canAuthorize", canAuthorize);
        result.put("creatorId", source.getCreateBy());
        result.put("creatorName", resolveUserName(creatorId));
        return ResponseUtil.successResponse(result);
    }

    /** 构造某用户的 DWS 授权状态视图；旧入口按原响应结构附带 hasToken/savedAt 兼容字段。 */
    private Map<String, Object> buildDwsStatus(Long userId, boolean includeLegacyTokenFields) {
        Map<String, Object> runtimeStatus = dwsAuthService.getAuthStatus(
            userId,
            DwsAuthorizationCommandPolicy.command(dwsCommandCatalog(), "status", 0, "status")
        );
        Map<String, Object> result = new HashMap<>();
        if (includeLegacyTokenFields) {
            result.put("hasToken", Boolean.TRUE.equals(runtimeStatus.get("authenticated")));
            result.put("savedAt", "");
        }
        result.put("runtimeAuthenticated", runtimeStatus.get("authenticated"));
        result.put("tokenValid", runtimeStatus.get("tokenValid"));
        result.put("refreshTokenValid", runtimeStatus.getOrDefault("refreshTokenValid", false));
        result.put("expiresAt", runtimeStatus.getOrDefault("expiresAt", ""));
        result.put("refreshExpiresAt", runtimeStatus.getOrDefault("refreshExpiresAt", ""));
        result.put("corpId", runtimeStatus.getOrDefault("corpId", ""));
        result.put("corpName", runtimeStatus.getOrDefault("corpName", ""));
        result.put("userId", runtimeStatus.getOrDefault("userId", ""));
        result.put("userName", runtimeStatus.getOrDefault("userName", ""));
        return result;
    }

    private ManifestCommandCatalog dwsCommandCatalog() {
        return connectorManifestCommandResolver.resolve(connectorInfoService.findByCode("dingtalk"));
    }

    /** 查询可用运营任务模板；模板目录为系统级数据，不受项目类型限制。 */
    public ResponseUtil<List<OperationTaskTemplate>> listOperationTaskTemplates(String templateType) {
        return ResponseUtil.successResponse(operationTaskTemplateService.list(templateType));
    }

    /** 查询运营任务模板详情，供聊天输入框和运营任务启动入口复用。 */
    public ResponseUtil<OperationTaskTemplate> getOperationTaskTemplate(Long templateId) {
        OperationTaskTemplate template = operationTaskTemplateService.get(templateId);
        return template == null ? ResponseUtil.failRes(I18nUtil.get("devloop.operationTaskTemplate.notFound"))
            : ResponseUtil.successResponse(template);
    }

    /** 创建运营需求，运营需求与研发渠道共用扫描源表但使用独立 source_type。 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Map<String, Object>> createOperationRequirement(OperationRequirementDTO dto) {
        String accessError = validateOperationProjectAccess(dto == null ? null : dto.getProjectId());
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        String validationError = validateOperationRequirement(dto, false);
        if (validationError != null) {
            return ResponseUtil.failRes(validationError);
        }

        ScanSource source = new ScanSource();
        source.setProjectId(dto.getProjectId());
        source.setSourceName(dto.getRequirementName().trim());
        source.setSourceDescription(StringUtils.trimToNull(dto.getSourceDescription()));
        source.setSourceType(normalizeOperationSourceType(dto.getOperationType()));
        Map<String, Object> operationConfig = normalizeOperationScheduleConfig(dto.getConfig());
        source.setConfig(JSON.toJSONString(operationConfig));
        source.setCronExpr(getOperationConfigText(operationConfig, "cronExpr"));
        // 需求需用户确认拆解后才启用调度，研发扫描源的默认启用行为不受影响。
        source.setEnabled("0");
        source.setAssignee(dto.getAssignee());
        source.setDueTime(parseOperationDueTime(dto.getDueTime()));
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        source.setCreateBy(currentUserId == null ? null : String.valueOf(currentUserId));
        ScanSource created = scanSourceService.create(source);

        Map<String, Object> result = new HashMap<>();
        result.put("itemId", created.getSourceId());
        result.put("sourceId", created.getSourceId());
        return ResponseUtil.successResponse(result);
    }

    /** 修改尚未启动的运营需求，项目归属始终以已存记录为准。 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> updateOperationRequirement(OperationRequirementDTO dto) {
        String validationError = validateOperationRequirement(dto, true);
        if (validationError != null) {
            return ResponseUtil.failRes(validationError);
        }
        ScanSource existing = findOperationSource(dto.getItemId());
        if (existing == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationRequirement.notFound"));
        }
        String accessError = validateOperationProjectAccess(existing.getProjectId());
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        if (operationTaskSessionService.existsBySourceId(existing.getSourceId())) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationRequirement.edit.forbidden"));
        }

        ScanSource update = new ScanSource();
        update.setSourceId(existing.getSourceId());
        update.setSourceName(dto.getRequirementName().trim());
        update.setSourceDescription(StringUtils.trimToNull(dto.getSourceDescription()));
        update.setSourceType(normalizeOperationSourceType(dto.getOperationType()));
        Map<String, Object> operationConfig = normalizeOperationScheduleConfig(dto.getConfig());
        update.setConfig(JSON.toJSONString(operationConfig));
        // MyBatis 默认忽略 null，类型从采集改为其它运营需求时用空串显式清除旧 Cron。
        update.setCronExpr(StringUtils.defaultString(getOperationConfigText(operationConfig, "cronExpr")));
        update.setAssignee(dto.getAssignee());
        update.setDueTime(parseOperationDueTime(dto.getDueTime()));
        scanSourceService.update(update);
        return ResponseUtil.successResponse(null);
    }

    /** 分页查询当前用户可访问运营项目的需求列表。 */
    public ResponseUtil<PageInfo<Map<String, Object>>> listOperationRequirements(Long projectId, String keyword,
        int pageNum, int pageSize) {
        String accessError = validateOperationProjectAccess(projectId);
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        Page<ScanSource> page = scanSourceService.pageOperationRequirements(projectId, keyword, pageNum, pageSize);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ScanSource source : page.getRecords()) {
            list.add(toOperationRequirementMap(source));
        }
        PageInfo<Map<String, Object>> result = new PageInfo<>();
        result.setPageNum(pageNum);
        result.setPageSize(pageSize);
        result.setTotal(page.getTotal());
        result.setTotalPages((int) page.getPages());
        result.setList(list);
        return ResponseUtil.successResponse(result);
    }

    /** 查询单条运营需求详情。 */
    public ResponseUtil<Map<String, Object>> getOperationRequirement(Long itemId) {
        ScanSource requirement = findOperationSource(itemId);
        if (requirement == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationRequirement.notFound"));
        }
        String accessError = validateOperationProjectAccess(requirement.getProjectId());
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        return ResponseUtil.successResponse(toOperationRequirementMap(requirement));
    }

    /** 删除运营需求；仅需求创建人可操作，关联任务使用逻辑删除保留执行成果。 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> deleteOperationRequirement(Long itemId) {
        ScanSource requirement = findOperationSource(itemId);
        if (requirement == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationRequirement.notFound"));
        }
        String accessError = validateOperationProjectAccess(requirement.getProjectId());
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        String creatorError = validateEntityCreator(resolveOperationRequirementCreator(requirement));
        if (creatorError != null) {
            return ResponseUtil.failRes(creatorError);
        }
        operationTaskSessionService.markDeletedBySourceId(requirement.getSourceId(),
            CurrentUserHolder.getCurrentUserId());
        scanSourceService.delete(requirement.getSourceId());
        return ResponseUtil.successResponse(null);
    }

    /**
     * 启动运营需求并一次创建前端确认后的多个运营任务。 任务拆解结果由前端展示给用户调整后提交，后端仅负责校验、持久化和需求状态流转。
     * 需求启动阶段只校验负责人是否属于项目成员，不校验其数字员工绑定；数字员工绑定在执行具体任务时实时校验。
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<List<Map<String, Object>>> startOperationRequirement(OperationRequirementStartDTO dto) {
        if (dto == null || dto.getRequirementId() == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.requirementId.required"));
        }
        ScanSource requirement = findOperationSource(dto.getRequirementId());
        if (requirement == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationRequirement.notFound"));
        }
        String accessError = validateOperationProjectAccess(requirement.getProjectId());
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        if (operationTaskSessionService.existsBySourceId(requirement.getSourceId())) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.requirement.start.forbidden"));
        }
        List<OperationTaskDTO> taskDtos = dto.getTasks();
        if (taskDtos == null || taskDtos.isEmpty()) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.tasks.required"));
        }

        // 先完整校验拆解结果，再统一创建任务，避免中途失败时前面的任务已经落库。
        for (OperationTaskDTO taskDto : taskDtos) {
            String validationError = validateOperationTaskForStart(taskDto, requirement);
            if (validationError != null) {
                return ResponseUtil.failRes(validationError);
            }
        }

        List<Map<String, Object>> createdTasks = new ArrayList<>();
        for (OperationTaskDTO taskDto : taskDtos) {
            // 这里仅创建待执行会话，不提前解析数字员工，避免需求拆解阶段被成员绑定状态阻断。
            AssistantChatDto chatDto = new AssistantChatDto();
            chatDto.setProjectId(requirement.getProjectId());
            chatDto.setChatContent(taskDto.getTitle().trim());
            chatDto.setAccessTerminal("DevLoop");
            chatDto.setClientRequestId(AssistantChatService.getClientRequestId());
            assistantChatService.createGroupChatSession(chatDto);
            // 通用聊天服务会按聊天标题截断名称，运营任务需保留用户确认后的完整任务名称。
            ByaiSession pendingSession = new ByaiSession();
            pendingSession.setSessionId(chatDto.getSessionId());
            pendingSession.setSessionName(limitOperationSessionName(taskDto.getTitle().trim()));
            pendingSession.setSessionContent(StringUtils.trimToNull(taskDto.getDescription()));
            pendingSession.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            byaiSessionMapper.updateById(pendingSession);
            Map<String, String> extValues = new LinkedHashMap<>();
            extValues.put(OperationTaskSessionService.EXT_SOURCE_ID, String.valueOf(requirement.getSourceId()));
            extValues.put(OperationTaskSessionService.EXT_STATUS, OperationTaskSessionService.STATUS_PENDING);
            extValues.put(OperationTaskSessionService.EXT_ASSIGNEE_ID, String.valueOf(taskDto.getAssignee()));
            extValues.put(OperationTaskSessionService.EXT_DESCRIPTION,
                StringUtils.defaultString(StringUtils.trimToNull(taskDto.getDescription())));
            extValues.put(OperationTaskSessionService.EXT_DUE_TIME,
                StringUtils.defaultString(formatDateTime(parseOperationDueTime(taskDto.getDueTime()))));
            OperationTaskTemplate selectedTemplate = taskDto.getTemplateId() == null ? null
                : operationTaskTemplateService.get(taskDto.getTemplateId());
            // 任务执行类型以用户最终选择的模板为准，兼容需求阶段留下的旧 source_type。
            extValues.put(OperationTaskSessionService.EXT_OPERATION_TYPE,
                selectedTemplate == null ? requirement.getSourceType() : selectedTemplate.getTemplateType());
            // 模板详情的执行配置优先于需求阶段的历史配置；需求阶段已不再采集执行方式。
            extValues.put(OperationTaskSessionService.EXT_CONFIG,
                taskDto.getConfig() == null ? StringUtils.defaultString(requirement.getConfig(), "{}")
                    : JSON.toJSONString(taskDto.getConfig()));
            if (taskDto.getTemplateId() != null) {
                extValues.put(OperationTaskSessionService.EXT_TEMPLATE_ID, String.valueOf(taskDto.getTemplateId()));
            }
            extValues.put(OperationTaskSessionService.EXT_AGENT_SELECTION, "[]");
            extValues.put(OperationTaskSessionService.EXT_WORKFLOW, "[]");
            extValues.put(OperationTaskSessionService.EXT_TRIGGER_TIME, formatDateTime(new Date()));
            operationTaskSessionService.saveTaskExtensions(chatDto.getSessionId(), extValues);
            createdTasks.add(toOperationTaskMap(chatDto.getSessionId()));
        }
        // 用户确认拆解后才启用调度，单次、间隔和周期模式均由源配置决定是否继续触发。
        ScanSource enabled = new ScanSource();
        enabled.setSourceId(requirement.getSourceId());
        enabled.setEnabled("1");
        scanSourceService.update(enabled);
        // 本次人工确认拆解即视为首次触发，防止调度器下一分钟再次生成同一批任务。
        scanSourceService.updateLastScanTime(requirement.getSourceId());
        return ResponseUtil.successResponse(createdTasks);
    }

    /** 按项目分页查询已从运营需求拆解出的任务，支持负责人、日期、状态和忽略大小写搜索。 */
    public ResponseUtil<PageInfo<Map<String, Object>>> listOperationTasks(Long projectId, String keyword,
        boolean onlyMine, String createTimeStart, String createTimeEnd, String status, int pageNum, int pageSize) {
        String accessError = validateOperationProjectAccess(projectId);
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        Long assignee = onlyMine ? CurrentUserHolder.getCurrentUserId() : null;
        Page<ByaiSession> page = operationTaskSessionService.pageByProjectId(projectId, assignee, keyword,
            parseOperationDueTime(createTimeStart), parseOperationDueTime(createTimeEnd),
            normalizeOperationTaskStatus(status), pageNum, pageSize);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ByaiSession task : page.getRecords()) {
            list.add(toOperationTaskMap(task));
        }
        PageInfo<Map<String, Object>> result = new PageInfo<>();
        result.setPageNum(pageNum);
        result.setPageSize(pageSize);
        result.setTotal(page.getTotal());
        result.setTotalPages((int) page.getPages());
        result.setList(list);
        return ResponseUtil.successResponse(result);
    }

    /** 查询运营任务详情。 */
    public ResponseUtil<Map<String, Object>> getOperationTask(Long taskId) {
        ByaiSession task = operationTaskSessionService.findById(taskId);
        if (task == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.notFound"));
        }
        String accessError = validateOperationProjectAccess(task.getProjectId());
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        return ResponseUtil.successResponse(toOperationTaskMap(task));
    }

    /** 修改待开始运营任务的名称、描述、负责人和预期时间。 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> updateOperationTask(OperationTaskDTO dto) {
        if (dto == null || dto.getTaskId() == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.id.required"));
        }
        ByaiSession task = operationTaskSessionService.findById(dto.getTaskId());
        if (task == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.notFound"));
        }
        String accessError = validateOperationProjectAccess(task.getProjectId());
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        if (!operationTaskSessionService.isPending(task.getSessionId())) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.edit.forbidden"));
        }
        if (StringUtils.isBlank(dto.getTitle())) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.title.required"));
        }
        if (dto.getTitle().trim().length() > OPERATION_SESSION_NAME_MAX_LENGTH) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.title.length.invalid"));
        }
        if (StringUtils.length(dto.getDescription()) > OPERATION_REQUIREMENT_TEXT_MAX_LENGTH) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.description.length.invalid"));
        }
        if (dto.getAssignee() == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.assignee.required"));
        }
        Project project = projectMapper.selectById(task.getProjectId());
        if (project == null || (!dto.getAssignee().equals(project.getCreateBy())
            && !projectMemberService.isMember(task.getProjectId(), dto.getAssignee()))) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.assignee.invalid"));
        }
        Date dueTime;
        try {
            dueTime = parseOperationDueTime(dto.getDueTime());
        }
        catch (IllegalArgumentException exception) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationRequirement.dueTime.invalid"));
        }

        ByaiSession update = new ByaiSession();
        update.setSessionId(task.getSessionId());
        update.setSessionName(dto.getTitle().trim());
        update.setSessionContent(StringUtils.trimToNull(dto.getDescription()));
        update.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        update.setUpdateTime(new Date());
        byaiSessionMapper.updateById(update);
        Map<String, String> extensions = new LinkedHashMap<>();
        extensions.put(OperationTaskSessionService.EXT_DESCRIPTION,
            StringUtils.defaultString(StringUtils.trimToNull(dto.getDescription())));
        extensions.put(OperationTaskSessionService.EXT_ASSIGNEE_ID, String.valueOf(dto.getAssignee()));
        extensions.put(OperationTaskSessionService.EXT_DUE_TIME, StringUtils.defaultString(formatDateTime(dueTime)));
        operationTaskSessionService.saveTaskExtensions(task.getSessionId(), extensions);
        return ResponseUtil.successResponse(null);
    }

    /** 删除任意状态的运营任务；只有任务创建人可执行。 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> deleteOperationTask(Long taskId) {
        ByaiSession task = operationTaskSessionService.findById(taskId);
        if (task == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.notFound"));
        }
        String accessError = validateOperationProjectAccess(task.getProjectId());
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        String creatorError = validateEntityCreator(resolveOperationTaskCreator(task));
        if (creatorError != null) {
            return ResponseUtil.failRes(creatorError);
        }
        operationTaskSessionService.markDeleted(task.getSessionId(), CurrentUserHolder.getCurrentUserId());
        return ResponseUtil.successResponse(null);
    }

    /** 确认承接成员后启动既有运营任务会话，并保存多员工并行编排信息。 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Map<String, Object>> executeOperationTask(OperationTaskDTO dto) {
        if (dto == null || dto.getTaskId() == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.id.required"));
        }
        ByaiSession task = operationTaskSessionService.findById(dto.getTaskId());
        if (task == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.notFound"));
        }
        String accessError = validateOperationProjectAccess(task.getProjectId());
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        Map<String, String> taskExt = operationTaskSessionService.getExtValues(task.getSessionId());
        if (OperationTaskSessionService.STATUS_RUNNING.equals(taskExt.get(OperationTaskSessionService.EXT_STATUS))) {
            Map<String, Object> result = new HashMap<>();
            result.put("taskId", task.getSessionId());
            result.put("sessionId", task.getSessionId());
            return ResponseUtil.successResponse(result);
        }
        String taskStatus = taskExt.get(OperationTaskSessionService.EXT_STATUS);
        // 待处理可首次启动；部分失败（mixed）允许重新执行。
        if (!OperationTaskSessionService.STATUS_PENDING.equals(taskStatus)
            && !OperationTaskSessionService.STATUS_MIXED.equals(taskStatus)) {
            // 仅待执行或部分失败任务允许创建会话，避免已完成任务被重复启动。
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.execute.forbidden"));
        }
        // 模板执行页允许覆盖待执行任务的模板配置；先落扩展参数，再由统一提示词构造逻辑读取，保证聊天首条消息使用用户确认后的内容。
        if (dto.getTemplateId() != null || dto.getConfig() != null) {
            Map<String, String> templateExtensions = new LinkedHashMap<>();
            if (dto.getTemplateId() != null) {
                OperationTaskTemplate template = operationTaskTemplateService.get(dto.getTemplateId());
                if (template == null) {
                    return ResponseUtil.failRes("任务模板不存在");
                }
                templateExtensions.put(OperationTaskSessionService.EXT_TEMPLATE_ID,
                    String.valueOf(dto.getTemplateId()));
                templateExtensions.put(OperationTaskSessionService.EXT_OPERATION_TYPE,
                    StringUtils.defaultString(template.getTemplateType()));
            }
            if (dto.getConfig() != null) {
                // 执行配置中的本体统一补齐 ID、code、名称和描述，供会话对象详情及 Worker 直接消费。
                templateExtensions.put(OperationTaskSessionService.EXT_CONFIG,
                    JSON.toJSONString(enrichOperationTaskOntologyConfig(dto.getConfig())));
            }
            operationTaskSessionService.saveTaskExtensions(task.getSessionId(), templateExtensions);
            taskExt = operationTaskSessionService.getExtValues(task.getSessionId());
        }
        List<Long> agentIds = resolveOperationTaskAgentIds(dto, task.getProjectId());
        if (agentIds.isEmpty()) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.agents.required"));
        }

        Long primaryAgentId = agentIds.get(0);
        if (primaryAgentId == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationTask.agents.required"));
        }
        List<ResourceVo> mentionedAgents = buildOperationTaskAgentResources(agentIds);
        AssistantChatDto chatDto = new AssistantChatDto();
        chatDto.setAgentId(primaryAgentId);
        chatDto.setProjectId(task.getProjectId());
        chatDto.setSessionId(task.getSessionId());
        chatDto.setResourceList(mentionedAgents);
        // 运营任务首条消息需要在聊天记录中明确展示模板页面选中的数字员工。
        chatDto.setPreserveLeadingDigitalEmployeeMention(true);
        // 运营任务复用研发任务的 DevLoop 聊天通道，确保首条任务指令按统一链路持久化并触发数字员工。
        chatDto.setAccessTerminal("DevLoop");
        chatDto.setClientRequestId(AssistantChatService.getClientRequestId());
        // 拆解阶段已经创建会话，这里只更新会话绑定员工并发送首条运营提示词，避免生成空会话。
        chatDto.setChatContent(buildOperationTaskPrompt(task, taskExt, mentionedAgents));
        if (agentIds.size() > 1) {
            // 多个承接成员的员工以并行泳道执行，agentId 清空后由 resourceList 和 multiAgent 路由逐一分发。
            chatDto.setAgentId(null);
            chatDto.setExtParams(buildOperationTaskMultiAgentExtParams(task.getSessionId(), agentIds));
        }
        task.setObjectId(primaryAgentId);
        task.setObjectType("DigEmployee");
        task.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        byaiSessionMapper.updateById(task);
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();

        List<Map<String, Object>> workflow = new ArrayList<>();
        for (int index = 0; index < agentIds.size(); index++) {
            Long agentId = agentIds.get(index);
            Map<String, Object> step = new LinkedHashMap<>();
            step.put("id", agentId);
            step.put("name", I18nUtil.get("devloop.operationTask.workflow.step"));
            step.put("agentId", agentId);
            step.put("status", index == 0 ? "in_progress" : "pending");
            workflow.add(step);
        }

        operationTaskSessionService.updateTaskState(task.getSessionId(), OperationTaskSessionService.STATUS_RUNNING,
            JSON.toJSONString(agentIds), JSON.toJSONString(workflow));

        // 事务提交后异步发送首条指令，确保前端跳转到会话时可以加载已持久化的任务和消息上下文。
        submitTaskChatAfterCommit(chatDto, loginInfo, task.getSessionId());

        Map<String, Object> result = new HashMap<>();
        result.put("taskId", task.getSessionId());
        result.put("sessionId", task.getSessionId());
        return ResponseUtil.successResponse(result);
    }

    /** 补全任务模板配置中的本体对象；前端字段不完整时优先从资源表读取真实元数据。 */
    private Map<String, Object> enrichOperationTaskOntologyConfig(Map<String, Object> config) {
        Map<String, Object> enrichedConfig = new LinkedHashMap<>(config);
        // 目标本体和来源本体都统一补全为包含 ID/code/name 的对象，供执行器和提示词共同使用。
        enrichOperationTaskOntologyField(enrichedConfig, "ontology");
        enrichOperationTaskOntologyField(enrichedConfig, "sourceOntology");
        return enrichedConfig;
    }

    private void enrichOperationTaskOntologyField(Map<String, Object> config, String fieldName) {
        Object value = config.get(fieldName);
        if (value == null) {
            return;
        }
        List<?> values = value instanceof List<?> list ? list : List.of(value);
        List<Map<String, Object>> enrichedValues = new ArrayList<>();
        for (Object item : values) {
            enrichedValues.add(enrichOperationTaskOntology(item));
        }
        config.put(fieldName, enrichedValues);
    }

    /** 将单个本体值归一为同时兼容资源、本体对象和通用详情字段的结构。 */
    private Map<String, Object> enrichOperationTaskOntology(Object value) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (value instanceof Map<?, ?> valueMap) {
            valueMap.forEach((key, itemValue) -> result.put(String.valueOf(key), itemValue));
        }
        else if (value != null) {
            // 仅提交数字/字符串时，前端 Select 的值约定为 resourceId，不把它误当 objectId。
            result.put("resourceId", value);
        }

        Object requestedObjectId = firstOperationOntologyValue(result, "objectId", "id");
        Object requestedResourceId = firstOperationOntologyValue(result, "resourceId");
        Object requestedId = requestedResourceId != null ? requestedResourceId : requestedObjectId;
        String requestedCode = operationOntologyText(
            firstOperationOntologyValue(result, "objectCode", "resourceCode", "code"));
        SsResource resource = findOperationOntologyResource(requestedId, requestedCode);
        Object resourceId = resource != null && resource.getResourceId() != null ? resource.getResourceId()
            : requestedResourceId;
        Object objectId = requestedObjectId != null ? requestedObjectId : resourceId;
        Object id = objectId != null ? objectId : requestedId;
        String code = resource != null && StringUtils.isNotBlank(resource.getResourceCode())
            ? resource.getResourceCode()
            : requestedCode;
        String name = operationOntologyText(firstOperationOntologyValue(result, "objectName", "resourceName", "name"));
        if (StringUtils.isBlank(name) && resource != null) {
            name = resource.getResourceName();
        }
        String description = operationOntologyText(
            firstOperationOntologyValue(result, "objectDesc", "resourceDesc", "description"));
        if (StringUtils.isBlank(description) && resource != null) {
            description = resource.getResourceDesc();
        }

        result.put("id", id);
        result.put("objectId", objectId);
        result.put("resourceId", resourceId != null ? resourceId : id);
        Object baseId = firstOperationOntologyValue(result, "baseId");
        result.put("baseId", baseId);
        result.put("code", StringUtils.defaultString(code));
        result.put("objectCode", StringUtils.defaultString(code));
        result.put("resourceCode", StringUtils.defaultString(code));
        result.put("name", StringUtils.defaultString(name));
        result.put("objectName", StringUtils.defaultString(name));
        result.put("resourceName", StringUtils.defaultString(name));
        result.put("description", StringUtils.defaultString(description));
        result.put("objectDesc", StringUtils.defaultString(description));
        result.put("resourceDesc", StringUtils.defaultString(description));
        return result;
    }

    private Object firstOperationOntologyValue(Map<String, Object> value, String... keys) {
        for (String key : keys) {
            Object candidate = value.get(key);
            if (candidate != null && StringUtils.isNotBlank(String.valueOf(candidate))) {
                return candidate;
            }
        }
        return null;
    }

    private String operationOntologyText(Object value) {
        return value == null ? null : StringUtils.trimToNull(String.valueOf(value));
    }

    /** 本体绑定可能保存资源 ID 或资源 code，两种情况都兼容查询。 */
    private SsResource findOperationOntologyResource(Object id, String code) {
        if (id != null) {
            try {
                SsResource resource = ssResourceMapper.selectByResourceId(Long.valueOf(String.valueOf(id)));
                if (resource != null) {
                    return resource;
                }
            }
            catch (NumberFormatException ignored) {
                // 外部本体 ID 可能是字符串编码，继续按 resource_code 查询。
            }
        }
        String resourceCode = StringUtils.defaultIfBlank(code, id == null ? null : String.valueOf(id));
        if (StringUtils.isBlank(resourceCode)) {
            return null;
        }
        return ssResourceMapper.selectOne(
            new LambdaQueryWrapper<SsResource>().eq(SsResource::getResourceCode, resourceCode).last("LIMIT 1"));
    }

    /**
     * 定时运营源到点后创建待执行会话。调度器只负责生成任务，不自动发送提示词，用户仍可在任务列表确认承接成员后执行。
     */
    @Transactional(rollbackFor = Exception.class)
    public void executeOperationSourceSchedule(ScanSource source) {
        if (source == null || !ScanSourceService.OPERATION_SOURCE_TYPE_COLLECT.equals(source.getSourceType())) {
            return;
        }
        Long assigneeId = source.getAssignee();
        Long agentId = resolveAgentIdForAssignee(assigneeId, source.getProjectId());
        if (assigneeId == null || agentId == null) {
            log.warn("[OperationSchedule] 运营源 {} 负责人未绑定数字员工，跳过本次生成", source.getSourceId());
            return;
        }
        Long creatorId = parseOperationLong(source.getCreateBy());
        if (creatorId == null) {
            creatorId = assigneeId;
        }
        Date now = new Date();
        SessionMembersDto session = new SessionMembersDto();
        session.setSessionId(sequenceService.nextVal());
        session.setProjectId(source.getProjectId());
        session.setSessionName(limitOperationSessionName(source.getSourceName()));
        session.setSessionContent(source.getSourceDescription());
        session.setCreatorId(creatorId);
        session.setObjectType("DigEmployee");
        session.setObjectId(agentId);
        session.setSessionType("h_as");
        session.setCreateTime(now);
        session.setUpdateTime(now);

        // 调度创建的会话同时登记负责人和数字员工，后续执行接口可直接复用同一会话。
        List<ByaiSessionMember> members = new ArrayList<>();
        ByaiSessionMember userMember = new ByaiSessionMember();
        userMember.setByaiSessionMemberId(sequenceService.nextVal());
        userMember.setSessionId(session.getSessionId());
        userMember.setMemObjType("USER");
        userMember.setMemObjId(assigneeId);
        userMember.setUserRole("OWNER");
        userMember.setCreatorId(creatorId);
        userMember.setCreateTime(now);
        userMember.setMemName(resolveUserName(assigneeId));
        members.add(userMember);
        ByaiSessionMember agentMember = new ByaiSessionMember();
        agentMember.setByaiSessionMemberId(sequenceService.nextVal());
        agentMember.setSessionId(session.getSessionId());
        agentMember.setMemObjType("AGENT");
        agentMember.setMemObjId(agentId);
        agentMember.setUserRole("MEMBER");
        agentMember.setCreatorId(creatorId);
        agentMember.setCreateTime(now);
        agentMember.setMemName(resolveOperationResourceName(agentId));
        members.add(agentMember);
        session.setMembers(members);
        sessionService.createSessionMembers(session);

        Map<String, String> extValues = new LinkedHashMap<>();
        extValues.put(OperationTaskSessionService.EXT_SOURCE_ID, String.valueOf(source.getSourceId()));
        extValues.put(OperationTaskSessionService.EXT_STATUS, OperationTaskSessionService.STATUS_PENDING);
        extValues.put(OperationTaskSessionService.EXT_ASSIGNEE_ID, String.valueOf(assigneeId));
        extValues.put(OperationTaskSessionService.EXT_DESCRIPTION,
            StringUtils.defaultString(source.getSourceDescription()));
        extValues.put(OperationTaskSessionService.EXT_DUE_TIME, formatDateTime(source.getDueTime()));
        extValues.put(OperationTaskSessionService.EXT_OPERATION_TYPE, source.getSourceType());
        extValues.put(OperationTaskSessionService.EXT_CONFIG, StringUtils.defaultString(source.getConfig(), "{}"));
        extValues.put(OperationTaskSessionService.EXT_AGENT_SELECTION, "[]");
        extValues.put(OperationTaskSessionService.EXT_WORKFLOW, "[]");
        extValues.put(OperationTaskSessionService.EXT_TRIGGER_TIME, formatDateTime(now));
        operationTaskSessionService.saveTaskExtensions(session.getSessionId(), extValues);
        scanSourceService.updateLastScanTime(source.getSourceId());
        log.info("[OperationSchedule] 已创建运营任务会话，sourceId={}, sessionId={}", source.getSourceId(),
            session.getSessionId());
    }

    /**
     * 模板页面已显式选择项目绑定数字员工时优先使用 agentIds，不再校验负责人是否绑定数字员工。 仅兼容未提交 agentIds 的历史调用时，才按 assigneeIds 查询成员绑定关系。
     */
    private List<Long> resolveOperationTaskAgentIds(OperationTaskDTO dto, Long projectId) {
        LinkedHashSet<Long> explicitAgentIds = new LinkedHashSet<>();
        if (dto.getAgentIds() != null) {
            for (Long agentId : dto.getAgentIds()) {
                if (agentId != null) {
                    explicitAgentIds.add(agentId);
                }
            }
        }
        if (!explicitAgentIds.isEmpty()) {
            return new ArrayList<>(explicitAgentIds);
        }

        if (dto.getAssigneeIds() != null) {
            LinkedHashSet<Long> assigneeIds = new LinkedHashSet<>();
            for (Long assigneeId : dto.getAssigneeIds()) {
                if (assigneeId != null) {
                    assigneeIds.add(assigneeId);
                }
            }
            if (assigneeIds.isEmpty()) {
                return Collections.emptyList();
            }
            Map<Long, Long> agentIdByAssignee = new HashMap<>();
            for (ProjectMember member : projectMemberService.listByProjectId(projectId)) {
                if (member.getUserId() != null && member.getAgentId() != null) {
                    agentIdByAssignee.put(member.getUserId(), member.getAgentId());
                }
            }
            LinkedHashSet<Long> agentIds = new LinkedHashSet<>();
            for (Long assigneeId : assigneeIds) {
                Long agentId = agentIdByAssignee.get(assigneeId);
                if (agentId == null) {
                    // 任一承接成员尚未绑定员工时整体拒绝，避免拆分任务只被部分员工执行。
                    return Collections.emptyList();
                }
                agentIds.add(agentId);
            }
            return new ArrayList<>(agentIds);
        }

        return Collections.emptyList();
    }

    /** 将承接成员绑定的数字员工转换为聊天资源，首条任务消息会以 @员工 的形式引用这些资源。 */
    private List<ResourceVo> buildOperationTaskAgentResources(List<Long> agentIds) {
        List<ResourceVo> resources = new ArrayList<>();
        for (Long agentId : agentIds) {
            SsResource agent = ssResourceMapper.selectByResourceId(agentId);
            ResourceVo resource = new ResourceVo();
            resource.setId("DIG_EMPLOYEE_" + agentId);
            resource.setResourceId(String.valueOf(agentId));
            resource.setResourceName(
                agent != null && StringUtils.isNotBlank(agent.getResourceName()) ? agent.getResourceName()
                    : String.valueOf(agentId));
            resource.setResourceCode(agent == null ? null : agent.getResourceCode());
            resource.setResourceType(AgentMetaEnum.DIG_EMPLOYEE);
            resources.add(resource);
        }
        return resources;
    }

    /** 多承接成员使用聊天系统的并行泳道参数，确保每个被 @ 的数字员工都收到同一条运营任务指令。 */
    private Map<String, Object> buildOperationTaskMultiAgentExtParams(Long taskId, List<Long> agentIds) {
        Map<String, Object> extParams = new HashMap<>();
        Map<String, Object> multiAgent = new HashMap<>();
        String turnId = "operation-task-" + taskId + "-" + UUID.randomUUID();
        multiAgent.put("turnId", turnId);
        multiAgent.put("mode", "parallel");
        List<Map<String, Object>> lanes = new ArrayList<>();
        for (int index = 0; index < agentIds.size(); index++) {
            Long agentId = agentIds.get(index);
            Map<String, Object> lane = new HashMap<>();
            lane.put("laneId", turnId + "-agent-" + agentId);
            lane.put("clientRequestId", turnId + "-lane-" + index);
            lane.put("agentId", agentId);
            lane.put("order", index);
            lanes.add(lane);
        }
        multiAgent.put("lanes", lanes);
        extParams.put(MultiAgentMetadata.EXT_KEY_CAMEL, multiAgent);
        return extParams;
    }

    /** 运营任务使用会话扩展参数，避免运营指令变更影响研发任务的启动流程。 */
    private String buildOperationTaskPrompt(ByaiSession session, Map<String, String> taskExt,
        List<ResourceVo> mentionedAgents) {
        String operationType = taskExt.get(OperationTaskSessionService.EXT_OPERATION_TYPE);
        String operationTypeLabel = switch (operationType == null ? "" : operationType) {
            case "collect" -> I18nUtil.get("devloop.operationTask.type.collect");
            case "knowledge" -> I18nUtil.get("devloop.operationTask.type.knowledge");
            case "publish", "content" -> I18nUtil.get("devloop.operationTask.type.publish");
            case "analyze" -> I18nUtil.get("devloop.operationTask.type.analyze");
            default -> I18nUtil.get("devloop.operationTask.type.default");
        };
        String mentions = mentionedAgents.stream().map(agent -> "{{" + agent.getId() + "}}")
            .collect(java.util.stream.Collectors.joining(" "));
        Project project = projectMapper.selectById(session.getProjectId());
        String projectName = project == null ? "" : StringUtils.defaultString(project.getProjectName());
        String prompt = buildOperationTaskStartPrompt(session, taskExt, projectName, operationTypeLabel);
        return StringUtils.isBlank(mentions) ? prompt : mentions + "\n" + prompt;
    }

    /**
     * 构造运营任务启动提示词：按需求类型读取独立模板，缺失时使用对应类型的内置模板。 提示词仅替换运营项目实际拥有的任务字段，避免代码仓库、分支等研发字段误导运营数字员工。
     */
    private String buildOperationTaskStartPrompt(ByaiSession session, Map<String, String> taskExt, String projectName,
        String taskType) {
        String operationType = taskExt.get(OperationTaskSessionService.EXT_OPERATION_TYPE);
        String promptConfigCode = getOperationTaskPromptConfigCode(operationType);
        // 未识别的历史类型没有专属参数码，直接使用国际化默认模板，避免查询已废弃的通用配置。
        // 运营提示词与研发提示词统一从 byai_ai_prompt 读取，并按当前语言选择模板。
        String template = StringUtils.isBlank(promptConfigCode) ? null
            : aiPromptService.findTemplateByCode(promptConfigCode, getCurrentRequestLanguage());
        // 数据库可能仍保留旧版“采集渠道/账号/主题”模板；识别到旧占位符时直接切换新版内置模板，
        // 避免未执行增量 SQL 的环境继续把已废弃字段发送到首条任务对话中。
        if ("collect".equals(operationType) && StringUtils.isNotBlank(template)
            && (template.contains("${collectChannel}") || template.contains("${collectAccount}")
                || template.contains("${collectTopic}"))) {
            template = null;
        }
        if (StringUtils.isBlank(template)) {
            template = I18nUtil.get(getOperationTaskPromptDefaultMessageCode(operationType));
        }
        // 三类运营任务的配置字段分别替换到模板中，避免将 JSON 原文直接交给数字员工理解。
        Map<String, Object> operationConfigMap = parseOperationConfig(
            taskExt.get(OperationTaskSessionService.EXT_CONFIG));
        // 模板正文统一从 byai_ai_prompt 读取，任务模板表只保存默认配置；这样数据库更新模板后，
        // 已创建的待执行任务也会按照最新提示词结构渲染，而不会被历史 templatePrompt 覆盖。
        ScanSource requirement = findOperationSource(operationTaskSessionService.getSourceId(session.getSessionId()));
        String requirementName = requirement == null ? StringUtils.defaultString(session.getSessionName())
            : StringUtils.defaultString(requirement.getSourceName());
        String requirementDescription = requirement == null ? taskExt.get(OperationTaskSessionService.EXT_DESCRIPTION)
            : StringUtils.defaultString(requirement.getSourceDescription());
        String sourceModeValue = "knowledge".equalsIgnoreCase(operationType)
            ? getOperationKnowledgeOrganizationValue(operationConfigMap, "sourceOntology", "sourceMode")
            : getOperationSourceModeLabel(findOperationConfigValue(operationConfigMap, "sourceMode"));
        String storageModeValue = "knowledge".equalsIgnoreCase(operationType)
            ? getOperationKnowledgeOrganizationValue(operationConfigMap, "ontology", "storageMode")
            : getOperationStorageModeLabel(findOperationConfigValue(operationConfigMap, "storageMode"));
        return template.replace("${projectName}", StringUtils.defaultString(projectName))
            .replace("${taskType}", StringUtils.defaultString(taskType))
            .replace("${title}", StringUtils.defaultString(session.getSessionName()))
            .replace("${description}",
                StringUtils.defaultString(taskExt.get(OperationTaskSessionService.EXT_DESCRIPTION)))
            .replace("${requirementName}", requirementName).replace("${requirementDescription}", requirementDescription)
            .replace("${assigneeName}",
                StringUtils.defaultString(
                    resolveUserName(parseOperationLong(taskExt.get(OperationTaskSessionService.EXT_ASSIGNEE_ID)))))
            .replace("${dueTime}", StringUtils.defaultString(taskExt.get(OperationTaskSessionService.EXT_DUE_TIME)))
            .replace("${sourceMode}", sourceModeValue)
            .replace("${sourceValue}", getOperationCollectionSource(operationConfigMap))
            .replace("${storageMode}", storageModeValue)
            .replace("${storageTarget}", getOperationStorageTarget(operationConfigMap))
            .replace("${runMode}",
                getOperationRunModeLabel(
                    findOperationConfigValue(operationConfigMap, "runMode", "mode", "collectMethod")))
            .replace("${executionTime}", getOperationCollectionSchedule(operationConfigMap))
            .replace("${knowledgeBase}",
                resolveOperationResourceName(findOperationConfigValue(operationConfigMap, "knowledgeBaseId",
                    "knowledgeBaseId", "sourceKnowledge", "targetKnowledge")))
            .replace("${directory}",
                resolveOperationResourceName(
                    findOperationConfigValue(operationConfigMap, "directoryId", "directory", "kbDirectory")))
            .replace("${collectChannel}",
                getOperationChannelLabel(findOperationConfigValue(operationConfigMap, "channel", "collectSource")))
            .replace("${collectAccount}",
                resolveOperationAccountName(
                    findOperationConfigValue(operationConfigMap, "accountOrAddress", "collectAccount")))
            .replace("${collectTopic}", getOperationPromptValue(operationConfigMap, "topic", "collectTopic"))
            .replace("${collectStartTime}",
                getOperationPromptValue(operationConfigMap, "onceTime", "effectiveStartDate", "startTime",
                    "collectStart"))
            .replace("${collectEndTime}",
                getOperationPromptValue(operationConfigMap, "effectiveEndDate", "endTime", "collectEnd"))
            .replace("${collectMethod}",
                getOperationRunModeLabel(
                    findOperationConfigValue(operationConfigMap, "runMode", "mode", "collectMethod")))
            .replace("${collectSchedule}", getOperationCollectionSchedule(operationConfigMap))
            .replace("${collectOrganize}",
                getOperationPromptBoolean(
                    findOperationConfigValue(operationConfigMap, "organize", "knowledgeOrganize", "storageMode")))
            .replace("${collectOntology}",
                getOperationKnowledgeOrganizationValue(operationConfigMap, "templateName", "templateId",
                    "organizeTemplateId", "ontology"))
            .replace("${collectOrganizationRequest}",
                getOperationKnowledgeOrganizationValue(operationConfigMap, "request"))
            .replace("${collectOrganizationStructure}",
                getOperationKnowledgeOrganizationValue(operationConfigMap, "structure"))
            .replace("${contentType}", getOperationPromptValue(operationConfigMap, "contentType"))
            .replace("${publishChannel}", getOperationChannelLabel(operationConfigMap.get("publishChannel")))
            .replace("${publishAccount}",
                resolveOperationAccountName(findOperationConfigValue(operationConfigMap, "publishAccountId")))
            .replace("${publishTopic}", getOperationPromptValue(operationConfigMap, "topic", "publishTopic"))
            .replace("${publishSchedule}", getOperationPromptValue(operationConfigMap, "publishSchedule"))
            .replace("${analysisPlatform}",
                getOperationChannelLabel(findOperationConfigValue(operationConfigMap, "platformId", "analysisChannel")))
            .replace("${analysisAccount}",
                resolveOperationAccountName(
                    findOperationConfigValue(operationConfigMap, "accountId", "analysisAccountId")))
            .replace("${analysisScope}", getOperationPromptValue(operationConfigMap, "scope", "analysisType"))
            .replace("${analysisWorks}",
                getOperationPromptValue(operationConfigMap, "workIds", "selectedWorks", "selectedWorkIds"))
            // 兼容历史数据库模板，避免把未识别的配置占位符原样发送给数字员工。
            .replace("${collectConfig}", JSON.toJSONString(operationConfigMap))
            .replace("${operationConfig}", JSON.toJSONString(operationConfigMap));
    }

    /** 运营需求类型与启动提示词参数一一对应；content 是发布类型的历史兼容值。 */
    private String getOperationTaskPromptConfigCode(String operationType) {
        return switch (operationType == null ? "" : operationType) {
            case "collect" -> "OPLOOP_TASK_START_PROMPT_COLLECT";
            case "knowledge" -> "OPLOOP_TASK_START_PROMPT_KNOWLEDGE";
            case "publish", "content" -> "OPLOOP_TASK_START_PROMPT_PUBLISH";
            case "analyze" -> "OPLOOP_TASK_START_PROMPT_ANALYZE";
            // 未识别类型使用国际化默认模板，不再依赖已废弃的通用参数码。
            default -> null;
        };
    }

    /** 数据库未配置对应提示词时使用同类型国际化默认模板。 */
    private String getOperationTaskPromptDefaultMessageCode(String operationType) {
        return switch (operationType == null ? "" : operationType) {
            case "collect" -> "devloop.operationTask.prompt.collect.default";
            case "knowledge" -> "devloop.operationTask.prompt.knowledge.default";
            case "publish", "content" -> "devloop.operationTask.prompt.publish.default";
            case "analyze" -> "devloop.operationTask.prompt.analyze.default";
            default -> "devloop.operationTask.prompt.default";
        };
    }

    /** 按字段优先级读取运营配置，兼容接口迭代中保留的旧字段名。 */
    private Object findOperationConfigValue(Map<String, Object> operationConfig, String... fieldNames) {
        for (String fieldName : fieldNames) {
            Object value = operationConfig.get(fieldName);
            if (value != null && StringUtils.isNotBlank(String.valueOf(value))) {
                return value;
            }
        }
        return null;
    }

    /** 将运营配置的空值统一替换为国际化的“未配置”，避免提示词遗留空占位内容。 */
    private String getOperationPromptValue(Map<String, Object> operationConfig, String... fieldNames) {
        return getOperationPromptValue(findOperationConfigValue(operationConfig, fieldNames));
    }

    private String getOperationPromptValue(Object value) {
        if (value == null) {
            return I18nUtil.get("devloop.operationTask.prompt.notConfigured");
        }
        // 本体支持多选：提示词按名称/编码拼接，避免把整个数组或 Map 字符串塞进 prompt。
        if (value instanceof Collection<?> collection) {
            List<String> labels = new ArrayList<>();
            for (Object item : collection) {
                String label = getOperationPromptValue(item);
                if (StringUtils.isNotBlank(label)
                    && !I18nUtil.get("devloop.operationTask.prompt.notConfigured").equals(label)) {
                    labels.add(label);
                }
            }
            return labels.isEmpty() ? I18nUtil.get("devloop.operationTask.prompt.notConfigured")
                : String.join("、", labels);
        }
        if (value instanceof Map<?, ?> map) {
            Object objectName = map.get("objectName");
            if (objectName != null && StringUtils.isNotBlank(String.valueOf(objectName))) {
                return String.valueOf(objectName);
            }
            Object objectCode = map.get("objectCode");
            if (objectCode != null && StringUtils.isNotBlank(String.valueOf(objectCode))) {
                return String.valueOf(objectCode);
            }
        }
        return StringUtils.isBlank(String.valueOf(value)) ? I18nUtil.get("devloop.operationTask.prompt.notConfigured")
            : String.valueOf(value);
    }

    /** 将新版任务模板的采集来源类型转换为可读文案。 */
    private String getOperationSourceModeLabel(Object value) {
        if (value == null || StringUtils.isBlank(String.valueOf(value))) {
            return I18nUtil.get("devloop.operationTask.prompt.notConfigured");
        }
        return switch (String.valueOf(value).trim().toLowerCase(Locale.ROOT)) {
            case "connector" -> I18nUtil.get("devloop.operationTask.sourceMode.connector");
            case "internet" -> I18nUtil.get("devloop.operationTask.sourceMode.internet");
            case "knowledge" -> I18nUtil.get("devloop.operationTask.sourceMode.knowledge");
            default -> String.valueOf(value);
        };
    }

    /** 按采集方式读取对应来源字段，知识库来源优先解析资源名称。 */
    private String getOperationCollectionSource(Map<String, Object> config) {
        String sourceMode = StringUtils.defaultString(getOperationConfigText(config, "sourceMode"));
        return switch (sourceMode.toLowerCase(Locale.ROOT)) {
            case "connector" -> getOperationPromptValue(config, "connector");
            case "internet" -> getOperationPromptValue(config, "internetScope");
            case "knowledge" -> resolveOperationResourceName(findOperationConfigValue(config, "sourceKnowledge"));
            // 历史配置没有 sourceMode 时继续读取旧来源字段，避免已有任务丢失信息。
            default -> getOperationPromptValue(config, "connector", "internetScope", "sourceKnowledge", "collectSource",
                "channel");
        };
    }

    /** 将新版任务模板的入库方式转换为可读文案。 */
    private String getOperationStorageModeLabel(Object value) {
        if (value == null || StringUtils.isBlank(String.valueOf(value))) {
            return I18nUtil.get("devloop.operationTask.prompt.notConfigured");
        }
        return switch (String.valueOf(value).trim().toLowerCase(Locale.ROOT)) {
            case "ontology" -> I18nUtil.get("devloop.operationTask.storageMode.ontology");
            case "knowledge" -> I18nUtil.get("devloop.operationTask.storageMode.knowledge");
            default -> String.valueOf(value);
        };
    }

    /** 入库位置跟随入库方式读取本体或目标知识库，不再使用旧版“知识整理”字段。 */
    private String getOperationStorageTarget(Map<String, Object> config) {
        String storageMode = StringUtils.defaultString(getOperationConfigText(config, "storageMode"));
        if ("ontology".equalsIgnoreCase(storageMode)) {
            return getOperationKnowledgeOrganizationValue(config, "ontology");
        }
        if ("knowledge".equalsIgnoreCase(storageMode)) {
            return resolveOperationResourceName(findOperationConfigValue(config, "targetKnowledge"));
        }
        return getOperationPromptValue(config, "ontology", "targetKnowledge", "knowledgeBaseId");
    }

    /** 将执行方式的内部编码转换为当前语言文案，避免把 once、periodic 等前端枚举直接发送给数字员工。 */
    private String getOperationRunModeLabel(Object value) {
        if (value == null || StringUtils.isBlank(String.valueOf(value))) {
            return I18nUtil.get("devloop.operationTask.prompt.notConfigured");
        }
        return switch (String.valueOf(value).trim().toLowerCase(Locale.ROOT)) {
            case "once" -> I18nUtil.get("devloop.operationTask.runMode.once");
            case "interval" -> I18nUtil.get("devloop.operationTask.runMode.interval");
            case "periodic" -> I18nUtil.get("devloop.operationTask.runMode.periodic");
            // 兼容历史数据中的自定义执行方式，无法映射时保留原始文案。
            default -> String.valueOf(value);
        };
    }

    /** 采集调度转换为可读文案：单次展示时间，间隔展示小时数，周期展示周期类型、日期和时间。 */
    private String getOperationCollectionSchedule(Map<String, Object> config) {
        String mode = String.valueOf(findOperationConfigValue(config, "runMode", "mode", "collectMethod"));
        if ("once".equalsIgnoreCase(mode)) {
            return getOperationPromptValue(config, "onceTime", "startTime", "collectStart");
        }
        if ("interval".equalsIgnoreCase(mode)) {
            Object interval = findOperationConfigValue(config, "intervalHours", "intervalValue", "interval");
            Object unit = findOperationConfigValue(config, "intervalUnit", "unit");
            if (interval == null) {
                return I18nUtil.get("devloop.operationTask.prompt.notConfigured");
            }
            String unitLabel = config.containsKey("intervalHours") || "hour".equalsIgnoreCase(String.valueOf(unit))
                ? I18nUtil.get("devloop.operationTask.intervalUnit.hour")
                : I18nUtil.get("devloop.operationTask.intervalUnit.minute");
            String weekdays = getOperationPromptList(config.get("intervalWeekdays"));
            return interval + " " + unitLabel + (StringUtils.isBlank(weekdays) ? "" : " / " + weekdays);
        }
        if ("periodic".equalsIgnoreCase(mode)) {
            String periodType = StringUtils.defaultString(getOperationConfigText(config, "periodType"));
            String periodTypeLabel = switch (periodType.toLowerCase(Locale.ROOT)) {
                case "daily" -> I18nUtil.get("devloop.operationTask.periodType.daily");
                case "weekly" -> I18nUtil.get("devloop.operationTask.periodType.weekly");
                case "biweekly" -> I18nUtil.get("devloop.operationTask.periodType.biweekly");
                case "monthly" -> I18nUtil.get("devloop.operationTask.periodType.monthly");
                case "yearly" -> I18nUtil.get("devloop.operationTask.periodType.yearly");
                default -> periodType;
            };
            Object dateOrTime = "yearly".equalsIgnoreCase(periodType)
                ? findOperationConfigValue(config, "periodYearDateTime")
                : findOperationConfigValue(config, "periodTime");
            Object days = "monthly".equalsIgnoreCase(periodType) ? config.get("periodMonthDays")
                : config.get("periodWeekdays");
            String dayText = getOperationPromptList(days);
            String schedule = Stream.of(periodTypeLabel, dayText, getOperationPromptValue(dateOrTime))
                .filter(StringUtils::isNotBlank)
                .filter(value -> !I18nUtil.get("devloop.operationTask.prompt.notConfigured").equals(value))
                .collect(java.util.stream.Collectors.joining(" / "));
            return StringUtils.isBlank(schedule) ? I18nUtil.get("devloop.operationTask.prompt.notConfigured")
                : schedule;
        }
        return getOperationPromptValue(config, "cronExpr", "schedule", "collectSchedule");
    }

    /** 调度多选值使用稳定的逗号分隔格式展示，避免数组的 Java 对象文本进入提示词。 */
    private String getOperationPromptList(Object value) {
        if (!(value instanceof Collection<?> collection) || collection.isEmpty()) {
            return "";
        }
        return collection.stream().map(String::valueOf).collect(java.util.stream.Collectors.joining(","));
    }

    /** 将运营平台内部编码转换为当前语言文案，避免 WeChatAccount 等枚举直接写入运营提示词。 */
    private String getOperationChannelLabel(Object value) {
        if (value == null || StringUtils.isBlank(String.valueOf(value))) {
            return I18nUtil.get("devloop.operationTask.prompt.notConfigured");
        }
        String channelCode = String.valueOf(value).trim();
        return switch (channelCode.toLowerCase(Locale.ROOT)) {
            case "wechataccount", "wechat", "wechatofficialaccount" ->
                I18nUtil.get("devloop.operationTask.channel.wechat");
            case "xiaohongshu", "rednote" -> I18nUtil.get("devloop.operationTask.channel.xiaohongshu");
            case "wechatchannels", "wechatvideo", "video" -> I18nUtil.get("devloop.operationTask.channel.video");
            case "douyin" -> I18nUtil.get("devloop.operationTask.channel.douyin");
            case "internet" -> I18nUtil.get("devloop.operationTask.channel.internet");
            case "github" -> I18nUtil.get("devloop.operationTask.channel.github");
            // 兼容后续新增平台，未配置映射时保留原始编码，避免提示词信息丢失。
            default -> channelCode;
        };
    }

    /** 知识整理开关使用可读文案，避免把 true/false 直接输出到运营提示词。 */
    private String getOperationPromptBoolean(Object value) {
        if (value == null || StringUtils.isBlank(String.valueOf(value))) {
            return I18nUtil.get("devloop.operationTask.prompt.notConfigured");
        }
        // 模板表单使用 storageMode=knowledge/ontology 表示是否进行知识整理，兼容该结构化字段。
        if ("knowledge".equalsIgnoreCase(String.valueOf(value))) {
            return I18nUtil.get("devloop.operationTask.prompt.enabled");
        }
        if ("ontology".equalsIgnoreCase(String.valueOf(value))) {
            return I18nUtil.get("devloop.operationTask.prompt.disabled");
        }
        return Boolean.parseBoolean(String.valueOf(value)) ? I18nUtil.get("devloop.operationTask.prompt.enabled")
            : I18nUtil.get("devloop.operationTask.prompt.disabled");
    }

    /** 从整理配置中读取本体、整理要求和结构化要求；历史数据仅有 organizeTemplateId 时也可回显本体标识。 */
    @SuppressWarnings("unchecked")
    private String getOperationKnowledgeOrganizationValue(Map<String, Object> operationConfig, String... fieldNames) {
        Object organization = operationConfig.get("knowledgeOrganization");
        Map<String, Object> organizationConfig = organization instanceof Map ? (Map<String, Object>) organization
            : parseOperationConfig(organization == null ? null : String.valueOf(organization));
        Object value = findOperationConfigValue(organizationConfig, fieldNames);
        if (value == null && Arrays.asList(fieldNames).contains("organizeTemplateId")) {
            value = operationConfig.get("organizeTemplateId");
        }
        // 任务模板把 ontology 放在 config 顶层，优先读取完整对象（支持多选数组）。
        if (value == null && (Arrays.asList(fieldNames).contains("ontology")
            || Arrays.asList(fieldNames).contains("sourceOntology"))) {
            value = operationConfig
                .get(Arrays.asList(fieldNames).contains("sourceOntology") ? "sourceOntology" : "ontology");
        }
        return getOperationPromptValue(value);
    }

    /** 运营账号在提示词中优先显示账号名称，查询不到时保留原始标识以兼容历史配置。 */
    private String resolveOperationAccountName(Object accountId) {
        if (accountId == null || StringUtils.isBlank(String.valueOf(accountId))) {
            return I18nUtil.get("devloop.operationTask.prompt.notConfigured");
        }
        try {
            OperationAccount account = operationAccountService.findById(Long.valueOf(String.valueOf(accountId)));
            if (account != null && StringUtils.isNotBlank(account.getAccountName())) {
                return account.getAccountName();
            }
        }
        catch (NumberFormatException exception) {
            // 非数字配置可能是互联网地址等直接输入值，按原值下发给数字员工。
        }
        return String.valueOf(accountId);
    }

    /** 采集知识库和目录优先展示资源名称；历史配置只有资源 ID 时保留原值，便于数字员工定位配置。 */
    private String resolveOperationResourceName(Object resourceId) {
        if (resourceId == null || StringUtils.isBlank(String.valueOf(resourceId))) {
            return I18nUtil.get("devloop.operationTask.prompt.notConfigured");
        }
        try {
            SsResource resource = ssResourceMapper.selectByResourceId(Long.valueOf(String.valueOf(resourceId)));
            if (resource != null && StringUtils.isNotBlank(resource.getResourceName())) {
                return resource.getResourceName();
            }
        }
        catch (NumberFormatException exception) {
            // 非数字资源标识按原值下发，兼容目录接口可能返回的路径型历史数据。
        }
        return String.valueOf(resourceId);
    }

    /** 创建运营账号，账号仅能归属运营项目。 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Map<String, Object>> createOperationAccount(OperationAccountDTO dto) {
        String accessError = validateOperationProjectAccess(dto == null ? null : dto.getProjectId());
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        String validationError = validateOperationAccount(dto, false);
        if (validationError != null) {
            return ResponseUtil.failRes(validationError);
        }
        OperationAccount account = new OperationAccount();
        applyOperationAccountDto(account, dto);
        account.setCreateBy(CurrentUserHolder.getCurrentUserId());
        OperationAccount created = operationAccountService.create(account);
        Map<String, Object> result = new HashMap<>();
        result.put("accountId", created.getAccountId());
        return ResponseUtil.successResponse(result);
    }

    /** 编辑运营账号，项目归属由已有账号反查，避免请求跨项目修改。 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> updateOperationAccount(OperationAccountDTO dto) {
        String validationError = validateOperationAccount(dto, true);
        if (validationError != null) {
            return ResponseUtil.failRes(validationError);
        }
        OperationAccount existing = operationAccountService.findById(dto.getAccountId());
        if (existing == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationAccount.notFound"));
        }
        String accessError = validateOperationProjectAccess(existing.getProjectId());
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        OperationAccount update = new OperationAccount();
        update.setAccountId(existing.getAccountId());
        applyOperationAccountDto(update, dto);
        update.setProjectId(null);
        if (!StringUtils.equals(existing.getPlatformCode(), update.getPlatformCode())
            || !StringUtils.equals(existing.getAccountCode(), update.getAccountCode())) {
            // 平台或平台账号发生变化后，旧沙箱登录态不能继续代表新账号，需恢复为未登录状态。
            JSONObject config = parseOperationAccountConfig(existing.getConfig());
            config.remove("browserSessionId");
            config.remove("browserSandboxId");
            config.remove("browserLoginConfirmedAt");
            update.setConfig(config.toJSONString());
            update.setLoginStatus("offline");
        }
        update.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        operationAccountService.update(update);
        return ResponseUtil.successResponse(null);
    }

    /** 软删除运营账号，历史需求和任务中的账号标识继续保留用于审计追溯。 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> deleteOperationAccount(Long accountId) {
        if (accountId == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationAccount.id.required"));
        }
        OperationAccount existing = operationAccountService.findById(accountId);
        if (existing == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationAccount.notFound"));
        }
        String accessError = validateOperationProjectAccess(existing.getProjectId());
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        operationAccountService.delete(accountId, CurrentUserHolder.getCurrentUserId());
        return ResponseUtil.successResponse(null);
    }

    /** 查询运营项目账号，返回格式与账号管理面板保持一致。 */
    public ResponseUtil<List<Map<String, Object>>> listOperationAccounts(Long projectId) {
        String accessError = validateOperationProjectAccess(projectId);
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (OperationAccount account : operationAccountService.listByProjectId(projectId)) {
            result.add(toOperationAccountMap(account));
        }
        return ResponseUtil.successResponse(result);
    }

    /** 校验采集沙箱属于当前用户，成功后回写对应平台账号状态。 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Map<String, Object>> loginOperationAccount(Long accountId, String sandboxId) {
        if (accountId == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationAccount.id.required"));
        }
        if (StringUtils.isBlank(sandboxId)) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationAccount.browser.sandbox.required"));
        }
        OperationAccount account = operationAccountService.findById(accountId);
        if (account == null) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationAccount.notFound"));
        }
        String accessError = validateOperationProjectAccess(account.getProjectId());
        if (accessError != null) {
            return ResponseUtil.failRes(accessError);
        }
        String currentUserCode = CurrentUserHolder.getCurrentUserCode();
        List<SsSandboxRecord> runningSandboxes = StringUtils.isNotBlank(currentUserCode)
            ? sandboxRecordMapper.selectRunningByUser(currentUserCode)
            : List.of();
        boolean ownedRunningSandbox = runningSandboxes != null && runningSandboxes.stream()
            .anyMatch(record -> StringUtils.equals(record.getSandboxId(), sandboxId.trim()));
        if (!ownedRunningSandbox) {
            log.warn("[OperationAccount] 账号登录沙箱校验失败，accountId={}，sandboxId={}，userCode={}", accountId, sandboxId,
                currentUserCode);
            return ResponseUtil.failRes(I18nUtil.get("devloop.operationAccount.browser.sandbox.invalid"));
        }

        OperationAccount update = new OperationAccount();
        update.setAccountId(accountId);
        update.setStatus("connected");
        update.setLoginStatus("online");
        update.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        JSONObject config = parseOperationAccountConfig(account.getConfig());
        // 保存当前用户沙箱引用，后续 UI Agent 执行发布任务时复用同一份浏览器登录态。
        config.remove("browserSessionId");
        config.put("browserSandboxId", sandboxId.trim());
        config.put("browserLoginConfirmedAt", System.currentTimeMillis());
        update.setConfig(config.toJSONString());
        operationAccountService.update(update);

        Map<String, Object> result = new HashMap<>();
        result.put("accountId", accountId);
        result.put("loginStatus", "online");
        return ResponseUtil.successResponse(result);
    }

    /** 校验项目存在、类型和当前成员访问权限。 */
    private String validateOperationProjectAccess(Long projectId) {
        if (projectId == null) {
            return I18nUtil.get("devloop.operationRequirement.projectId.required");
        }
        Project project = projectMapper.selectById(projectId);
        if (project == null || DELETE_FLAG_DELETED.equals(project.getDeleteFlag())) {
            return I18nUtil.get("project.not.found");
        }
        if (!"operation".equals(project.getProjectType())) {
            return I18nUtil.get("devloop.operationRequirement.project.type.invalid");
        }
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (currentUserId == null || (!currentUserId.equals(project.getCreateBy())
            && !projectMemberService.isMember(projectId, currentUserId))) {
            return I18nUtil.get("devloop.operationRequirement.member.required");
        }
        return null;
    }

    /** 删除需求和任务属于高风险操作，必须由当前业务记录的创建人执行。 */
    private String validateEntityCreator(Long creatorId) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (creatorId == null || currentUserId == null || !currentUserId.equals(creatorId)) {
            return I18nUtil.get("devloop.entity.creator.delete.required");
        }
        return null;
    }

    /** 兼容早期运营需求未写 create_by 的数据，缺失时使用所属项目创建人作为历史创建人。 */
    private Long resolveOperationRequirementCreator(ScanSource requirement) {
        if (requirement == null) {
            return null;
        }
        Long creatorId = parseOperationLong(requirement.getCreateBy());
        if (creatorId != null) {
            return creatorId;
        }
        Project project = projectMapper.selectById(requirement.getProjectId());
        return project == null ? null : project.getCreateBy();
    }

    /** 任务创建人缺失时依次回退关联需求创建人和项目创建人，列表权限与删除接口保持一致。 */
    private Long resolveOperationTaskCreator(ByaiSession task) {
        if (task == null) {
            return null;
        }
        if (task.getCreatorId() != null) {
            return task.getCreatorId();
        }
        ScanSource requirement = findOperationSource(operationTaskSessionService.getSourceId(task.getSessionId()));
        if (requirement != null) {
            return resolveOperationRequirementCreator(requirement);
        }
        Project project = projectMapper.selectById(task.getProjectId());
        return project == null ? null : project.getCreateBy();
    }

    /** 校验新增和编辑共用的基础字段；运营需求状态由关联会话实时推导。 */
    private String validateOperationRequirement(OperationRequirementDTO dto, boolean editing) {
        if (dto == null) {
            return I18nUtil.get("devloop.operationRequirement.parameter.required");
        }
        if (editing && dto.getItemId() == null) {
            return I18nUtil.get("devloop.operationRequirement.itemId.required");
        }
        if (StringUtils.isBlank(dto.getRequirementName())) {
            return I18nUtil.get("devloop.operationRequirement.title.required");
        }
        if (dto.getRequirementName().trim().length() > 500) {
            return I18nUtil.get("devloop.operationRequirement.title.length.invalid");
        }
        if (StringUtils.length(dto.getSourceDescription()) > OPERATION_REQUIREMENT_TEXT_MAX_LENGTH) {
            return I18nUtil.get("devloop.operationRequirement.description.length.invalid");
        }
        if (StringUtils.isBlank(dto.getOperationType())
            || !ScanSourceService.OPERATION_SOURCE_TYPES.contains(dto.getOperationType())) {
            return I18nUtil.get("devloop.operationRequirement.type.invalid");
        }
        if (ScanSourceService.OPERATION_SOURCE_TYPE_COLLECT.equals(dto.getOperationType())) {
            String collectTopic = getOperationConfigText(dto.getConfig(), "topic", "collectTopic");
            if (StringUtils.length(collectTopic) > OPERATION_REQUIREMENT_TEXT_MAX_LENGTH) {
                return I18nUtil.get("devloop.operationRequirement.collectTopic.length.invalid");
            }
            // 执行方式已迁移到任务模板详情；创建/编辑需求阶段允许只填写目标，
            // 只有旧客户端仍提交了调度字段时才继续校验旧版调度配置。
            if (hasOperationScheduleConfig(dto.getConfig())) {
                String scheduleError = validateOperationCollectionSchedule(dto.getConfig());
                if (scheduleError != null) {
                    return scheduleError;
                }
            }
        }
        return null;
    }

    /** 判断请求是否包含旧版采集调度字段，避免模板化需求被空调度配置拦截。 */
    private boolean hasOperationScheduleConfig(Map<String, Object> config) {
        if (config == null || config.isEmpty()) {
            return false;
        }
        return Stream
            .of("mode", "collectMethod", "cronExpr", "collectSchedule", "onceTime", "periodType", "periodWeekdays",
                "periodMonthDays", "periodMonth", "periodDay", "periodTime", "intervalHours", "intervalValue",
                "interval", "intervalWeekdays", "effectiveStartDate", "effectiveEndDate")
            .anyMatch(field -> config.get(field) != null && StringUtils.isNotBlank(String.valueOf(config.get(field))));
    }

    /** 校验运营需求拆解任务，负责人必须是项目创建者或已加入项目的成员。 */
    private String validateOperationTaskForStart(OperationTaskDTO dto, ScanSource requirement) {
        if (dto == null || StringUtils.isBlank(dto.getTitle())) {
            return I18nUtil.get("devloop.operationTask.title.required");
        }
        if (dto.getTemplateId() != null && operationTaskTemplateService.get(dto.getTemplateId()) == null) {
            return I18nUtil.get("devloop.operationTaskTemplate.notFound");
        }
        if (dto.getTitle().trim().length() > OPERATION_SESSION_NAME_MAX_LENGTH) {
            return I18nUtil.get("devloop.operationTask.title.length.invalid");
        }
        if (dto.getAssignee() == null) {
            return I18nUtil.get("devloop.operationTask.assignee.required");
        }
        Project project = projectMapper.selectById(requirement.getProjectId());
        if (project == null || (!dto.getAssignee().equals(project.getCreateBy())
            && !projectMemberService.isMember(requirement.getProjectId(), dto.getAssignee()))) {
            return I18nUtil.get("devloop.operationTask.assignee.invalid");
        }
        try {
            parseOperationDueTime(dto.getDueTime());
        }
        catch (IllegalArgumentException exception) {
            return I18nUtil.get("devloop.operationRequirement.dueTime.invalid");
        }
        return null;
    }

    /** 计划任务直接使用需求名称时也要遵循会话主表长度，避免定时任务写入超长会话标题。 */
    private String limitOperationSessionName(String name) {
        return StringUtils.substring(name, 0, OPERATION_SESSION_NAME_MAX_LENGTH);
    }

    /** 查询运营需求源；研发渠道和已删除记录即使 ID 存在也不能进入运营接口。 */
    private ScanSource findOperationSource(Long sourceId) {
        ScanSource source = sourceId == null ? null : scanSourceService.findById(sourceId);
        if (source == null || "1".equals(source.getDeleteFlag())
            || !ScanSourceService.OPERATION_SOURCE_TYPES.contains(source.getSourceType())) {
            return null;
        }
        return source;
    }

    /** 发布类型历史值 content 统一落库为 publish，其余类型按稳定枚举保存。 */
    private String normalizeOperationSourceType(String operationType) {
        return "content".equals(operationType) ? "publish" : operationType;
    }

    /** 从负责人当前项目成员关系读取已绑定数字员工，避免把缓存中的旧员工写入任务会话。 */
    private Long resolveAgentIdForAssignee(Long assigneeId, Long projectId) {
        if (assigneeId == null || projectId == null) {
            return null;
        }
        for (ProjectMember member : projectMemberService.listByProjectId(projectId)) {
            if (assigneeId.equals(member.getUserId())) {
                return member.getAgentId();
            }
        }
        return null;
    }

    /** 页面状态兼容映射到会话扩展表中的统一状态。 */
    private String normalizeOperationTaskStatus(String status) {
        return switch (StringUtils.defaultString(status).trim().toLowerCase(Locale.ROOT)) {
            case "todo", "pending" -> OperationTaskSessionService.STATUS_PENDING;
            case "doing", "running", "in_progress" -> OperationTaskSessionService.STATUS_RUNNING;
            case "done", "completed" -> OperationTaskSessionService.STATUS_DONE;
            case "failed", "error" -> OperationTaskSessionService.STATUS_FAILED;
            case "mixed" -> OperationTaskSessionService.STATUS_MIXED;
            default -> null;
        };
    }

    /** 使用后端生成的 Cron 覆盖请求值，保证 config 展示字段和 byai_scan_source.cron_expr 始终一致。 */
    private Map<String, Object> normalizeOperationScheduleConfig(Map<String, Object> config) {
        Map<String, Object> normalized = config == null ? new LinkedHashMap<>() : new LinkedHashMap<>(config);
        String cronExpr = resolveOperationCronExpr(normalized);
        if (StringUtils.isBlank(cronExpr)) {
            normalized.remove("cronExpr");
            normalized.remove("collectSchedule");
        }
        else {
            normalized.put("cronExpr", cronExpr);
            normalized.put("collectSchedule", cronExpr);
        }
        return normalized;
    }

    /** 校验资料采集的结构化调度配置，防止绕过前端后写入无法执行的 Cron。 */
    private String validateOperationCollectionSchedule(Map<String, Object> config) {
        try {
            String cronExpr = resolveOperationCronExpr(config);
            if (StringUtils.isBlank(cronExpr)) {
                return I18nUtil.get("devloop.operationRequirement.collectSchedule.invalid");
            }
            org.springframework.scheduling.support.CronExpression.parse(toSpringCron(cronExpr));
            String startDateText = getOperationConfigText(config, "effectiveStartDate");
            String endDateText = getOperationConfigText(config, "effectiveEndDate");
            LocalDate startDate = parseOperationScheduleDate(startDateText);
            LocalDate endDate = parseOperationScheduleDate(endDateText);
            if ((StringUtils.isNotBlank(startDateText) && startDate == null)
                || (StringUtils.isNotBlank(endDateText) && endDate == null)) {
                return I18nUtil.get("devloop.operationRequirement.effectiveDate.invalid");
            }
            if (startDate != null && endDate != null && startDate.isAfter(endDate)) {
                return I18nUtil.get("devloop.operationRequirement.effectiveDate.invalid");
            }
            return null;
        }
        catch (IllegalArgumentException exception) {
            return I18nUtil.get("devloop.operationRequirement.collectSchedule.invalid");
        }
    }

    /**
     * 根据三种采集方式生成标准五段 Cron 并写入扫描源。 单次的年份、每双周和生效区间无法只靠 Cron 表达，由 DevloopScanJob 结合 config 二次判断。
     */
    private String resolveOperationCronExpr(Map<String, Object> config) {
        if (config == null || config.isEmpty()) {
            return null;
        }
        String mode = String.valueOf(config.getOrDefault("mode", config.getOrDefault("collectMethod", "")));
        if (StringUtils.isBlank(mode)) {
            return null;
        }
        if ("once".equalsIgnoreCase(mode)) {
            LocalDateTime onceTime = parseOperationScheduleDateTime(
                getOperationConfigText(config, "onceTime", "startTime", "collectStart"));
            if (onceTime == null) {
                throw new IllegalArgumentException("onceTime");
            }
            return String.format(Locale.ROOT, "%d %d %d %d *", onceTime.getMinute(), onceTime.getHour(),
                onceTime.getDayOfMonth(), onceTime.getMonthValue());
        }
        if ("interval".equalsIgnoreCase(mode)) {
            int intervalHours = getOperationConfigInt(config, "intervalHours", 0);
            if (intervalHours < 1) {
                // 旧客户端仍可能提交 intervalValue 和 intervalUnit，统一向上换算为整小时。
                int legacyInterval = getOperationConfigInt(config, "intervalValue",
                    getOperationConfigInt(config, "interval", 0));
                String legacyUnit = getOperationConfigText(config, "intervalUnit", "unit");
                intervalHours = "minute".equalsIgnoreCase(legacyUnit) ? Math.max(1, (legacyInterval + 59) / 60)
                    : legacyInterval;
            }
            List<Integer> weekdays = getOperationConfigIntList(config.get("intervalWeekdays"), 1, 7);
            if (weekdays.isEmpty() && config.containsKey("intervalWeekdays")) {
                throw new IllegalArgumentException("intervalWeekdays");
            }
            if (weekdays.isEmpty()) {
                // 历史间隔配置没有星期字段时按每天执行；新表单始终提交明确的星期集合。
                weekdays = List.of(1, 2, 3, 4, 5, 6, 7);
            }
            if (intervalHours < 1) {
                throw new IllegalArgumentException("intervalHours");
            }
            // 超过 23 小时无法由标准 Cron 精确表达，cron_expr 保留每小时候选点，实际间隔由 last_scan_time 判断。
            String hourField = intervalHours <= 23 ? "*/" + intervalHours : "*";
            return "0 " + hourField + " * * " + joinOperationScheduleValues(weekdays);
        }
        if (!"periodic".equalsIgnoreCase(mode)) {
            throw new IllegalArgumentException("mode");
        }

        String periodType = getOperationConfigText(config, "periodType");
        if (StringUtils.isBlank(periodType)) {
            // 旧周期配置直接保存 Cron，新版结构化配置则由后端重新生成。
            Object cronValue = config.get("cronExpr");
            if (cronValue == null && config.get("schedule") instanceof Map<?, ?> schedule) {
                cronValue = schedule.get("cronExpr");
            }
            return cronValue == null ? null : StringUtils.trimToNull(String.valueOf(cronValue));
        }
        LocalTime periodTime = parseOperationScheduleTime(getOperationConfigText(config, "periodTime"));
        if (periodTime == null) {
            throw new IllegalArgumentException("periodTime");
        }
        String timePrefix = periodTime.getMinute() + " " + periodTime.getHour() + " ";
        return switch (periodType.toLowerCase(Locale.ROOT)) {
            case "daily" -> timePrefix + "* * *";
            case "weekly", "biweekly" -> {
                List<Integer> weekdays = getOperationConfigIntList(config.get("periodWeekdays"), 1, 7);
                if (weekdays.isEmpty()) {
                    throw new IllegalArgumentException("periodWeekdays");
                }
                yield timePrefix + "* * " + joinOperationScheduleValues(weekdays);
            }
            case "monthly" -> {
                List<Integer> monthDays = getOperationConfigIntList(config.get("periodMonthDays"), 1, 31);
                if (monthDays.isEmpty()) {
                    throw new IllegalArgumentException("periodMonthDays");
                }
                yield timePrefix + joinOperationScheduleValues(monthDays) + " * *";
            }
            case "yearly" -> {
                int month = getOperationConfigInt(config, "periodMonth", 0);
                int day = getOperationConfigInt(config, "periodDay", 0);
                if (month < 1 || month > 12 || day < 1 || day > YearMonth.of(2000, month).lengthOfMonth()) {
                    throw new IllegalArgumentException("periodDate");
                }
                yield timePrefix + day + " " + month + " *";
            }
            default -> throw new IllegalArgumentException("periodType");
        };
    }

    private String getOperationConfigText(Map<String, Object> config, String... fieldNames) {
        if (config == null) {
            return null;
        }
        for (String fieldName : fieldNames) {
            Object value = config.get(fieldName);
            if (value != null && StringUtils.isNotBlank(String.valueOf(value))) {
                return String.valueOf(value).trim();
            }
        }
        return null;
    }

    private int getOperationConfigInt(Map<String, Object> config, String fieldName, int fallback) {
        try {
            Object value = config == null ? null : config.get(fieldName);
            return value == null ? fallback : Integer.parseInt(String.valueOf(value));
        }
        catch (NumberFormatException exception) {
            return fallback;
        }
    }

    /** 数组字段去重并排序，保证生成的 Cron 稳定，便于配置比较和问题排查。 */
    private List<Integer> getOperationConfigIntList(Object value, int minimum, int maximum) {
        if (!(value instanceof Iterable<?> iterable)) {
            return Collections.emptyList();
        }
        TreeSet<Integer> values = new TreeSet<>();
        for (Object item : iterable) {
            try {
                int parsed = Integer.parseInt(String.valueOf(item));
                if (parsed < minimum || parsed > maximum) {
                    throw new IllegalArgumentException("scheduleValue");
                }
                values.add(parsed);
            }
            catch (NumberFormatException exception) {
                throw new IllegalArgumentException("scheduleValue", exception);
            }
        }
        return new ArrayList<>(values);
    }

    private String joinOperationScheduleValues(List<Integer> values) {
        return values.stream().map(String::valueOf).collect(java.util.stream.Collectors.joining(","));
    }

    private LocalDateTime parseOperationScheduleDateTime(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        for (DateTimeFormatter formatter : List.of(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"),
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))) {
            try {
                return LocalDateTime.parse(value, formatter);
            }
            catch (Exception ignored) {
                // 尝试下一个兼容格式。
            }
        }
        LocalDate date = parseOperationScheduleDate(value);
        return date == null ? null : date.atStartOfDay();
    }

    private LocalTime parseOperationScheduleTime(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        for (DateTimeFormatter formatter : List.of(DateTimeFormatter.ofPattern("HH:mm"),
            DateTimeFormatter.ofPattern("HH:mm:ss"))) {
            try {
                return LocalTime.parse(value, formatter);
            }
            catch (Exception ignored) {
                // 尝试下一个兼容格式。
            }
        }
        return null;
    }

    private LocalDate parseOperationScheduleDate(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        try {
            return LocalDate.parse(value, DateTimeFormatter.ofPattern("yyyy-MM-dd"));
        }
        catch (Exception exception) {
            return null;
        }
    }

    /** 扩展参数中的数字解析失败时返回空，损坏的历史数据不会阻断整个任务列表。 */
    private Long parseOperationLong(String value) {
        try {
            return StringUtils.isBlank(value) ? null : Long.valueOf(value);
        }
        catch (NumberFormatException exception) {
            return null;
        }
    }

    /** 校验运营账号新增和编辑的基础字段，平台登录凭据由 UI Agent 沙箱浏览器维护。 */
    private String validateOperationAccount(OperationAccountDTO dto, boolean editing) {
        if (dto == null) {
            return I18nUtil.get("devloop.operationAccount.parameter.required");
        }
        if (editing && dto.getAccountId() == null) {
            return I18nUtil.get("devloop.operationAccount.id.required");
        }
        if (StringUtils.isBlank(dto.getPlatformCode()) || StringUtils.isBlank(dto.getAccountCode())
            || StringUtils.isBlank(dto.getAccountName())) {
            return I18nUtil.get("devloop.operationAccount.field.required");
        }
        if (dto.getPlatformCode().trim().length() > 20 || dto.getAccountCode().trim().length() > 100
            || dto.getAccountName().trim().length() > 100) {
            return I18nUtil.get("devloop.operationAccount.field.length.invalid");
        }
        return null;
    }

    /** 将账号保存参数映射到实体，连接和登录状态由登录流程维护，不接受前端直接覆盖。 */
    private void applyOperationAccountDto(OperationAccount target, OperationAccountDTO dto) {
        target.setProjectId(dto.getProjectId());
        target.setPlatformCode(dto.getPlatformCode().trim());
        target.setAccountCode(dto.getAccountCode().trim());
        target.setAccountName(dto.getAccountName().trim());
    }

    /** 配置列可能包含历史空值或损坏 JSON，读取失败按空配置处理且不打印敏感内容。 */
    private JSONObject parseOperationAccountConfig(String config) {
        if (StringUtils.isBlank(config)) {
            return new JSONObject();
        }
        try {
            JSONObject result = JSON.parseObject(config);
            return result == null ? new JSONObject() : result;
        }
        catch (Exception exception) {
            log.warn("[OperationAccount] 账号配置解析失败，按空配置处理");
            return new JSONObject();
        }
    }

    /** 将前端标准时间字符串转换为数据库时间；空值表示未设置完成时间。 */
    private Date parseOperationDueTime(String dueTime) {
        String normalizedDueTime = StringUtils.trimToNull(dueTime);
        if (normalizedDueTime == null) {
            return null;
        }
        try {
            return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").parse(normalizedDueTime);
        }
        catch (java.text.ParseException exception) {
            throw new IllegalArgumentException(I18nUtil.get("devloop.operationRequirement.dueTime.invalid"), exception);
        }
    }

    /** 运营需求转前端任务卡片可直接消费的统一结构。 */
    private Map<String, Object> toOperationRequirementMap(ScanSource requirement) {
        Map<String, Object> result = new HashMap<>();
        boolean launched = operationTaskSessionService.existsBySourceId(requirement.getSourceId());
        result.put("taskId", requirement.getSourceId());
        result.put("itemId", requirement.getSourceId());
        result.put("sourceId", requirement.getSourceId());
        result.put("projectId", requirement.getProjectId());
        result.put("title", requirement.getSourceName());
        result.put("requirementName", requirement.getSourceName());
        result.put("description", requirement.getSourceDescription());
        result.put("sourceDescription", requirement.getSourceDescription());
        result.put("operationType", requirement.getSourceType());
        result.put("status", launched ? "launched" : "todo");
        result.put("assigneeId", requirement.getAssignee());
        result.put("assignee", resolveUserName(requirement.getAssignee()));
        result.put("dueTime", formatDateTime(requirement.getDueTime()));
        result.put("progress", launched ? 5 : 0);
        Long creatorId = resolveOperationRequirementCreator(requirement);
        result.put("createBy", creatorId);
        result.put("createByName", resolveUserName(creatorId));
        // 删除权限由服务端直接计算，避免前端因 ID 类型或精度差异误判创建人。
        result.put("canDelete", Objects.equals(creatorId, CurrentUserHolder.getCurrentUserId()));
        result.put("createTime", requirement.getCreateTime());
        result.put("cronExpr", requirement.getCronExpr());
        result.put("config", parseOperationConfig(requirement.getConfig()));
        return result;
    }

    /** 根据任务 ID 查询会话后转换，拆解事务内可直接复用该方法返回新建任务。 */
    private Map<String, Object> toOperationTaskMap(Long taskId) {
        return toOperationTaskMap(operationTaskSessionService.findById(taskId));
    }

    /** 运营任务会话转为前端任务列表和详情共用结构，待执行时隐藏 sessionId 避免前端提前进入空会话。 */
    private Map<String, Object> toOperationTaskMap(ByaiSession task) {
        if (task == null) {
            return Collections.emptyMap();
        }
        Map<String, String> ext = operationTaskSessionService.getExtValues(task.getSessionId());
        String storedStatus = ext.get(OperationTaskSessionService.EXT_STATUS);
        String status = switch (StringUtils.defaultString(storedStatus)) {
            case OperationTaskSessionService.STATUS_RUNNING -> "doing";
            case OperationTaskSessionService.STATUS_DONE -> "done";
            case OperationTaskSessionService.STATUS_FAILED -> "failed";
            case OperationTaskSessionService.STATUS_MIXED -> "mixed";
            default -> "todo";
        };
        Long assigneeId = parseOperationLong(ext.get(OperationTaskSessionService.EXT_ASSIGNEE_ID));
        Long sourceId = parseOperationLong(ext.get(OperationTaskSessionService.EXT_SOURCE_ID));
        Map<String, Object> result = new HashMap<>();
        result.put("taskId", task.getSessionId());
        result.put("requirementId", sourceId);
        result.put("sourceId", sourceId);
        result.put("projectId", task.getProjectId());
        result.put("title", task.getSessionName());
        result.put("description", ext.get(OperationTaskSessionService.EXT_DESCRIPTION));
        result.put("operationType", ext.get(OperationTaskSessionService.EXT_OPERATION_TYPE));
        result.put("status", status);
        result.put("assigneeId", assigneeId);
        result.put("assignee", resolveUserName(assigneeId));
        result.put("dueTime", ext.get(OperationTaskSessionService.EXT_DUE_TIME));
        result.put("progress", "done".equals(status) ? 100 : "doing".equals(status) ? 5 : 0);
        Long creatorId = resolveOperationTaskCreator(task);
        result.put("createBy", creatorId);
        result.put("canDelete", Objects.equals(creatorId, CurrentUserHolder.getCurrentUserId()));
        result.put("sessionId", "todo".equals(status) ? null : task.getSessionId());
        result.put("config", parseOperationConfig(ext.get(OperationTaskSessionService.EXT_CONFIG)));
        result.put("templateId", parseOperationLong(ext.get(OperationTaskSessionService.EXT_TEMPLATE_ID)));
        result.put("agentIds", parseOperationJsonArray(ext.get(OperationTaskSessionService.EXT_AGENT_SELECTION)));
        result.put("workflow", parseOperationJsonArray(ext.get(OperationTaskSessionService.EXT_WORKFLOW)));
        result.put("createTime", formatDateTime(task.getCreateTime()));
        return result;
    }

    /** 运营账号转为前端账号卡片使用的字段，指标JSON解析失败时按空对象返回。 */
    private Map<String, Object> toOperationAccountMap(OperationAccount account) {
        Map<String, Object> result = new HashMap<>();
        result.put("id", account.getAccountId());
        result.put("accountId", account.getAccountId());
        result.put("projectId", account.getProjectId());
        result.put("platformCode", account.getPlatformCode());
        result.put("accountCode", account.getAccountCode());
        result.put("accountName", account.getAccountName());
        result.put("loginStatus", account.getLoginStatus());
        result.put("status", account.getStatus());
        result.put("metrics", resolveOperationAccountMetrics(account));
        result.put("canEdit", true);
        return result;
    }

    /**
     * 读取账号卡片指标，兼容指标列和历史配置中的两种存储位置。 只提取展示所需字段，避免把账号配置中的沙箱标识等敏感信息返回给前端。
     */
    private Map<String, Object> resolveOperationAccountMetrics(OperationAccount account) {
        Map<String, Object> metrics = new HashMap<>();
        copyOperationAccountMetricFields(parseOperationConfig(account.getMetrics()), metrics);

        // 历史数据可能把静态概要直接放在 config，或嵌套在 config.metrics 中，统一补齐缺失指标。
        JSONObject config = parseOperationAccountConfig(account.getConfig());
        copyOperationAccountMetricFields(config, metrics);
        Object nestedMetrics = config.get("metrics");
        if (nestedMetrics instanceof Map<?, ?> nestedMetricMap) {
            copyOperationAccountMetricFields(nestedMetricMap, metrics);
        }
        normalizeOperationAccountMetricAliases(metrics);
        return metrics;
    }

    /** 仅复制账号卡片允许展示的指标键，防止误将登录配置透传到接口响应。 */
    private void copyOperationAccountMetricFields(Map<?, ?> source, Map<String, Object> target) {
        if (source == null || source.isEmpty()) {
            return;
        }
        Set<String> metricKeys = Set.of("followers", "followerCount", "fans", "works", "worksCount", "postCount",
            "views", "reads", "viewCount", "readCount", "followerGrowth", "growth", "growthRate", "interactions");
        for (String key : metricKeys) {
            Object value = source.get(key);
            if (value != null && StringUtils.isNotBlank(String.valueOf(value)) && !target.containsKey(key)) {
                target.put(key, value);
            }
        }
    }

    /** 将历史指标别名收敛为前端卡片使用的标准字段，兼容不同版本的数据写入格式。 */
    private void normalizeOperationAccountMetricAliases(Map<String, Object> metrics) {
        copyOperationAccountMetricAlias(metrics, "followers", "followerCount", "fans");
        copyOperationAccountMetricAlias(metrics, "works", "worksCount", "postCount");
        copyOperationAccountMetricAlias(metrics, "views", "reads", "viewCount", "readCount");
        copyOperationAccountMetricAlias(metrics, "followerGrowth", "growth", "growthRate");
    }

    private void copyOperationAccountMetricAlias(Map<String, Object> metrics, String standardKey, String... aliases) {
        if (metrics.containsKey(standardKey)) {
            return;
        }
        for (String alias : aliases) {
            Object value = metrics.get(alias);
            if (value != null && StringUtils.isNotBlank(String.valueOf(value))) {
                metrics.put(standardKey, value);
                return;
            }
        }
    }

    /** 配置读取失败时返回空对象，避免历史坏数据阻断运营列表。 */
    private Map<String, Object> parseOperationConfig(String config) {
        if (StringUtils.isBlank(config)) {
            return new HashMap<>();
        }
        try {
            return JSON.parseObject(config);
        }
        catch (Exception exception) {
            log.warn("[OperationRequirement] 配置JSON解析失败，返回空配置，config={}", config, exception);
            return new HashMap<>();
        }
    }

    /** JSON 数组字段读取失败时返回空数组，避免历史异常数据阻断运营任务列表。 */
    private List<Object> parseOperationJsonArray(String value) {
        if (StringUtils.isBlank(value)) {
            return new ArrayList<>();
        }
        try {
            return JSON.parseArray(value);
        }
        catch (Exception exception) {
            log.warn("[OperationTask] JSON数组解析失败，返回空数组，value={}", value, exception);
            return new ArrayList<>();
        }
    }
}
