package com.iwhalecloud.byai.manager.application.service.devloop;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.manager.application.service.job.DevloopPatService;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.domain.devloop.service.*;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ManualRequirementDeleteDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ManualRequirementDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ManualRequirementUpdateDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ScanSourceDTO;
import com.iwhalecloud.byai.manager.dto.devloop.IntegrationEnvDTO;
import com.iwhalecloud.byai.manager.dto.devloop.IntegrationSuiteDTO;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskListQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskStateDto;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskViewDto;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.devloop.*;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanRequireItemMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionExtMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
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

import java.io.ByteArrayOutputStream;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.concurrent.Executor;

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
    private ByaiSessionExtMapper byaiSessionExtMapper;

    @Autowired
    private ScanRequireItemMapper scanRequireItemMapper;

    @Autowired
    private ScanSourceService scanSourceService;

    @Autowired
    private IntegrationEnvService integrationEnvService;

    @Autowired
    private IntegrationSuiteService integrationSuiteService;

    @Autowired
    private IntegrationRunService integrationRunService;

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
    private DevloopPatService patService;

    @Autowired
    private ProjectMemberService projectMemberService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private AssistantChatService assistantChatService;

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
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private UserBucketNamingService userBucketNamingService;

    /** 创建扫描源 */
    public ResponseUtil<Map<String, Object>> createScanSource(ScanSourceDTO dto) {
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
            .filter(source -> !MANUAL_SOURCE_TYPE.equals(source.getSourceType())).map(this::scanSourceToVo)
            .collect(java.util.stream.Collectors.toList());
        return ResponseUtil.successResponse(list);
    }

    /** 渠道配置大面板按名称后端搜索并分页返回，手工需求的内部来源不计入渠道总数。 */
    public ResponseUtil<PageInfo<Map<String, Object>>> listScanSources(Long projectId, String keyword, int pageNum,
        int pageSize) {
        Page<ScanSource> sourcePage = scanSourceService.listByProjectIdPage(projectId, keyword, MANUAL_SOURCE_TYPE,
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

    // ========== 集成测试执行 ==========

    /** 触发一次「执行测试」:秒回 runId,后台异步跑 stages + 套件命令并轮询。 */
    public ResponseUtil<Map<String, Object>> startIntegrationRun(Long suiteId, Long envId) {
        IntegrationRun run = integrationRunService.startRun(suiteId, envId, CurrentUserHolder.getCurrentUserId());
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

    /** 查询某套件的历史执行列表。 */
    public ResponseUtil<List<Map<String, Object>>> listIntegrationRuns(Long suiteId) {
        List<Map<String, Object>> list = integrationRunService.listBySuiteId(suiteId).stream().map(this::runToHistoryVo)
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
        ScanSource source = new ScanSource();
        source.setSourceId(sourceId);
        source.setEnabled(enabled);
        scanSourceService.update(source);
        return ResponseUtil.successResponse(null);
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
        List<ScanSource> sources = scanSourceService.listByProjectId(projectId);
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

        // 会话即任务：同步建会话（带 projectId）拿到 sessionId，分支名依赖 sessionId，
        // 再据此生成完整提示词写回 chatDto，耗时的 LLM 对话放到事务提交后异步执行。
        // 先用 title 作会话内容让会话名可读，建成后再覆盖为完整提示词供异步 chat 使用。
        AssistantChatDto chatDto = new AssistantChatDto();
        chatDto.setSessionId(null);
        chatDto.setAgentId(agentId);
        chatDto.setProjectId(projectId);
        chatDto.setChatContent(title);
        chatDto.setAccessTerminal("DevLoop");
        chatDto.setClientRequestId(AssistantChatService.getClientRequestId());
        assistantChatService.createGroupChatSession(chatDto);
        Long sessionId = chatDto.getSessionId();

        String branchName = buildBranchName(taskType, sessionId);
        Project project = projectMapper.selectById(projectId);
        String projectName = project != null ? project.getProjectName() : "";
        chatDto.setChatContent(buildTaskPrompt(projectName, repo, branchName, taskType, title, description));

        // 需求项回写 sessionId，标记“已启动”并支持跳转会话
        if (sourceItemId != null) {
            ScanRequireItem item = new ScanRequireItem();
            item.setItemId(sourceItemId);
            item.setSessionId(sessionId);
            scanRequireItemMapper.updateById(item);
        }

        // 事务提交后再异步触发 chat：确保异步线程能读到本事务已建的 session。
        submitTaskChatAfterCommit(chatDto, loginInfo, sessionId);

        Map<String, Object> result = new HashMap<>();
        result.put("agentId", agentId);
        result.put("sessionId", sessionId);
        result.put("branchName", branchName);
        result.put("title", title);
        return ResponseUtil.successResponse(result);
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
     * 构造任务启动提示词：从 byai_system_config 取模板并填充占位符； 模板缺失时用内置兜底模板，保证任务始终可创建。
     */
    private String buildTaskPrompt(String projectName, ProjectRepo repo, String branchName, String taskType,
        String title, String description) {
        String template = byaiSystemConfigService.findByParamCode("DEVLOOP_TASK_START_PROMPT");
        if (template == null || template.isEmpty()) {
            template = DEFAULT_TASK_PROMPT_TEMPLATE;
        }
        String repoFullName = repo != null && repo.getRepoFullName() != null ? repo.getRepoFullName() : "";
        String repoUrl = repo != null && repo.getRepoUrl() != null ? repo.getRepoUrl() : repoFullName;
        return template.replace("${projectName}", projectName != null ? projectName : "").replace("${repoUrl}", repoUrl)
            .replace("${repoFullName}", repoFullName).replace("${branchName}", branchName != null ? branchName : "")
            .replace("${taskType}", taskType != null ? taskType : "").replace("${title}", title != null ? title : "")
            .replace("${description}", description != null ? description : "");
    }

    /** 提示词模板兜底：DB 未配置 DEVLOOP_TASK_START_PROMPT 时使用 */
    private static final String DEFAULT_TASK_PROMPT_TEMPLATE = "你是 ByClaw 开发助手，负责在指定代码仓库中自主完成开发任务。\n\n" + "## 任务信息\n"
        + "- 项目：${projectName}\n" + "- 代码仓库：${repoFullName}\n" + "- 目标分支：${branchName}（尚未创建，需你新建）\n"
        + "- 任务类型：${taskType}\n" + "- 任务标题：${title}\n\n" + "## 需求详情\n${description}\n\n" + "## 仓库访问说明\n"
        + "- 目标仓库全路径为 ${repoFullName}，它可能是私有仓库；GitHub 访问令牌(PAT)已配置在环境变量 GH_TOKEN 中，请直接使用它克隆和推送。\n"
        + "- 用带令牌的完整地址克隆：git clone https://$GH_TOKEN@github.com/${repoFullName}.git\n"
        + "- 若提示仓库或分支不存在，通常是私有仓库权限问题，请确认已使用环境变量 GH_TOKEN 中的令牌，不要据此判定仓库不存在、也不要改为在本地新建独立项目。\n\n" + "## 工作要求\n"
        + "1. 克隆仓库 ${repoFullName}，拉取默认分支最新代码；目标分支 ${branchName} 尚不存在，用 git checkout -b ${branchName} 从默认分支新建并切换。\n"
        + "2. 仔细理解上述需求详情，定位需要修改的代码。\n" + "3. 完成开发后自测，确保编译通过、相关测试通过。\n" + "4. 提交改动到分支 ${branchName} 并推送，提交信息清晰说明本次改动。\n"
        + "5. 如需求描述不清或存在阻塞，明确说明遇到的问题。\n" + "6. 使用 self-developed-rules skill 持续维护任务状态、阶段、证据与交付物。\n\n" + "请开始处理。";

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
            wrapper.apply("LOWER(session_name) LIKE {0}", "%" + query.getTaskName().trim().toLowerCase(Locale.ROOT) + "%");
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
     * 查询任务代码变更:本地优先,远程兜底。 本地=直接读宿主机会话工作区的 git 仓库跑 git diff,含未 push/未 commit 的最新改动; 工作区不存在或不是 git 仓库时,回退到
     * GitHubCompareService 的远程 compare(仅覆盖已 push 分支)。 base=仓库 defaultBranch(默认 main),head=任务分支(与详情同口径 buildBranchName)。
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
            // 与 resolveTaskContext 同口径：手工需求自身仓库优先，再回退扫描源和项目仓库。
            ScanRequireItem item = scanRequireItemMapper.selectOne(
                new LambdaQueryWrapper<ScanRequireItem>().eq(ScanRequireItem::getSessionId, sessionId).last("limit 1"));
            ProjectRepo repo = resolveTaskRepo(s.getProjectId(), item);
            String repoFullName = repo != null ? repo.getRepoFullName() : null;
            String baseBranch = repo != null && repo.getDefaultBranch() != null && !repo.getDefaultBranch().isEmpty()
                ? repo.getDefaultBranch()
                : "main";
            String headBranch = buildBranchName(detectTaskType(item, s.getSessionName()), sessionId);

            // 本地优先:能定位到工作区 git 仓库就用本地 diff(最新、含未 push)。本地采集自身已兜底,再包一层防未捕获异常。
            Path workspaceDir = resolveSessionWorkspace(s, repoFullName);
            if (workspaceDir != null) {
                try {
                    LocalGitChangeService.LocalChangeResult local = localGitChangeService.collectChanges(workspaceDir,
                        baseBranch);
                    if (local.getStatus() == LocalGitChangeService.LocalStatus.OK) {
                        return ResponseUtil.successResponse(localResultToMap(local, repoFullName));
                    }
                    log.info("[Devloop] 本地工作区变更不可用({}),回退远程 compare, sessionId={}", local.getStatus(), sessionId);
                }
                catch (Exception e) {
                    log.warn("[Devloop] 本地 git 变更采集异常,回退远程 compare, sessionId={}", sessionId, e);
                }
            }

            // 兜底:远程 compare,需要任务创建者的 GitHub PAT。
            String pat = patService.getGitHubPat(s.getCreatorId() != null ? String.valueOf(s.getCreatorId()) : null);
            GitHubCompareService.CompareResult result = gitHubCompareService.compare(repoFullName, baseBranch,
                headBranch, pat);
            return ResponseUtil.successResponse(compareResultToMap(result));
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
     * 查询任务单个文件的本地 diff(unified 文本),供前端 modal 逐行渲染。仅本地工作区口径; 工作区不可用或出错时返回 status 非 ok,前端提示,不抛异常。
     */
    public ResponseUtil<Map<String, Object>> getTaskFileDiff(Long sessionId, String filePath) {
        if (sessionId == null || filePath == null || filePath.trim().isEmpty()) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.task.file.diff.parameters.required"));
        }
        try {
            ByaiSession s = byaiSessionMapper.selectById(sessionId);
            if (s == null) {
                return ResponseUtil.failRes(I18nUtil.get("devloop.task.session.not.found"));
            }
            ScanRequireItem item = scanRequireItemMapper.selectOne(
                new LambdaQueryWrapper<ScanRequireItem>().eq(ScanRequireItem::getSessionId, sessionId).last("limit 1"));
            ProjectRepo repo = resolveTaskRepo(s.getProjectId(), item);
            String repoFullName = repo != null ? repo.getRepoFullName() : null;
            String baseBranch = repo != null && repo.getDefaultBranch() != null && !repo.getDefaultBranch().isEmpty()
                ? repo.getDefaultBranch()
                : "main";
            Path workspaceDir = resolveSessionWorkspace(s, repoFullName);

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
        Map<String, Object> result = dwsAuthService.startDeviceAuth();
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
        Map<String, Object> runtimeStatus = dwsAuthService.getAuthStatus(userId);
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

    /** 直接使用token授权 */
    public ResponseUtil<Void> saveDwsToken(String token) {
        boolean injected = dwsAuthService.injectToken(token);
        if (!injected) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.dws.token.invalid"));
        }
        return ResponseUtil.successResponse(null);
    }

    /**
     * 创建运营需求
     *
     * @param params 入参
     * @return ResponseUtil
     */
    public Long createOperationRequirement(Map<String, Object> params) {

        Long projectId = MapParamUtil.getLongValue(params, "projectId");
        String title = MapParamUtil.getStringValue(params, "requirementName");

        ScanSource source = new ScanSource();
        source.setProjectId(projectId);
        source.setSourceName(MapParamUtil.getStringValue(params, "operationType"));
        source.setSourceType(MapParamUtil.getStringValue(params, "operationType"));
        source.setConfig("{}");
        source.setEnabled("0");
        source.setConfirmMode("operation");
        source.setCreateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        scanSourceService.create(source);

        ScanLog scanLog = scanLogService.createLog(source.getSourceId(), projectId);

        ScanRequireItem scanRequireItem = scanLogService.createItem(scanLog.getLogId(), source.getSourceId(), title,
            JSON.toJSONString(params), "operation:" + UUID.randomUUID(), null, "created");

        return scanRequireItem.getItemId();
    }

    /**
     * 修改运营需求（仅更新 ScanRequireItem）。
     *
     * @param params 入参，需含 itemId；requirementName 作为标题，整包 params 写入 content
     */
    public void updateOperationRequirement(Map<String, Object> params) {
        Long itemId = MapParamUtil.getLongValue(params, "itemId");
        String title = MapParamUtil.getStringValue(params, "requirementName");

        ScanRequireItem updateItem = new ScanRequireItem();
        updateItem.setItemId(itemId);
        updateItem.setTitle(title);
        updateItem.setContent(JSON.toJSONString(params));
        scanRequireItemMapper.updateById(updateItem);
    }
}
