package com.iwhalecloud.byai.manager.application.service.devloop;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.files.FileStatus;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import com.iwhalecloud.byai.manager.application.service.job.DevloopPatService;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.domain.devloop.service.*;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFilePathResolver;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFileStorage;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileSaveDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareTargetDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ScanSourceDTO;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskListQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskStateDto;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskViewDto;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.devloop.*;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectShareTargetMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectSessionMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanLogItemMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionExtMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectQo;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectSessionQo;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.file.service.FileService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.util.threadPoolUti.ThreadPoolUtil;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.MediaTypeFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.io.ByteArrayOutputStream;

import java.io.InputStream;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.concurrent.Executor;

/**
 * 研发闭环应用服务 聚合项目管理、扫描源管理、扫描执行、日志查询、PAT管理、钉钉群搜索等业务逻辑
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

    private static final String DELETE_FLAG_NORMAL = "0";

    private static final String DELETE_FLAG_DELETED = "1";

    private static final String PROJECT_TYPE_DEFAULT = "default";

    /** 所有用户共用的默认项目分组 ID，查询会话时必须再按创建人隔离。 */
    private static final Long DEFAULT_PROJECT_ID = -1L;

    /** v2 状态投影终态；只有明确完成的任务才释放 agent 并发额度。 */
    private static final String TASK_STATUS_COMPLETED = "completed";

    /** 单个数字员工并发运行任务上限的全局配置键；缺省 1，超过则该 agent 本轮不再接新任务，避免 codeagent OOM。 */
    private static final String AGENT_MAX_CONCURRENT_CODE = "DEVLOOP_AGENT_MAX_CONCURRENT";

    private static final int AGENT_MAX_CONCURRENT_DEFAULT = 1;

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
    private ProjectShareFileService projectShareFileService;

    @Autowired
    private FilesApplicationService filesApplicationService;

    @Autowired
    private FileService fileService;

    @Autowired
    private CommonFileStorage commonFileStorage;

    @Autowired
    private CommonFilePathResolver commonFilePathResolver;

    @Autowired
    private UserBucketNamingService userBucketNamingService;

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

        // 项目会话列表按 byai_session.project_id 查询，关系表仅用于保留归属历史，绑定时必须同步主记录。
        session.setProjectId(projectId);
        session.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        session.setUpdateTime(now);
        byaiSessionMapper.updateById(session);

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
        List<Map<String, Object>> list = scanSourceService.listByProjectId(projectId).stream()
            .map(this::scanSourceToVo).collect(java.util.stream.Collectors.toList());
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
     * 按项目一次查全部需求(action=created)，DB 层按创建时间倒序，供需求列表直查。
     * 只查两次(源列表 + 条目 IN 源)，替代前端逐源循环请求(N+1)与内存排序；顺带回填 sourceName/sourceType。
     */
    public ResponseUtil<List<Map<String, Object>>> listRequirementsByProject(Long projectId) {
        return listRequirementsByProject(projectId, null);
    }

    /** 按项目查询已收集需求，并按标题和内容筛选匹配的条目。 */
    public ResponseUtil<List<Map<String, Object>>> listRequirementsByProject(Long projectId, String keyword) {
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
        List<ScanLogItem> items = scanLogService.listCreatedItemsBySources(sourceIds, keyword);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ScanLogItem item : items) {
            list.add(toRequirementMap(item, sourceById.get(item.getSourceId())));
        }
        return ResponseUtil.successResponse(list);
    }

    private Map<String, Object> toRequirementMap(ScanLogItem item) {
        return toRequirementMap(item, null);
    }

    /** 扫描条目转前端需求视图，统一各需求列表接口字段口径；source 非空时回填来源名/类型。 */
    private Map<String, Object> toRequirementMap(ScanLogItem item, ScanSource source) {
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
        map.put("sourceId", item.getSourceId());
        if (source != null) {
            map.put("sourceName", source.getSourceName());
            map.put("sourceType", source.getSourceType());
        }
        return map;
    }

    @Autowired
    private UserPrivateParamMapper userPrivateParamMapper;

    /** 保存GitHub PAT，SM4加密存储 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> saveGitHubPat(String pat) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        String paramKey = "GH_TOKEN";

        LambdaQueryWrapper<UserPrivateParam> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(UserPrivateParam::getUserId, userId)
            .eq(UserPrivateParam::getParamKey, paramKey)
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
        wrapper.eq(UserPrivateParam::getUserId, userId)
            .eq(UserPrivateParam::getParamKey, paramKey)
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
     * 定时扫描完成后按确认规则自动派生任务，并在项目内做负载均衡：
     * auto=全部待派；score=综合分达阈值(默认70)才待派；manual=不派。
     * 候选执行人=项目内绑定了数字员工的成员；按各自当前「进行中」任务数从低到高选，
     * 单 agent 并发达上限(全局 cap，默认1)则跳过，避免一股脑丢给 codeagent 导致 OOM。
     * 全员已满则本轮不派，留待下轮重新捞取未启动需求（轻量排队）。
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
            log.info("[DevloopAuto] 源 {} 派发汇总: 新增{} 重捞{} 候选员工{} cap{} -> 实际派{} 满cap跳过{} 失败{}",
                source.getSourceId(), newCount, requeueCount, candidates.size(), cap, dispatched, skippedByCap, failed);
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
     * 收集本源待派需求：本轮新增 + 历史未启动(sessionId=null)，按 itemId 去重。
     * score 模式仅保留综合分达阈值者。历史未启动的参与，实现全忙跳过后下轮自动补派。
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
        + "5. 如需求描述不清或存在阻塞，明确说明遇到的问题。\n"
        + "6. 使用 self-developed-rules skill 持续维护任务状态、阶段、证据与交付物。\n\n"
        + "请开始处理。";

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
        // 任务视图来自会话数据，关键字同时匹配会话标题和摘要，分页总数与前端搜索结果一致。
        if (StringUtils.isNotBlank(query.getKeyword())) {
            String keyword = query.getKeyword().trim();
            wrapper.and(condition -> condition.like(ByaiSession::getSessionName, keyword)
                .or()
                .like(ByaiSession::getSessionContent, keyword));
        }
        if (DEFAULT_PROJECT_ID.equals(query.getProjectId())) {
            // 默认项目共用 -1 分组，查询时必须按当前创建人隔离，避免读取其他账号的会话任务。
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
        return ResponseUtil.successResponse(
            sessionAsTask(session, tryReadTaskState(session), resolveTaskContext(session)));
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
     * 查询任务代码变更:本地优先,远程兜底。
     * 本地=直接读宿主机会话工作区的 git 仓库跑 git diff,含未 push/未 commit 的最新改动;
     * 工作区不存在或不是 git 仓库时,回退到 GitHubCompareService 的远程 compare(仅覆盖已 push 分支)。
     * base=仓库 defaultBranch(默认 main),head=任务分支(与详情同口径 buildBranchName)。
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
                ? repo.getDefaultBranch() : "main";
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
     * 查询任务单个文件的本地 diff(unified 文本),供前端 modal 逐行渲染。仅本地工作区口径;
     * 工作区不可用或出错时返回 status 非 ok,前端提示,不抛异常。
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
                ? repo.getDefaultBranch() : "main";
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
     * 拼会话工作区里 git 仓库的宿主机绝对路径:{nfs根}/{bucket}/by/.sessions/{sessionId}/{repoName}。
     * bucket 由创建者 userCode 解析;repoName 取 repoFullName 去掉 owner/ 前缀。任一环节缺失返回 null(走远程兜底)。
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
        ctx.put("agentName", agentResource != null && agentResource.getResourceName() != null
            ? agentResource.getResourceName() : "");
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
        return listProjectMembers(projectId, null);
    }

    /** 查询项目成员列表，并按姓名、账号和已绑定数字员工名称筛选。 */
    public ResponseUtil<List<ProjectMemberListDto>> listProjectMembers(Long projectId, String keyword) {
        return ResponseUtil.successResponse(projectMemberService.listProjectMembers(projectId, StringUtils.trimToNull(keyword)));
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

    // ========== 分享到空间 ==========

    /**
     * 保存到项目空间。
     *
     * @param dto 请求参数（projectId、sessionId、filePath、fileName）
     */
    public void saveShareToSpace(ProjectShareFileSaveDto dto) {

        Long projectId = dto.getProjectId();
        Long sessionId = dto.getSessionId();
        String filePath = dto.getFilePath();
        String fileName = dto.getFileName();

        // 获取文件名
        if (StringUtil.isEmpty(fileName)) {
            fileName = StringUtils.substringAfterLast(filePath, "/");
        }

        // 根据文件名获取类型
        MediaType mediaType = MediaTypeFactory.getMediaType(fileName).orElse(MediaType.APPLICATION_OCTET_STREAM);

        String bucketName = userBucketNamingService.buildUserBucketName(CurrentUserHolder.getCurrentUserCode());
        try (InputStream inputStream = filesApplicationService.openCommonFileInputStream(bucketName, filePath)) {

            // 提取文件信息
            String path = "/" + projectId + "/" + sessionId + "/" + fileName;

            StorageLocation location = commonFilePathResolver.projectShare(path);
            FileMetadata fileMetadata = commonFileStorage.write(location, inputStream.readAllBytes(),
                mediaType.toString());

            logger.info("当前上传文件:{}", JSON.toJSONString(fileMetadata));

            String fileUrl = "/commonFile/preview?style=minio&bucketName={bucketName}&filePath={filePath}";
            fileUrl = fileUrl.replace("{bucketName}", location.getBucketOrRoot()).replace("{filePath}",
                location.getPath());

            Files byaiFiles = new Files();
            byaiFiles.setFileId(sequenceService.nextVal());
            byaiFiles.setChatId(sessionId);
            byaiFiles.setFileName(fileName);
            byaiFiles.setConvertFileName(fileName);
            byaiFiles.setFileUrl(fileUrl);
            byaiFiles.setFileType(fileMetadata.getFileType());
            byaiFiles.setCreateBy(CurrentUserHolder.getCurrentUserId());
            byaiFiles.setCompleteTime(new Date());
            byaiFiles.setFileSystemType(fileMetadata.getStorageType());
            byaiFiles.setContentType(fileMetadata.getContentType());
            byaiFiles.setLength(fileMetadata.getFileSize());
            byaiFiles.setFileStatus(FileStatus.STATUS_00A);
            byaiFiles.setProjectId(projectId);
            fileService.save(byaiFiles);

            // 保存文件分享
            projectShareFileService.save(projectId, byaiFiles.getFileId(), null);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
    }

    /**
     * 查询空间文件列表。
     *
     * @param dto 查询条件（projectId）
     * @return 空间文件列表
     */
    public List<ProjectShareFileListDto> listSpaceFiles(ProjectShareFileQueryDto dto) {
        return projectShareFileService.listSpaceFiles(dto.getProjectId());
    }
}
