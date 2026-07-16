package com.iwhalecloud.byai.manager.application.service.devloop;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.job.DevloopPatService;
import com.iwhalecloud.byai.manager.domain.devloop.service.DingtalkScanService;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService;
import com.iwhalecloud.byai.manager.domain.devloop.service.GitHubIssueScanService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanLogService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanSourceService;
import com.iwhalecloud.byai.manager.domain.devloop.service.DevloopTaskService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ScanSourceDTO;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.devloop.*;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectSessionMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanLogItemMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayOutputStream;
import java.util.*;

/**
 * 研发闭环应用服务
 * 聚合项目管理、扫描源管理、扫描执行、日志查询、PAT管理、钉钉群搜索等业务逻辑
 */
@Slf4j
@Service
public class DevloopApplicationService {

    private static final String DELETE_FLAG_NORMAL = "0";

    private static final String DELETE_FLAG_DELETED = "1";

    @Autowired
    private ProjectMapper projectMapper;

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    @Autowired
    private ProjectSessionMapper projectSessionMapper;

    @Autowired
    private ByaiSessionMapper byaiSessionMapper;

    @Autowired
    private ScanLogItemMapper scanLogItemMapper;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private ScanSourceService scanSourceService;

    @Autowired
    private ScanLogService scanLogService;

    @Autowired
    private GitHubIssueScanService gitHubIssueScanService;

    @Autowired
    private DingtalkScanService dingtalkScanService;

    @Autowired
    private DwsAuthService dwsAuthService;

    @Autowired
    private DevloopPatService patService;

    @Autowired
    private DevloopTaskService taskService;

    @Autowired
    private ProjectMemberService projectMemberService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private AssistantChatService assistantChatService;

    /** 创建项目，可同时关联代码仓库 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Map<String, Object>> createProject(ProjectDTO dto) {
        Project project = new Project();
        project.setProjectId(sequenceService.nextVal());
        project.setProjectName(dto.getProjectName());
        project.setDescription(dto.getDescription());
        project.setResourceId(dto.getResourceId());
        project.setProjectType(dto.getProjectType() != null ? dto.getProjectType() : "normal");
        project.setIsShare(dto.getIsShare() != null ? dto.getIsShare() : "N");
        project.setCreateBy(CurrentUserHolder.getCurrentUserId());
        project.setCreateTime(new Date());
        project.setDeleteFlag(DELETE_FLAG_NORMAL);
        projectMapper.insert(project);

        if (dto.getRepos() != null) {
            for (ProjectRepoDTO repoDto : dto.getRepos()) {
                ProjectRepo repo = new ProjectRepo();
                repo.setRepoId(sequenceService.nextVal());
                repo.setProjectId(project.getProjectId());
                repo.setRepoFullName(repoDto.getRepoFullName());
                repo.setRepoUrl(repoDto.getRepoUrl());
                repo.setDefaultBranch(repoDto.getDefaultBranch() != null
                    ? repoDto.getDefaultBranch() : "main");
                repo.setCreateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
                repo.setCreateTime(new Date());
                projectRepoMapper.insert(repo);
            }
        }

        // 创建者自动加为 owner 成员
        projectMemberService.addMember(
            project.getProjectId(),
            CurrentUserHolder.getCurrentUserId(),
            CurrentUserHolder.getCurrentUserCode(),
            CurrentUserHolder.getCurrentUserName(),
            "owner"
        );

        Map<String, Object> result = new HashMap<>();
        result.put("projectId", project.getProjectId());
        return ResponseUtil.successResponse(result);
    }

    /** 查询项目列表，按创建时间倒序；keyword 用于项目名称/描述模糊搜索。 */
    public ResponseUtil<List<Map<String, Object>>> listProjects(String keyword) {
        LambdaQueryWrapper<Project> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Project::getDeleteFlag, DELETE_FLAG_NORMAL);
        String searchKeyword = keyword == null ? "" : keyword.trim();
        if (!searchKeyword.isEmpty()) {
            wrapper.and(w -> w.like(Project::getProjectName, searchKeyword)
                .or()
                .like(Project::getDescription, searchKeyword));
        }
        wrapper.orderByDesc(Project::getCreateTime);
        List<Project> projects = projectMapper.selectList(wrapper);

        List<Map<String, Object>> list = new ArrayList<>();
        for (Project p : projects) {
            Map<String, Object> map = new HashMap<>();
            map.put("projectId", p.getProjectId());
            map.put("projectName", p.getProjectName());
            map.put("description", p.getDescription());
            map.put("resourceId", p.getResourceId());
            map.put("projectType", p.getProjectType());
            map.put("isShare", p.getIsShare());
            map.put("createTime", p.getCreateTime());
            map.put("sessionCount", safeCountProjectSessions(p.getProjectId()));
            list.add(map);
        }
        return ResponseUtil.successResponse(list);
    }

    /** 修改项目名称或描述 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> updateProject(ProjectDTO dto) {
        Project project = projectMapper.selectById(dto.getProjectId());
        if (project == null || DELETE_FLAG_DELETED.equals(project.getDeleteFlag())) {
            return ResponseUtil.failRes("Project not found");
        }
        if (dto.getProjectName() != null) {
            project.setProjectName(dto.getProjectName());
        }
        if (dto.getDescription() != null) {
            project.setDescription(dto.getDescription());
        }
        if (dto.getProjectType() != null) {
            project.setProjectType(dto.getProjectType());
        }
        if (dto.getIsShare() != null) {
            project.setIsShare(dto.getIsShare());
        }
        project.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        project.setUpdateTime(new Date());
        projectMapper.updateById(project);
        return ResponseUtil.successResponse(null);
    }

    /** 软删除项目 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> deleteProject(Long projectId) {
        Project project = projectMapper.selectById(projectId);
        if (project == null || DELETE_FLAG_DELETED.equals(project.getDeleteFlag())) {
            return ResponseUtil.failRes("Project not found");
        }
        project.setDeleteFlag(DELETE_FLAG_DELETED);
        project.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        project.setUpdateTime(new Date());
        projectMapper.updateById(project);
        return ResponseUtil.successResponse(null);
    }

    /** 查询项目详情，含关联仓库和会话列表 */
    public ResponseUtil<Map<String, Object>> getProject(Long projectId) {
        Project project = projectMapper.selectById(projectId);
        if (project == null || DELETE_FLAG_DELETED.equals(project.getDeleteFlag())) {
            return ResponseUtil.failRes("Project not found");
        }
        LambdaQueryWrapper<ProjectRepo> repoWrapper = new LambdaQueryWrapper<>();
        repoWrapper.eq(ProjectRepo::getProjectId, projectId);
        List<ProjectRepo> repos = projectRepoMapper.selectList(repoWrapper);
        List<ByaiSessionDto> sessions = safeListProjectSessions(projectId);

        Map<String, Object> map = new HashMap<>();
        map.put("projectId", project.getProjectId());
        map.put("projectName", project.getProjectName());
        map.put("description", project.getDescription());
        map.put("resourceId", project.getResourceId());
        map.put("projectType", project.getProjectType());
        map.put("isShare", project.getIsShare());
        map.put("repos", repos);
        map.put("sessions", sessions);
        map.put("sessionCount", sessions.size());
        return ResponseUtil.successResponse(map);
    }

    private Long safeCountProjectSessions(Long projectId) {
        try {
            Long sessionCount = projectSessionMapper.countSessionsByProjectId(projectId);
            return sessionCount == null ? 0L : sessionCount;
        } catch (Exception error) {
            if (isProjectSessionTableMissing(error)) {
                // 兼容已执行旧版 V0.3.0 但漏建项目会话关联表的环境，避免项目列表整体不可用。
                log.warn("Project session relation table is missing, fallback sessionCount=0, projectId={}", projectId);
                return 0L;
            }
            throw error instanceof RuntimeException ? (RuntimeException) error : new IllegalStateException(error);
        }
    }

    private List<ByaiSessionDto> safeListProjectSessions(Long projectId) {
        try {
            return projectSessionMapper.selectSessionsByProjectId(projectId);
        } catch (Exception error) {
            if (isProjectSessionTableMissing(error)) {
                // 表缺失时详情页先展示项目基础信息，后续迁移补表后会话列表自动恢复。
                log.warn("Project session relation table is missing, fallback sessions empty, projectId={}", projectId);
                return Collections.emptyList();
            }
            throw error instanceof RuntimeException ? (RuntimeException) error : new IllegalStateException(error);
        }
    }

    private boolean isProjectSessionTableMissing(Throwable error) {
        Throwable current = error;
        while (current != null) {
            String message = current.getMessage();
            if (message != null) {
                String lowerMessage = message.toLowerCase(Locale.ROOT);
                if (lowerMessage.contains("byai_project_session") && lowerMessage.contains("does not exist")) {
                    return true;
                }
            }
            current = current.getCause();
        }
        return false;
    }

    /** 绑定会话到项目；项目空间是一组会话分组，一个会话只保留一个有效项目归属。 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> bindProjectSession(Long projectId, Long sessionId) {
        Project project = projectMapper.selectById(projectId);
        if (project == null || DELETE_FLAG_DELETED.equals(project.getDeleteFlag())) {
            return ResponseUtil.failRes("Project not found");
        }
        ByaiSession session = byaiSessionMapper.selectById(sessionId);
        if (session == null) {
            return ResponseUtil.failRes("Session not found");
        }

        String currentUserId = String.valueOf(CurrentUserHolder.getCurrentUserId());
        Date now = new Date();

        ProjectSession archivedRelation = new ProjectSession();
        archivedRelation.setDeleteFlag(DELETE_FLAG_DELETED);
        archivedRelation.setUpdateBy(currentUserId);
        archivedRelation.setUpdateTime(now);
        projectSessionMapper.update(
            archivedRelation,
            new LambdaUpdateWrapper<ProjectSession>()
                .eq(ProjectSession::getSessionId, sessionId)
                .eq(ProjectSession::getDeleteFlag, DELETE_FLAG_NORMAL)
                .ne(ProjectSession::getProjectId, projectId)
        );

        LambdaQueryWrapper<ProjectSession> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectSession::getProjectId, projectId)
            .eq(ProjectSession::getSessionId, sessionId);
        List<ProjectSession> existingRelations = projectSessionMapper.selectList(wrapper);
        if (!existingRelations.isEmpty()) {
            ProjectSession relation = existingRelations.get(0);
            relation.setDeleteFlag(DELETE_FLAG_NORMAL);
            relation.setUpdateBy(currentUserId);
            relation.setUpdateTime(now);
            projectSessionMapper.updateById(relation);
            return ResponseUtil.successResponse(null);
        }

        ProjectSession relation = new ProjectSession();
        relation.setRelationId(sequenceService.nextVal());
        relation.setProjectId(projectId);
        relation.setSessionId(sessionId);
        relation.setCreateBy(currentUserId);
        relation.setCreateTime(now);
        relation.setDeleteFlag(DELETE_FLAG_NORMAL);
        projectSessionMapper.insert(relation);
        return ResponseUtil.successResponse(null);
    }

    /** 取消项目和会话的有效关联，保留历史记录便于后续恢复或审计。 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> unbindProjectSession(Long projectId, Long sessionId) {
        ProjectSession relation = new ProjectSession();
        relation.setDeleteFlag(DELETE_FLAG_DELETED);
        relation.setUpdateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        relation.setUpdateTime(new Date());
        projectSessionMapper.update(
            relation,
            new LambdaUpdateWrapper<ProjectSession>()
                .eq(ProjectSession::getProjectId, projectId)
                .eq(ProjectSession::getSessionId, sessionId)
                .eq(ProjectSession::getDeleteFlag, DELETE_FLAG_NORMAL)
        );
        return ResponseUtil.successResponse(null);
    }

    /** 创建扫描源 */
    public ResponseUtil<Map<String, Object>> createScanSource(ScanSourceDTO dto) {
        ScanSource source = new ScanSource();
        source.setProjectId(dto.getProjectId());
        source.setSourceName(dto.getSourceName());
        source.setSourceType(dto.getSourceType());
        source.setConfig(dto.getConfig());
        source.setCronExpr(dto.getCronExpr());
        source.setEnabled(dto.getEnabled() != null ? dto.getEnabled() : "1");
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
        source.setUpdateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        scanSourceService.update(source);
        return ResponseUtil.successResponse(null);
    }

    /** 删除扫描源 */
    public ResponseUtil<Void> deleteScanSource(Long sourceId) {
        scanSourceService.delete(sourceId);
        return ResponseUtil.successResponse(null);
    }

    /** 查询项目下的扫描源列表 */
    public ResponseUtil<List<Map<String, Object>>> listScanSources(Long projectId) {
        List<ScanSource> sources = scanSourceService.listByProjectId(projectId);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ScanSource s : sources) {
            Map<String, Object> map = new HashMap<>();
            map.put("sourceId", s.getSourceId());
            map.put("sourceName", s.getSourceName());
            map.put("sourceType", s.getSourceType());
            map.put("config", s.getConfig());
            map.put("cronExpr", s.getCronExpr());
            map.put("enabled", s.getEnabled());
            map.put("lastScanTime", s.getLastScanTime());
            list.add(map);
        }
        return ResponseUtil.successResponse(list);
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
        } else if ("dingtalk".equals(type)) {
            items = dingtalkScanService.scan(source);
            if (items == null) {
                return ResponseUtil.failRes("DWS未授权，请先在扫描源设置中完成钉钉授权");
            }
        } else {
            return ResponseUtil.failRes("Unknown source type: " + type);
        }

        Map<String, Object> result = new HashMap<>();
        result.put("createdCount", items.size());
        return ResponseUtil.successResponse(result);
    }

    /** 查询扫描日志列表 */
    public ResponseUtil<List<Map<String, Object>>> listScanLogs(
            Long sourceId, int limit) {
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
            Map<String, Object> map = new HashMap<>();
            map.put("itemId", item.getItemId());
            map.put("title", item.getTitle());
            map.put("originId", item.getOriginId());
            map.put("originUrl", item.getOriginUrl());
            map.put("action", item.getAction());
            map.put("createTime", item.getCreateTime());
            list.add(map);
        }
        return ResponseUtil.successResponse(list);
    }

    @Autowired
    private com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper userPrivateParamMapper;

    /** 保存GitHub PAT，SM4加密存储 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> saveGitHubPat(String pat) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        String paramKey = "GH_TOKEN";

        LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.users.UserPrivateParam> wrapper =
            new LambdaQueryWrapper<>();
        wrapper.eq(com.iwhalecloud.byai.manager.entity.users.UserPrivateParam::getUserId, userId)
               .eq(com.iwhalecloud.byai.manager.entity.users.UserPrivateParam::getParamKey, paramKey)
               .eq(com.iwhalecloud.byai.manager.entity.users.UserPrivateParam::getDeleteFlag, "0");

        var existing = userPrivateParamMapper.selectOne(wrapper);
        String encrypted = com.iwhalecloud.byai.common.ecrypt.Sm4Util.encrypt(pat);
        String last4 = pat.length() > 4 ? pat.substring(pat.length() - 4) : pat;

        if (existing != null) {
            existing.setParamValueCipher(encrypted);
            existing.setParamValueLast4(last4);
            existing.setUpdateTime(new Date());
            userPrivateParamMapper.updateById(existing);
        } else {
            var param = new com.iwhalecloud.byai.manager.entity.users.UserPrivateParam();
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

        LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.users.UserPrivateParam> wrapper =
            new LambdaQueryWrapper<>();
        wrapper.eq(com.iwhalecloud.byai.manager.entity.users.UserPrivateParam::getUserId, userId)
               .eq(com.iwhalecloud.byai.manager.entity.users.UserPrivateParam::getParamKey, paramKey)
               .eq(com.iwhalecloud.byai.manager.entity.users.UserPrivateParam::getDeleteFlag, "0");

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
            Process process = pb.start();

            StringBuilder output = new StringBuilder();
            try (var reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(process.getInputStream()))) {
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
        } catch (Exception e) {
            log.error("DingTalk group search failed", e);
            return ResponseUtil.failRes("搜索失败: " + e.getMessage());
        }
        return ResponseUtil.successResponse(groups);
    }

    // ========== 研发任务 ==========

    /** 从需求创建任务 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Map<String, Object>> createTask(Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        Long sourceItemId = params.containsKey("sourceItemId")
            ? Long.valueOf(params.get("sourceItemId").toString()) : null;
        String title = params.containsKey("title") && params.get("title") != null
            ? params.get("title").toString() : null;

        // 防止重复启动：如果该需求已有未完成的任务，拒绝创建
        if (sourceItemId != null) {
            Task existing = taskService.findActiveBySourceItemId(sourceItemId);
            if (existing != null) {
                return ResponseUtil.failRes("该需求已有进行中的任务，无法重复启动");
            }
        }

        // 校验当前用户是否绑定了数字员工
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        ProjectMember member = projectMemberService.findByProjectAndUser(projectId, currentUserId);
        if (member == null) {
            return ResponseUtil.failRes("您不是该项目成员，无法创建任务");
        }
        if (member.getAgentId() == null) {
            return ResponseUtil.failRes("请先在成员管理中绑定数字员工");
        }
        Long agentId = member.getAgentId();

        if (sourceItemId != null && (title == null || title.isEmpty())) {
            ScanLogItem item = scanLogItemMapper.selectById(sourceItemId);
            if (item != null) title = item.getTitle();
        }
        if (title == null || title.isEmpty()) {
            return ResponseUtil.failRes("任务标题不能为空");
        }

        Task task = new Task();
        task.setProjectId(projectId);
        task.setSourceItemId(sourceItemId);
        task.setTitle(title);

        // 构造聊天内容：优先用需求原文，fallback 用标题
        String chatContent = title;
        if (sourceItemId != null) {
            ScanLogItem sourceItem = scanLogItemMapper.selectById(sourceItemId);
            if (sourceItem != null && sourceItem.getContent() != null && !sourceItem.getContent().isEmpty()) {
                chatContent = sourceItem.getContent();
            }
        }

        // 同步调用 assistantChatService，sessionId=null 让 chat 服务内部创建 session
        // chat 完成后 chatDto.getSessionId() 即为新创建的 sessionId
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        AssistantChatDto chatDto = new AssistantChatDto();
        chatDto.setSessionId(null);
        chatDto.setAgentId(agentId);
        chatDto.setChatContent(chatContent);
        chatDto.setAccessTerminal("DevLoop");
        try {
            assistantChatService.chat(chatDto, new ByteArrayOutputStream(), loginInfo);
        } catch (Exception e) {
            log.error("[DevloopTask] LLM chat failed", e);
            return ResponseUtil.failRes("任务创建失败：LLM对话异常 - " + e.getMessage());
        }

        Long sessionId = chatDto.getSessionId();
        task.setSessionId(sessionId);
        taskService.create(task);

        if (sourceItemId != null) {
            ScanLogItem item = new ScanLogItem();
            item.setItemId(sourceItemId);
            item.setTaskId(task.getTaskId());
            scanLogItemMapper.updateById(item);
        }

        Map<String, Object> result = new HashMap<>();
        result.put("taskId", task.getTaskId());
        result.put("agentId", agentId);
        result.put("sessionId", sessionId);
        result.put("title", title);
        return ResponseUtil.successResponse(result);
    }

    /** 查询项目任务列表 */
    public ResponseUtil<List<Map<String, Object>>> listTasks(Long projectId) {
        List<Task> tasks = taskService.listByProjectId(projectId);
        List<Map<String, Object>> list = new ArrayList<>();
        for (Task t : tasks) {
            Map<String, Object> map = new HashMap<>();
            map.put("taskId", t.getTaskId());
            map.put("projectId", t.getProjectId());
            map.put("sourceItemId", t.getSourceItemId());
            map.put("title", t.getTitle());
            map.put("status", t.getStatus());
            map.put("phase", t.getPhase());
            map.put("currentRound", t.getCurrentRound());
            map.put("totalRounds", t.getTotalRounds());
            map.put("score", t.getScore());
            map.put("assignee", t.getAssignee());
            map.put("agentName", t.getAgentName());
            map.put("branchName", t.getBranchName());
            map.put("warningTag", t.getWarningTag());
            map.put("sessionId", t.getSessionId());
            map.put("createTime", t.getCreateTime());
            list.add(map);
        }
        return ResponseUtil.successResponse(list);
    }

    /** 更新任务字段 */
    public ResponseUtil<Void> updateTask(Map<String, Object> params) {
        Long taskId = Long.valueOf(params.get("taskId").toString());
        Task task = taskService.getById(taskId);
        if (task == null) return ResponseUtil.failRes("任务不存在");

        if (params.containsKey("status")) task.setStatus(params.get("status").toString());
        if (params.containsKey("phase")) task.setPhase(params.get("phase").toString());
        if (params.containsKey("currentRound")) task.setCurrentRound(Integer.valueOf(params.get("currentRound").toString()));
        if (params.containsKey("totalRounds")) task.setTotalRounds(Integer.valueOf(params.get("totalRounds").toString()));
        if (params.containsKey("score")) task.setScore(Integer.valueOf(params.get("score").toString()));
        if (params.containsKey("assignee")) task.setAssignee(params.get("assignee").toString());
        if (params.containsKey("branchName")) task.setBranchName(params.get("branchName").toString());
        if (params.containsKey("warningTag")) task.setWarningTag(params.get("warningTag").toString());
        if (params.containsKey("sessionId")) task.setSessionId(Long.valueOf(params.get("sessionId").toString()));
        taskService.update(task);
        return ResponseUtil.successResponse(null);
    }

    /** 查询单个任务详情 */
    public ResponseUtil<Map<String, Object>> getTaskDetail(Long taskId) {
        Task t = taskService.getById(taskId);
        if (t == null) return ResponseUtil.failRes("任务不存在");
        Map<String, Object> map = new HashMap<>();
        map.put("taskId", t.getTaskId());
        map.put("projectId", t.getProjectId());
        map.put("sourceItemId", t.getSourceItemId());
        map.put("title", t.getTitle());
        map.put("status", t.getStatus());
        map.put("phase", t.getPhase());
        map.put("currentRound", t.getCurrentRound());
        map.put("totalRounds", t.getTotalRounds());
        map.put("score", t.getScore());
        map.put("assignee", t.getAssignee());
        map.put("agentName", t.getAgentName());
        map.put("branchName", t.getBranchName());
        map.put("warningTag", t.getWarningTag());
        map.put("createTime", t.getCreateTime());
        return ResponseUtil.successResponse(map);
    }

    // ========== 项目成员 ==========

    /** 添加项目成员 */
    public ResponseUtil<Void> addProjectMember(Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        Long userId = Long.valueOf(params.get("userId").toString());
        String userCode = params.containsKey("userCode") ? params.get("userCode").toString() : null;
        String userName = params.containsKey("userName") ? params.get("userName").toString() : null;

        if (projectMemberService.isMember(projectId, userId)) {
            return ResponseUtil.failRes("该用户已是项目成员");
        }
        projectMemberService.addMember(projectId, userId, userCode, userName, "member");
        return ResponseUtil.successResponse(null);
    }

    /** 查询项目成员列表 */
    public ResponseUtil<List<Map<String, Object>>> listProjectMembers(Long projectId) {
        List<ProjectMember> members = projectMemberService.listByProjectId(projectId);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ProjectMember m : members) {
            Map<String, Object> map = new HashMap<>();
            map.put("memberId", m.getMemberId());
            map.put("projectId", m.getProjectId());
            map.put("userId", m.getUserId());
            map.put("userCode", m.getUserCode());
            map.put("userName", m.getUserName());
            map.put("role", m.getRole());
            map.put("agentId", m.getAgentId());
            if (m.getAgentId() != null) {
                SsResource resource = ssResourceMapper.selectById(m.getAgentId());
                map.put("agentName", resource != null ? resource.getResourceName() : null);
            }
            map.put("createTime", m.getCreateTime());
            list.add(map);
        }
        return ResponseUtil.successResponse(list);
    }

    /** 移除项目成员 */
    public ResponseUtil<Void> removeProjectMember(Long memberId) {
        ProjectMember member = projectMemberService.getById(memberId);
        if (member != null) {
            Project project = projectMapper.selectById(member.getProjectId());
            if (project != null && project.getCreateBy() != null
                && project.getCreateBy().equals(member.getUserId())) {
                return ResponseUtil.failRes("项目创建者不能被移除");
            }
        }
        projectMemberService.removeMember(memberId);
        return ResponseUtil.successResponse(null);
    }

    /** 绑定数字员工到成员 */
    public ResponseUtil<Void> bindMemberAgent(Map<String, Object> params) {
        Long memberId = Long.valueOf(params.get("memberId").toString());
        Long agentId = Long.valueOf(params.get("agentId").toString());
        projectMemberService.bindAgent(memberId, agentId);
        return ResponseUtil.successResponse(null);
    }

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
