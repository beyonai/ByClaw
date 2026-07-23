package com.iwhalecloud.byai.manager.application.service.devloop;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.application.service.job.DevloopPatService;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.domain.devloop.service.*;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ManualRequirementDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ScanSourceDTO;
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
import com.iwhalecloud.byai.manager.mapper.devloop.ScanLogItemMapper;
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
     * 手工录入内容的持久化包裹标识。外部扫描内容仍按原文存储，读取时只识别该流程创建的记录，
     * 不改变已有渠道内容。
     */
    private static final String MANUAL_REQUIREMENT_CONTENT_KEY = "manualRequirement";

    /** 手工需求 JSON 包裹中持久化的稳定、语言无关的来源标识。 */
    private static final Set<String> MANUAL_REQUIREMENT_ORIGIN_TYPES =
        Set.of("manual", "customer_feedback", "internal_proposal");

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
    private ScanLogItemMapper scanLogItemMapper;

    @Autowired
    private ScanSourceService scanSourceService;

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

    /** 修改扫描源配置（名称、config、cron） */
    public ResponseUtil<Void> updateScanSource(ScanSourceDTO dto) {
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

    /** 删除扫描源 */
    public ResponseUtil<Void> deleteScanSource(Long sourceId) {
        scanSourceService.delete(sourceId);
        return ResponseUtil.successResponse(null);
    }

    /** 查询项目可配置的扫描渠道；手工来源只是扫描日志基础设施，不能展示在渠道配置页。 */
    public ResponseUtil<List<Map<String, Object>>> listScanSources(Long projectId) {
        List<Map<String, Object>> list = scanSourceService.listByProjectId(projectId).stream()
            .filter(source -> !MANUAL_SOURCE_TYPE.equals(source.getSourceType())).map(this::scanSourceToVo)
            .collect(java.util.stream.Collectors.toList());
        return ResponseUtil.successResponse(list);
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
        return map;
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
            return ResponseUtil.failRes("Source not found");
        }

        List<ScanLogItem> items;
        String type = source.getSourceType();
        if ("github_issue".equals(type)) {
            String pat = patService.getGitHubPat(source.getCreateBy());
            if (pat == null) {
                return ResponseUtil.failRes("GitHub PAT not configured");
            }
            items = gitHubIssueScanService.scan(source, pat);
        }
        else if ("dingtalk".equals(type)) {
            items = dingtalkScanService.scan(source);
            if (items == null) {
                return ResponseUtil.failRes("钉钉扫描失败，请检查：1) DWS是否已授权 2) 当前组织是否有消息搜索权限 3) 查看扫描日志获取详细错误");
            }
        }
        else if ("dingtalk_todo".equals(type)) {
            items = dingtalkTodoScanService.scan(source);
            if (items == null) {
                return ResponseUtil.failRes("钉钉待办扫描失败，请检查：1) DWS是否已授权 2) 当前组织待办访问权限 3) 查看扫描日志获取详细错误");
            }
        }
        else {
            return ResponseUtil.failRes("Unknown source type: " + type);
        }

        // 一次 LLM 调用完成拆分+评分，返回派发列表（子需求+未拆分条），再按确认规则派生
        List<ScanLogItem> dispatchItems = scoringService.splitAndScore(items);
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
    public ResponseUtil<List<Map<String, Object>>> listScanLogItems(Long logId) {
        List<ScanLogItem> items = scanLogService.listItemsByLogId(logId);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ScanLogItem item : items) {
            list.add(toRequirementMap(item));
        }
        return ResponseUtil.successResponse(list);
    }

    /**
     * 按扫描源直接查询已收集的需求(action=created)，供需求列表展示。 需求随日志滚动，按“最近N条日志”遍历会漏掉早期扫到的需求，故直接按 source 查条目。
     */
    public ResponseUtil<List<Map<String, Object>>> listRequirementsBySource(Long sourceId) {
        List<ScanLogItem> items = scanLogService.listCreatedItemsBySource(sourceId);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ScanLogItem item : items) {
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
        List<ScanLogItem> items = scanLogService.listCreatedItemsBySources(sourceIds, title);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ScanLogItem item : items) {
            list.add(toRequirementMap(item, sourceById.get(item.getSourceId())));
        }
        return ResponseUtil.successResponse(list);
    }

    /**
     * 新建手工需求，复用扫描日志存储，使需求列表、任务启动和任务详情继续沿用既有关联链路。
     * 每个项目只维护一个禁用的内部来源，不参与定时扫描或渠道配置。
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

        ScanSource source = findOrCreateManualSource(dto.getProjectId());
        ScanLog log = scanLogService.createLog(source.getSourceId(), dto.getProjectId());
        ScanLogItem item = scanLogService.createItem(log.getLogId(), source.getSourceId(), title,
            serializeManualRequirementContent(originType, dto.getBranch(), originalContent, dto.getProductContent()),
            "manual:" + UUID.randomUUID(), null, "created");
        scanLogService.completeLog(log.getLogId(), 1, 1);

        return ResponseUtil.successResponse(toRequirementMap(item, source));
    }

    /**
     * 每个项目复用一个禁用来源，因为扫描条目、任务派生和需求查询都通过 sourceId 关联。
     * 该来源永不作为外部扫描渠道被调度。
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
     * 将语言无关字段保存为带命名空间的 JSON 包裹，而不存已渲染的文案。
     * 既可无歧义解析，也兼容历史和第三方渠道的纯文本扫描内容。
     */
    private String serializeManualRequirementContent(String originType, String branch, String originalContent,
        String productContent) {
        Map<String, String> content = new LinkedHashMap<>();
        content.put("sourceType", originType);
        content.put("branch", StringUtils.trimToEmpty(branch));
        content.put("originalContent", originalContent);
        content.put("productContent", StringUtils.trimToEmpty(productContent));
        try {
            return MANUAL_REQUIREMENT_MAPPER.writeValueAsString(Map.of(MANUAL_REQUIREMENT_CONTENT_KEY, content));
        }
        catch (Exception e) {
            throw new IllegalStateException(I18nUtil.get("devloop.manualRequirement.content.serialize.failed"), e);
        }
    }

    private Map<String, Object> toRequirementMap(ScanLogItem item) {
        return toRequirementMap(item, null);
    }

    /**
     * 扫描条目转统一需求视图；手工来源名称与内容在读取时国际化，避免持久化标识和负载
     * 绑定创建者语言。
     */
    private Map<String, Object> toRequirementMap(ScanLogItem item, ScanSource source) {
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
            map.put("originalContent", manualContent.originalContent());
            map.put("productContent", manualContent.productContent());
        }
        if (source != null) {
            map.put("sourceName", MANUAL_SOURCE_TYPE.equals(source.getSourceType())
                ? I18nUtil.get("devloop.manualRequirement.source.name") : source.getSourceName());
            map.put("sourceType", source.getSourceType());
        }
        return map;
    }

    /**
     * 获取需求视图和 LLM 任务提示词共用的可读描述。
     * 格式化在当前执行上下文完成，再交给异步会话执行。
     */
    private String getRequirementContent(ScanLogItem item) {
        if (item == null) {
            return "";
        }
        ManualRequirementContent manualContent = parseManualRequirementContent(item.getContent());
        return manualContent != null ? formatManualRequirementContent(manualContent) : StringUtils.defaultString(item.getContent());
    }

    /**
     * 仅解析手工录入 JSON 包裹；格式错误、缺失包裹或字段不完整时返回 {@code null}，
     * 保留已有扫描需求的原始内容路径。
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
            return new ManualRequirementContent(manual.path("sourceType").asText("manual"),
                manual.path("branch").asText(""), originalContent, manual.path("productContent").asText(""));
        }
        catch (Exception ignored) {
            return null;
        }
    }

    /**
     * 使用当前请求语言格式化持久化的手工字段。禁止把结果再存回库：
     * 后续读取者的语言可能不同，JSON 包裹保持语言无关。
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
    private record ManualRequirementContent(String sourceType, String branch, String originalContent,
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
            // 群搜索由当前登录用户发起,用其 bucket 的 .dws 授权。
            Long currentUserId = CurrentUserHolder.getCurrentUserId();
            String dwsConfigDir = dwsAuthService
                .resolveDwsConfigDir(currentUserId != null ? String.valueOf(currentUserId) : null);
            if (dwsConfigDir != null) {
                pb.environment().put("DWS_CONFIG_DIR", dwsConfigDir);
            }
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
                return ResponseUtil.failRes("搜索超时");
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
            return ResponseUtil.failRes("搜索失败: " + e.getMessage());
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
            ScanLogItem existing = scanLogItemMapper.selectById(sourceItemId);
            if (existing != null && existing.getSessionId() != null) {
                return ResponseUtil.failRes("该需求已启动会话，无法重复启动");
            }
        }

        // 校验用户是否绑定了数字员工
        ProjectMember member = projectMemberService.findByProjectAndUser(projectId, userId);
        if (member == null) {
            return ResponseUtil.failRes("您不是该项目成员，无法创建任务");
        }
        if (member.getAgentId() == null) {
            return ResponseUtil.failRes("请先在成员管理中绑定数字员工");
        }
        Long agentId = member.getAgentId();

        if (sourceItemId != null && (title == null || title.isEmpty())) {
            ScanLogItem item = scanLogItemMapper.selectById(sourceItemId);
            if (item != null)
                title = item.getTitle();
        }
        if (title == null || title.isEmpty()) {
            return ResponseUtil.failRes("任务标题不能为空");
        }

        // 将手工需求 JSON 按当前执行上下文的语言渲染后，再写入异步 LLM 提示词。
        // 普通扫描内容经 getRequirementContent 处理时保持原样。
        ScanLogItem sourceItem = sourceItemId != null ? scanLogItemMapper.selectById(sourceItemId) : null;
        String description = sourceItem != null && StringUtils.isNotBlank(sourceItem.getContent())
            ? getRequirementContent(sourceItem)
            : title;
        String taskType = detectTaskType(sourceItem, title);

        // 解析目标仓库：需求项 -> 扫描源.repoId -> 仓库；手动任务取项目首个仓库兜底
        ProjectRepo repo = resolveTaskRepo(projectId, sourceItem);
        if (repo == null) {
            return ResponseUtil.failRes("未找到目标仓库，请为扫描源关联仓库或在项目下添加仓库");
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
            ScanLogItem item = new ScanLogItem();
            item.setItemId(sourceItemId);
            item.setSessionId(sessionId);
            scanLogItemMapper.updateById(item);
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
    public void autoDeriveForSource(ScanSource source, List<ScanLogItem> newItems) {
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
        List<ScanLogItem> pending = collectPendingItems(source, newItems, byScore, threshold);
        // 新增 vs 重捞拆分统计：新增=本轮扫到的未启动条数，重捞=历史未启动补进来的条数
        int newCount = 0;
        if (newItems != null) {
            for (ScanLogItem it : newItems) {
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
            for (ScanLogItem item : pending) {
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
    private List<ScanLogItem> collectPendingItems(ScanSource source, List<ScanLogItem> newItems, boolean byScore,
        int threshold) {
        Map<Long, ScanLogItem> byId = new LinkedHashMap<>();
        if (newItems != null) {
            for (ScanLogItem it : newItems) {
                if (it.getItemId() != null && it.getSessionId() == null) {
                    byId.put(it.getItemId(), it);
                }
            }
        }
        for (ScanLogItem it : scanLogService.listCreatedItemsBySource(source.getSourceId())) {
            if (it.getItemId() != null && it.getSessionId() == null) {
                byId.putIfAbsent(it.getItemId(), it);
            }
        }
        List<ScanLogItem> result = new ArrayList<>();
        for (ScanLogItem it : byId.values()) {
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
    private String detectTaskType(ScanLogItem item, String title) {
        String haystack = ((item != null && item.getTitle() != null ? item.getTitle() : "") + " "
            + getRequirementContent(item) + " "
            + (item != null && item.getAction() != null ? item.getAction() : "") + " " + (title != null ? title : ""))
            .toLowerCase();
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
     * 解析任务目标仓库：需求项 -> 扫描源.repoId -> 仓库； 手动任务或扫描源未绑定仓库时，取项目首个仓库兜底。
     */
    private ProjectRepo resolveTaskRepo(Long projectId, ScanLogItem item) {
        if (item != null && item.getSourceId() != null) {
            ScanSource source = scanSourceService.findById(item.getSourceId());
            if (source != null && source.getRepoId() != null) {
                ProjectRepo repo = projectRepoMapper.selectById(source.getRepoId());
                if (repo != null) {
                    return repo;
                }
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
            return ResponseUtil.failRes("projectId 不能为空");
        }
        try {
            query.normalizeAndValidate();
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.failRes(e.getMessage());
        }

        LambdaQueryWrapper<ByaiSession> wrapper = new LambdaQueryWrapper<ByaiSession>()
            .eq(ByaiSession::getProjectId, query.getProjectId())
            .ge(query.getCreateTimeStart() != null, ByaiSession::getCreateTime, query.getCreateTimeStart())
            .le(query.getCreateTimeEnd() != null, ByaiSession::getCreateTime, query.getCreateTimeEnd());
        // 任务名称与会话标题一一对应，搜索仅匹配名称，分页总数与前端搜索结果一致。
        if (StringUtils.isNotBlank(query.getTaskName())) {
            wrapper.like(ByaiSession::getSessionName, query.getTaskName().trim());
        }
        if (DEFAULT_PROJECT_ID.equals(query.getProjectId()) || Boolean.TRUE.equals(query.getOnlyMine())) {
            // 默认项目共用 -1 分组必须按创建人隔离；onlyMine 过滤同样只看当前登录用户的会话，两者叠加无害。
            wrapper.eq(ByaiSession::getCreatorId, CurrentUserHolder.getCurrentUserId());
        }
        wrapper.orderByDesc(ByaiSession::getCreateTime).orderByDesc(ByaiSession::getSessionId);
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

    /** 查询单个任务详情：会话元数据来自数据库，状态来自 v2 会话投影。 */
    public ResponseUtil<DevloopTaskViewDto> getTaskDetail(Long sessionId) {
        ByaiSession session = byaiSessionMapper.selectById(sessionId);
        if (session == null) {
            return ResponseUtil.failRes("会话不存在");
        }
        return ResponseUtil
            .successResponse(sessionAsTask(session, tryReadTaskState(session), resolveTaskContext(session)));
    }

    /** 直接按 sessionId 读取 v2 会话状态投影，不再解析消息或访问 session_ext。 */
    public ResponseUtil<DevloopTaskStateDto> getTaskPhases(Long sessionId) {
        if (sessionId == null) {
            return ResponseUtil.failRes("sessionId 不能为空");
        }
        ByaiSession session = byaiSessionMapper.selectById(sessionId);
        if (session == null) {
            return ResponseUtil.failRes("会话不存在");
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
            return ResponseUtil.failRes("sessionId 不能为空");
        }
        ByaiSession s = byaiSessionMapper.selectById(sessionId);
        if (s == null) {
            return ResponseUtil.failRes("会话不存在");
        }
        // 代码变更是只读展示,任何本地/远程异常都不抛前端:顶层兜底,失败返回 http_error 空态并记日志。
        try {
            // 与 resolveTaskContext 同口径:需求项 -> 源.repoId -> 仓库;手动任务取项目首个仓库兜底。
            ScanLogItem item = scanLogItemMapper.selectOne(
                new LambdaQueryWrapper<ScanLogItem>().eq(ScanLogItem::getSessionId, sessionId).last("limit 1"));
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
            return ResponseUtil.failRes("sessionId 与 filePath 不能为空");
        }
        try {
            ByaiSession s = byaiSessionMapper.selectById(sessionId);
            if (s == null) {
                return ResponseUtil.failRes("会话不存在");
            }
            ScanLogItem item = scanLogItemMapper.selectOne(
                new LambdaQueryWrapper<ScanLogItem>().eq(ScanLogItem::getSessionId, sessionId).last("limit 1"));
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
     * 实时解析任务上下文：不落库，按需从关联链路查。 需求/仓库：sessionId -> byai_scan_log_item -> source(repoId->仓库) -> log(projectId)；
     * agent：session.objectId(数字员工resourceId) -> 资源名；负责人：session.creatorId -> 用户名； 分支：由 taskType(据需求内容判定) + sessionId
     * 确定性重算。关联信息变化后展示随之更新。
     */
    private Map<String, Object> resolveTaskContext(ByaiSession s) {
        Map<String, Object> ctx = new HashMap<>();
        Long sessionId = s.getSessionId();

        // 派生任务会把 sessionId 回写到需求项；据此还原需求与仓库。手动任务无此行，走项目兜底仓库。
        ScanLogItem item = scanLogItemMapper
            .selectOne(new LambdaQueryWrapper<ScanLogItem>().eq(ScanLogItem::getSessionId, sessionId).last("limit 1"));
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
        return ResponseUtil.failRes((String) result.getOrDefault("message", "启动授权失败"));
    }

    /** 检查DWS授权状态（前端轮询用） */
    public ResponseUtil<Map<String, Object>> checkDwsAuthStatus() {
        Map<String, Object> dbStatus = dwsAuthService.checkDwsToken();
        Map<String, Object> runtimeStatus = dwsAuthService.getAuthStatus();
        Map<String, Object> result = new HashMap<>();
        result.put("hasToken", dbStatus.get("hasToken"));
        result.put("savedAt", dbStatus.getOrDefault("savedAt", ""));
        result.put("runtimeAuthenticated", runtimeStatus.get("authenticated"));
        result.put("tokenValid", runtimeStatus.get("tokenValid"));
        result.put("refreshTokenValid", runtimeStatus.getOrDefault("refreshTokenValid", false));
        result.put("expiresAt", runtimeStatus.getOrDefault("expiresAt", ""));
        result.put("refreshExpiresAt", runtimeStatus.getOrDefault("refreshExpiresAt", ""));
        result.put("corpId", runtimeStatus.getOrDefault("corpId", ""));
        result.put("corpName", runtimeStatus.getOrDefault("corpName", ""));
        result.put("userId", runtimeStatus.getOrDefault("userId", ""));
        result.put("userName", runtimeStatus.getOrDefault("userName", ""));
        return ResponseUtil.successResponse(result);
    }

    /** 直接使用token授权 */
    public ResponseUtil<Void> saveDwsToken(String token) {
        boolean injected = dwsAuthService.injectToken(token);
        if (!injected) {
            return ResponseUtil.failRes("Token无效，注入失败");
        }
        dwsAuthService.recordAuthToDb();
        return ResponseUtil.successResponse(null);
    }
}
