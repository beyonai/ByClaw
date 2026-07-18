package com.iwhalecloud.byai.manager.application.service.devloop;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.application.service.job.DevloopPatService;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.devloop.service.*;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareTargetDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ScanSourceDTO;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.devloop.*;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectShareTargetMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectSessionMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanLogItemMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectQo;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectSessionQo;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.util.threadPoolUti.ThreadPoolUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.io.ByteArrayOutputStream;

import java.util.*;
import java.util.concurrent.Executor;

/**
 * 研发闭环应用服务 聚合项目管理、扫描源管理、扫描执行、日志查询、PAT管理、钉钉群搜索等业务逻辑
 */
@Slf4j
@Service
public class DevloopApplicationService {

    private static final String DELETE_FLAG_NORMAL = "0";

    private static final String DELETE_FLAG_DELETED = "1";

    private static final String PROJECT_TYPE_DEFAULT = "default";

    /**
     * 研发任务 LLM 对话异步执行线程池。 TtlExecutors 包装以透传 CurrentUserHolder 的 LoginInfo；任务创建接口据此立即返回， chat 在后台执行，避免前端等待数分钟。
     */
    private static final Executor TASK_CHAT_EXECUTOR = ThreadPoolUtil.getThreadPool(2, 8, 100, 60, "devloop-task-chat");

    @Autowired
    private ProjectMapper projectMapper;

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    @Autowired
    private ProjectShareTargetMapper projectShareTargetMapper;

    @Autowired
    private ProjectSessionMapper projectSessionMapper;

    @Autowired
    private ByaiSessionMapper byaiSessionMapper;

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
    private DwsAuthService dwsAuthService;

    @Autowired
    private DevloopPatService patService;

    @Autowired
    private ProjectMemberService projectMemberService;

    @Autowired
    private ProjectSessionService projectSessionService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private AssistantChatService assistantChatService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Autowired
    private DevloopScoringService scoringService;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    /** 创建项目，可同时关联代码仓库 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Map<String, Object>> createProject(ProjectDTO dto) {
        String projectName = normalizeProjectName(dto.getProjectName());
        if (projectName.isEmpty()) {
            return ResponseUtil.failRes("项目名称不能为空");
        }
        if (existsProjectName(projectName, null)) {
            return ResponseUtil.failRes("项目名称已存在");
        }

        Project project = new Project();
        project.setProjectId(sequenceService.nextVal());
        project.setProjectName(projectName);
        project.setDescription(dto.getDescription());
        project.setResourceId(dto.getResourceId());
        project.setProjectType(dto.getProjectType() != null ? dto.getProjectType() : "normal");
        project.setIsShare(dto.getIsShare() != null ? dto.getIsShare() : "N");
        project.setCreateBy(CurrentUserHolder.getCurrentUserId());
        project.setCreateTime(new Date());
        project.setDeleteFlag(DELETE_FLAG_NORMAL);
        projectMapper.insert(project);

        saveProjectRepos(project.getProjectId(), dto.getRepos());
        if (Constants.YES_VALUE_Y.equalsIgnoreCase(project.getIsShare())) {
            this.saveOrUpdateProjectMember(project.getProjectId(), dto.getShareTargets());
        }

        // 创建者自动加为 owner 成员
        projectMemberService.addMember(project.getProjectId(), CurrentUserHolder.getCurrentUserId(), "owner");

        Map<String, Object> result = new HashMap<>();
        result.put("projectId", project.getProjectId());
        return ResponseUtil.successResponse(result);
    }

    /** 查询项目列表 */
    public List<ProjectListDto> listProjects(ProjectQo projectQo) {
        ProjectQo query = projectQo == null ? new ProjectQo() : projectQo;
        query.setCreateBy(CurrentUserHolder.getCurrentUserId());
        return projectMapper.selectProjectsByQo(query);
    }

    /** 按项目管理文档修改项目基础信息，并在传入 repos 时整体替换仓库列表。 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> updateProject(ProjectDTO dto) {
        Project project = projectMapper.selectById(dto.getProjectId());

        if (project == null || DELETE_FLAG_DELETED.equals(project.getDeleteFlag())) {
            return ResponseUtil.failRes("Project not found");
        }

        if (dto.getProjectName() != null) {
            String projectName = normalizeProjectName(dto.getProjectName());
            if (projectName.isEmpty()) {
                return ResponseUtil.failRes("项目名称不能为空");
            }
            if (existsProjectName(projectName, dto.getProjectId())) {
                return ResponseUtil.failRes("项目名称已存在");
            }
            project.setProjectName(projectName);
        }
        if (dto.getDescription() != null) {
            project.setDescription(dto.getDescription());
        }
        if (dto.getResourceId() != null) {
            project.setResourceId(dto.getResourceId());
        }
        if (dto.getProjectType() != null) {
            if (PROJECT_TYPE_DEFAULT.equals(project.getProjectType())
                && !PROJECT_TYPE_DEFAULT.equals(dto.getProjectType())) {
                // 默认项目类型由系统维护，编辑时只能回显，不能被接口改成普通/研发项目。
                return ResponseUtil.failRes("默认项目不允许修改项目类型");
            }
            if (!PROJECT_TYPE_DEFAULT.equals(project.getProjectType())
                && PROJECT_TYPE_DEFAULT.equals(dto.getProjectType())) {
                // 默认项目不允许通过编辑接口手动创建，避免普通项目被改成系统内置分组。
                return ResponseUtil.failRes("项目类型不允许修改为默认项目");
            }
            project.setProjectType(dto.getProjectType());
        }
        if (PROJECT_TYPE_DEFAULT.equals(project.getProjectType())) {
            if (dto.getIsShare() != null && !Constants.NO_VALUE_N.equalsIgnoreCase(dto.getIsShare())) {
                // 默认项目不支持共享成员配置，接口层固定为否，避免绕过前端打开共享。
                return ResponseUtil.failRes("默认项目不允许共享");
            }
            project.setIsShare(Constants.NO_VALUE_N);
        }
        else if (dto.getIsShare() != null) {
            project.setIsShare(dto.getIsShare());
        }
        project.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        project.setUpdateTime(new Date());
        projectMapper.updateById(project);
        if (dto.getRepos() != null) {
            // 接口文档 update 支持 repos，传入时以前端提交的仓库列表为准做整体替换。
            projectRepoMapper
                .delete(new LambdaQueryWrapper<ProjectRepo>().eq(ProjectRepo::getProjectId, dto.getProjectId()));
            saveProjectRepos(dto.getProjectId(), dto.getRepos());
        }

        // 如果不分享的，移除分享成员
        if (Constants.NO_VALUE_N.equalsIgnoreCase(project.getIsShare())) {
            projectMemberService.removeMember(project.getProjectId(), "member");
        }
        else if (dto.getShareTargets() != null) {
            this.saveOrUpdateProjectMember(project.getProjectId(), dto.getShareTargets());
        }

        return ResponseUtil.successResponse();
    }

    /**
     * 保存或者更新项目成员
     *
     * @param projectId 项目标识
     * @param projectShareTargetDTOs 分享成员列表
     */
    private void saveOrUpdateProjectMember(Long projectId, List<ProjectShareTargetDTO> projectShareTargetDTOs) {

        if (ListUtil.isEmpty(projectShareTargetDTOs)) {
            return;
        }

        for (ProjectShareTargetDTO projectShareTargetDTO : projectShareTargetDTOs) {

            Long userId = projectShareTargetDTO.getTargetId();

            // 如果存在，则跳，不存在则添加
            ProjectMember projectMember = projectMemberService.findByProjectAndUser(projectId, userId);
            if (projectMember != null) {
                continue;
            }
            else {
                projectMemberService.addMember(projectId, userId, "member");
            }
        }
    }

    /** 软删除项目 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> deleteProject(Long projectId) {
        Project project = projectMapper.selectById(projectId);
        if (project == null) {
            // 删除操作按幂等处理，列表旧数据或重复提交时不再把已不存在项目暴露成报错。
            log.warn("Delete project ignored because project not found, projectId={}", projectId);
            return ResponseUtil.successResponse(null);
        }
        if (DELETE_FLAG_DELETED.equals(project.getDeleteFlag())) {
            // 已经软删除的项目再次删除视为成功，前端刷新列表后会自然消失。
            log.warn("Delete project ignored because project already deleted, projectId={}", projectId);
            return ResponseUtil.successResponse(null);
        }
        if (PROJECT_TYPE_DEFAULT.equals(project.getProjectType())) {
            // 默认项目是系统内置分组，接口层兜底禁止删除，避免绕过前端操作入口。
            log.warn("Delete project rejected because project is default, projectId={}", projectId);
            return ResponseUtil.failRes("默认项目不允许删除");
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
        map.put("shareTargets", safeListProjectShareTargets(projectId));
        map.put("sessions", sessions);
        map.put("sessionCount", sessions.size());
        return ResponseUtil.successResponse(map);
    }

    private String normalizeProjectName(String projectName) {
        return projectName == null ? "" : projectName.trim();
    }

    private boolean existsProjectName(String projectName, Long excludeProjectId) {
        LambdaQueryWrapper<Project> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Project::getDeleteFlag, DELETE_FLAG_NORMAL).eq(Project::getProjectName, projectName);
        if (excludeProjectId != null) {
            wrapper.ne(Project::getProjectId, excludeProjectId);
        }
        // 新建/编辑统一以后端最终入库名称为准查重，避免并发或绕过前端导致同名项目。
        Long count = projectMapper.selectCount(wrapper);
        return count != null && count > 0;
    }

    private Long safeCountProjectSessions(Long projectId) {
        try {
            Long sessionCount = projectSessionMapper.countSessionsByProjectId(projectId);
            return sessionCount == null ? 0L : sessionCount;
        }
        catch (Exception error) {
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
        }
        catch (Exception error) {
            if (isProjectSessionTableMissing(error)) {
                // 表缺失时详情页先展示项目基础信息，后续迁移补表后会话列表自动恢复。
                log.warn("Project session relation table is missing, fallback sessions empty, projectId={}", projectId);
                return Collections.emptyList();
            }
            throw error instanceof RuntimeException ? (RuntimeException) error : new IllegalStateException(error);
        }
    }

    private boolean isProjectSessionTableMissing(Throwable error) {
        return isTableMissing(error, "byai_project_session");
    }

    private boolean isProjectShareTableMissing(Throwable error) {
        return isTableMissing(error, "byai_project_share");
    }

    private boolean isTableMissing(Throwable error, String tableName) {
        Throwable current = error;
        while (current != null) {
            String message = current.getMessage();
            if (message != null) {
                String lowerMessage = message.toLowerCase(Locale.ROOT);
                if (lowerMessage.contains(tableName) && lowerMessage.contains("does not exist")) {
                    return true;
                }
            }
            current = current.getCause();
        }
        return false;
    }

    private void saveProjectRepos(Long projectId, List<ProjectRepoDTO> repos) {
        if (repos == null) {
            return;
        }
        for (ProjectRepoDTO repoDto : repos) {
            insertProjectRepo(projectId, repoDto);
        }
    }

    /** 插入单条项目仓库；全名为空则跳过。供批量保存与单独新增复用。 */
    private ProjectRepo insertProjectRepo(Long projectId, ProjectRepoDTO repoDto) {
        if (repoDto == null || repoDto.getRepoFullName() == null || repoDto.getRepoFullName().trim().isEmpty()) {
            return null;
        }
        String defaultBranch = repoDto.getDefaultBranch() != null ? repoDto.getDefaultBranch().trim() : "";
        ProjectRepo repo = new ProjectRepo();
        repo.setRepoId(sequenceService.nextVal());
        repo.setProjectId(projectId);
        repo.setRepoFullName(repoDto.getRepoFullName().trim());
        repo.setRepoUrl(repoDto.getRepoUrl() != null ? repoDto.getRepoUrl().trim() : null);
        repo.setDefaultBranch(defaultBranch.isEmpty() ? "main" : defaultBranch);
        repo.setCreateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        repo.setCreateTime(new Date());
        projectRepoMapper.insert(repo);
        return repo;
    }

    /** 新增单个项目仓库，供扫描源关联仓库时即席补充。 */
    public ResponseUtil<Map<String, Object>> createProjectRepo(ProjectRepoDTO dto) {
        if (dto == null || dto.getProjectId() == null) {
            return ResponseUtil.failRes("projectId不能为空");
        }
        if (dto.getRepoFullName() == null || dto.getRepoFullName().trim().isEmpty()) {
            return ResponseUtil.failRes("仓库全名不能为空");
        }
        ProjectRepo repo = insertProjectRepo(dto.getProjectId(), dto);
        Map<String, Object> result = new HashMap<>();
        result.put("repoId", repo.getRepoId());
        result.put("repoFullName", repo.getRepoFullName());
        result.put("repoUrl", repo.getRepoUrl());
        result.put("defaultBranch", repo.getDefaultBranch());
        return ResponseUtil.successResponse(result);
    }

    /** 删除项目仓库；已被扫描源关联时拒绝删除，避免任务丢失开发仓库。 */
    public ResponseUtil<Void> deleteProjectRepo(Long repoId) {
        if (repoId == null) {
            return ResponseUtil.failRes("repoId不能为空");
        }
        Long boundCount = scanSourceService.countByRepoId(repoId);
        if (boundCount != null && boundCount > 0) {
            return ResponseUtil.failRes("该仓库已被 " + boundCount + " 个扫描源关联，请先解除关联再删除");
        }
        projectRepoMapper.deleteById(repoId);
        return ResponseUtil.successResponse(null);
    }

    private List<Map<String, Object>> listProjectShareTargets(Long projectId) {
        LambdaQueryWrapper<ProjectShareTarget> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectShareTarget::getProjectId, projectId).orderByAsc(ProjectShareTarget::getCreateTime);
        List<ProjectShareTarget> targets = projectShareTargetMapper.selectList(wrapper);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ProjectShareTarget target : targets) {
            Map<String, Object> map = new HashMap<>();
            map.put("shareId", target.getShareId());
            map.put("projectId", target.getProjectId());
            map.put("targetType", target.getTargetType());
            map.put("targetId", target.getTargetId());
            map.put("targetName", target.getTargetName());
            map.put("createBy", target.getCreateBy());
            map.put("createTime", target.getCreateTime());
            list.add(map);
        }
        return list;
    }

    private List<Map<String, Object>> safeListProjectShareTargets(Long projectId) {
        try {
            return listProjectShareTargets(projectId);
        }
        catch (Exception error) {
            if (isProjectShareTableMissing(error)) {
                // 兼容已执行旧版 V0.3.0 但缺少项目共享对象表的环境，避免项目列表/详情整体不可用。
                log.warn("Project share target table is missing, fallback shareTargets empty, projectId={}", projectId);
                return Collections.emptyList();
            }
            throw error instanceof RuntimeException ? (RuntimeException) error : new IllegalStateException(error);
        }
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
        projectSessionMapper.update(archivedRelation,
            new LambdaUpdateWrapper<ProjectSession>().eq(ProjectSession::getSessionId, sessionId)
                .eq(ProjectSession::getDeleteFlag, DELETE_FLAG_NORMAL).ne(ProjectSession::getProjectId, projectId));

        LambdaQueryWrapper<ProjectSession> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectSession::getProjectId, projectId).eq(ProjectSession::getSessionId, sessionId);
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
        projectSessionMapper.update(relation,
            new LambdaUpdateWrapper<ProjectSession>().eq(ProjectSession::getProjectId, projectId)
                .eq(ProjectSession::getSessionId, sessionId).eq(ProjectSession::getDeleteFlag, DELETE_FLAG_NORMAL));
        return ResponseUtil.successResponse(null);
    }

    /**
     * 根据项目查询关联会话列表。 ProjectSessionQo 透传到领域服务 / mapper。
     */
    public PageInfo<ByaiSessionDto> listSessionsByProject(ProjectSessionQo projectSessionQo) {
        if (projectSessionQo.getProjectId() == null) {
            return PageHelperUtil.emptyPage(projectSessionQo.getPageNum(), projectSessionQo.getPageSize());
        }

        projectSessionQo.setCreateBy(CurrentUserHolder.getCurrentUserId());

        return projectSessionService.listSessionsByProject(projectSessionQo);
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
            map.put("repoId", s.getRepoId());
            map.put("confirmMode", s.getConfirmMode());
            map.put("scoreThreshold", s.getScoreThreshold());
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
        }
        else if ("dingtalk".equals(type)) {
            items = dingtalkScanService.scan(source);
            if (items == null) {
                return ResponseUtil.failRes("钉钉扫描失败，请检查：1) DWS是否已授权 2) 当前组织是否有消息搜索权限 3) 查看扫描日志获取详细错误");
            }
        }
        else {
            return ResponseUtil.failRes("Unknown source type: " + type);
        }

        // 先对本次新增需求 LLM 打分（供展示、排序、score 模式判定），再按确认规则派生
        scoringService.scoreItems(items);
        autoDeriveForSource(source, items);

        Map<String, Object> result = new HashMap<>();
        result.put("createdCount", items.size());
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
            Map<String, Object> map = new HashMap<>();
            map.put("itemId", item.getItemId());
            map.put("title", item.getTitle());
            // 需求列表展开态需要展示完整内容，并据 sessionId 判断是否已启动。
            map.put("content", item.getContent());
            map.put("originId", item.getOriginId());
            map.put("originUrl", item.getOriginUrl());
            map.put("action", item.getAction());
            map.put("sessionId", item.getSessionId());
            map.put("score", item.getScore());
            map.put("priority", item.getPriority());
            map.put("scoreDetail", item.getScoreDetail());
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

        LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.users.UserPrivateParam> wrapper = new LambdaQueryWrapper<>();
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
        }
        else {
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

        LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.users.UserPrivateParam> wrapper = new LambdaQueryWrapper<>();
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
     * 从需求派生任务（会话）核心逻辑，不依赖登录 ThreadLocal 取当前用户，供手动启动与定时自动派生复用。
     * userId 用于成员/agent 校验，loginInfo 透传给异步 chat（自动派生时由源创建者的 LoginInfo 构造）。
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

        // 加载需求项：提供需求详情与任务类型判定依据
        ScanLogItem sourceItem = sourceItemId != null ? scanLogItemMapper.selectById(sourceItemId) : null;
        String description = sourceItem != null && sourceItem.getContent() != null && !sourceItem.getContent().isEmpty()
            ? sourceItem.getContent()
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
     * 定时扫描完成后，按确认规则用源创建者身份为本次新增需求自动派生任务：
     * auto=全部派生；score=综合分达阈值(scoreThreshold，默认70)才派生；manual=不派生。
     * 扫描线程无登录上下文，故用 source.createBy 构造 LoginInfo 并设入 CurrentUserHolder，
     * 复用 deriveTask 后清理，避免污染线程池上下文。
     */
    public void autoDeriveForSource(ScanSource source, List<ScanLogItem> newItems) {
        if (source == null || newItems == null || newItems.isEmpty()) {
            return;
        }
        String mode = source.getConfirmMode();
        boolean autoAll = "auto".equalsIgnoreCase(mode);
        boolean byScore = "score".equalsIgnoreCase(mode);
        if (!autoAll && !byScore) {
            return;
        }
        int threshold = source.getScoreThreshold() != null ? source.getScoreThreshold() : 70;
        if (source.getCreateBy() == null || source.getCreateBy().isEmpty()) {
            log.warn("[DevloopAuto] 源 {} 无创建者，跳过自动派生", source.getSourceId());
            return;
        }
        Long ownerUserId;
        try {
            ownerUserId = Long.valueOf(source.getCreateBy());
        } catch (NumberFormatException e) {
            log.warn("[DevloopAuto] 源 {} 创建者非法 {}，跳过自动派生", source.getSourceId(), source.getCreateBy());
            return;
        }
        LoginInfo ownerLogin = loginApplicationService.getLoginInfo(ownerUserId);
        if (ownerLogin == null) {
            log.warn("[DevloopAuto] 无法加载源创建者 {} 的登录信息，跳过自动派生", ownerUserId);
            return;
        }
        LoginInfo previous = CurrentUserHolder.getLoginInfo();
        try {
            CurrentUserHolder.setLoginInfo(ownerLogin);
            // 扫描线程无外层事务，deriveTask 内每条 mapper 自动提交，单条失败不影响其余；
            // 会话即时落库，submitTaskChatAfterCommit 因无活动事务直接异步执行 chat。
            for (ScanLogItem item : newItems) {
                // score 模式：仅综合分达阈值的需求自动派生，其余留待人工确认
                if (byScore) {
                    Integer s = item.getScore();
                    if (s == null || s < threshold) {
                        continue;
                    }
                }
                try {
                    ResponseUtil<Map<String, Object>> res =
                        deriveTask(ownerUserId, ownerLogin, source.getProjectId(), item.getItemId(), item.getTitle());
                    if (res == null || res.getCode() != ResponseUtil.SUCCESS) {
                        log.warn("[DevloopAuto] 自动派生失败, item={}, msg={}", item.getItemId(),
                            res != null ? res.getMsg() : "null");
                    }
                } catch (Exception e) {
                    log.error("[DevloopAuto] 自动派生异常, item={}", item.getItemId(), e);
                }
            }
        } finally {
            // 还原上下文：线程池复用，避免把源创建者身份泄漏给后续任务
            if (previous != null) {
                CurrentUserHolder.setLoginInfo(previous);
            } else {
                CurrentUserHolder.clearLoginInfo();
            }
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
            + (item != null && item.getContent() != null ? item.getContent() : "") + " "
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
        String repoUrl = repo != null && repo.getRepoUrl() != null ? repo.getRepoUrl()
            : (repo != null ? repo.getRepoFullName() : "");
        return template.replace("${projectName}", projectName != null ? projectName : "").replace("${repoUrl}", repoUrl)
            .replace("${branchName}", branchName != null ? branchName : "")
            .replace("${taskType}", taskType != null ? taskType : "").replace("${title}", title != null ? title : "")
            .replace("${description}", description != null ? description : "");
    }

    /** 提示词模板兜底：DB 未配置 DEVLOOP_TASK_START_PROMPT 时使用 */
    private static final String DEFAULT_TASK_PROMPT_TEMPLATE = "你是 ByClaw 开发助手，负责在指定代码仓库中自主完成开发任务。\n\n" + "## 任务信息\n"
        + "- 项目：${projectName}\n" + "- 代码仓库：${repoUrl}\n" + "- 目标分支：${branchName}\n" + "- 任务类型：${taskType}\n"
        + "- 任务标题：${title}\n\n" + "## 需求详情\n${description}\n\n" + "## 仓库访问说明\n"
        + "- ${repoUrl} 可能是私有仓库，GitHub 访问令牌(PAT)已配置在环境变量 GH_TOKEN 中，请直接使用它进行克隆和推送。\n"
        + "- 克隆时用带令牌的方式拉取，例如：git clone https://$GH_TOKEN@github.com/owner/repo.git\n"
        + "- 若提示仓库不存在，通常是私有仓库权限问题，请确认已使用环境变量 GH_TOKEN 中的令牌，不要判定为仓库不存在。\n\n" + "## 工作要求\n"
        + "1. 进入仓库 ${repoUrl}，基于最新代码切出并切换到分支 ${branchName}\n" + "2. 仔细理解上述需求详情，定位需要修改的代码\n"
        + "3. 完成开发后自测，确保编译通过、相关测试通过\n" + "4. 提交改动到分支 ${branchName}，提交信息清晰说明本次改动\n" + "5. 如需求描述不清或存在阻塞，明确说明遇到的问题\n\n"
        + "请开始处理。";

    /** 查询项目任务列表：会话即任务，返回项目下的会话映射成任务形状（看板专属字段无来源，置空） */
    public ResponseUtil<List<Map<String, Object>>> listTasks(Long projectId) {
        List<ByaiSession> sessions = byaiSessionMapper.selectList(new LambdaQueryWrapper<ByaiSession>()
            .eq(ByaiSession::getProjectId, projectId).orderByDesc(ByaiSession::getCreateTime));
        List<Map<String, Object>> list = new ArrayList<>();
        for (ByaiSession s : sessions) {
            list.add(sessionAsTask(s));
        }
        return ResponseUtil.successResponse(list);
    }

    /** 查询单个任务详情：按 sessionId 取会话 */
    public ResponseUtil<Map<String, Object>> getTaskDetail(Long sessionId) {
        ByaiSession s = byaiSessionMapper.selectById(sessionId);
        if (s == null)
            return ResponseUtil.failRes("会话不存在");
        return ResponseUtil.successResponse(sessionAsTask(s));
    }

    /**
     * 会话映射为前端任务形状：taskId 复用 sessionId 保证前端按 taskId 取值与跳转不变； status/phase/score/branchName/warningTag/round
     * 等为任务专属字段，会话无来源，置空。
     */
    private Map<String, Object> sessionAsTask(ByaiSession s) {
        Map<String, Object> map = new HashMap<>();
        map.put("taskId", s.getSessionId());
        map.put("sessionId", s.getSessionId());
        map.put("projectId", s.getProjectId());
        map.put("title", s.getSessionName());
        map.put("createBy", s.getCreatorId());
        map.put("createTime", s.getCreateTime());
        map.put("status", null);
        map.put("phase", null);
        map.put("currentRound", null);
        map.put("totalRounds", null);
        map.put("score", null);
        map.put("assignee", null);
        map.put("agentName", null);
        map.put("branchName", null);
        map.put("warningTag", null);
        map.put("sourceItemId", null);
        return map;
    }

    // ========== 项目成员 ==========

    /** 添加项目成员 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> addProjectMember(Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        Long userId = Long.valueOf(params.get("userId").toString());

        Project project = projectMapper.selectById(projectId);
        if (project == null || DELETE_FLAG_DELETED.equals(project.getDeleteFlag())) {
            return ResponseUtil.failRes("Project not found");
        }
        if (projectMemberService.isMember(projectId, userId)) {
            return ResponseUtil.failRes("该用户已是项目成员");
        }
        projectMemberService.addMember(projectId, userId, "member");
        if (!"Y".equals(project.getIsShare())) {
            // 从成员 tab 主动添加成员时，项目已经具备共享成员，需同步项目共享状态。
            project.setIsShare("Y");
            project.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            project.setUpdateTime(new Date());
            projectMapper.updateById(project);
        }
        return ResponseUtil.successResponse(null);
    }

    /** 查询项目成员列表 */
    public ResponseUtil<List<ProjectMemberListDto>> listProjectMembers(Long projectId) {
        return ResponseUtil.successResponse(projectMemberService.listProjectMembers(projectId));
    }

    /** 移除项目成员 */
    public ResponseUtil<Void> removeProjectMember(Long memberId) {
        ProjectMember member = projectMemberService.getById(memberId);
        if (member != null) {
            Project project = projectMapper.selectById(member.getProjectId());
            if (project != null && project.getCreateBy() != null && project.getCreateBy().equals(member.getUserId())) {
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
