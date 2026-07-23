package com.iwhalecloud.byai.manager.application.service.devloop;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.MediaTypeFactory;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.devloop.DeleteFlag;
import com.iwhalecloud.byai.common.constants.devloop.MemberRole;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.constants.files.FileStatus;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectSessionService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectShareFileService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanSourceService;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFilePathResolver;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFileStorage;
import com.iwhalecloud.byai.manager.dto.devloop.MemberBatchDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileSaveDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareTargetDTO;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectMember;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectSession;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectShareTarget;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectSessionMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectShareTargetMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectQo;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectSessionQo;
import com.iwhalecloud.byai.state.domain.file.service.FileService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

import lombok.extern.slf4j.Slf4j;

/**
 * 项目管理应用服务。
 * <p>
 * 负责项目 CRUD、仓库、会话绑定与空间文件分享。
 */
@Slf4j
@Service
public class ProjectApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(ProjectApplicationService.class);

    private static final String PROJECT_TYPE_DEFAULT = "default";

    @Autowired
    private FileService fileService;

    @Autowired
    private ProjectService projectService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private ByaiSessionMapper byaiSessionMapper;

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    @Autowired
    private ScanSourceService scanSourceService;

    @Autowired
    private CommonFileStorage commonFileStorage;

    @Autowired
    private ProjectMemberService projectMemberService;

    @Autowired
    private ProjectSessionMapper projectSessionMapper;

    @Autowired
    private ProjectSessionService projectSessionService;

    @Autowired
    private CommonFilePathResolver commonFilePathResolver;

    @Autowired
    private FilesApplicationService filesApplicationService;

    @Autowired
    private ProjectShareFileService projectShareFileService;

    @Autowired
    private UserBucketNamingService userBucketNamingService;

    @Autowired
    private ProjectShareTargetMapper projectShareTargetMapper;

    /**
     * 分页查询用户可见项目
     *
     * @param projectQo 查询对象
     * @return PageInfo<ProjectListDto>
     */
    public PageInfo<ProjectListDto> selectProjectsByQo(ProjectQo projectQo) {
        projectQo.setCreateBy(CurrentUserHolder.getCurrentUserId());
        return projectService.selectProjectsByQo(projectQo);
    }

    /**
     * 创建项目，可同时写入仓库与分享成员。
     *
     * @param dto 项目信息
     * @return 新建项目
     */
    public Project createProject(ProjectDTO dto) {
        String projectName = normalizeProjectName(dto.getProjectName());
        if (projectName.isEmpty()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.name.required");
        }
        if (projectService.existsProjectName(projectName, null)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.name.duplicate");
        }

        Project project = new Project();
        project.setProjectId(sequenceService.nextVal());
        project.setProjectName(projectName);
        project.setDescription(dto.getDescription());
        project.setResourceId(dto.getResourceId());
        project.setProjectType(dto.getProjectType() != null ? dto.getProjectType() : "normal");
        project.setIsShare(dto.getIsShare() != null ? dto.getIsShare() : Constants.NO_VALUE_N);
        project.setCreateBy(CurrentUserHolder.getCurrentUserId());
        project.setCreateTime(new Date());
        project.setDeleteFlag(DeleteFlag.NORMAL);
        projectService.save(project);

        saveProjectRepos(project.getProjectId(), dto.getRepos());
        if (Constants.YES_VALUE_Y.equalsIgnoreCase(project.getIsShare())) {
            this.saveOrUpdateProjectMember(project.getProjectId(), dto.getShareTargets());
        }

        // 创建者自动加为 owner 成员
        projectMemberService.addMember(project.getProjectId(), CurrentUserHolder.getCurrentUserId(),
            MemberRole.OWNER);

        return project;
    }

    /**
     * 查询当前用户可见的项目列表。
     *
     * @param projectQo 查询条件
     * @return 项目列表
     */
    public List<ProjectListDto> listProjects(ProjectQo projectQo) {
        projectQo.setCreateBy(CurrentUserHolder.getCurrentUserId());
        return projectService.listProjects(projectQo);
    }

    /**
     * 更新项目基础信息，传入 repos 时整体替换仓库列表。
     *
     * @param dto 含 projectId 及待更新字段
     */
    public void updateProject(ProjectDTO dto) {
        Project project = projectService.findById(dto.getProjectId());

        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.not.found");
        }

        if (dto.getProjectName() != null) {
            String projectName = normalizeProjectName(dto.getProjectName());
            if (projectName.isEmpty()) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.name.required");
            }
            if (projectService.existsProjectName(projectName, dto.getProjectId())) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.name.duplicate");
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
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.default.type.change.forbidden");
            }
            if (!PROJECT_TYPE_DEFAULT.equals(project.getProjectType())
                && PROJECT_TYPE_DEFAULT.equals(dto.getProjectType())) {
                // 默认项目不允许通过编辑接口手动创建，避免普通项目被改成系统内置分组。
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.type.to.default.forbidden");
            }
            project.setProjectType(dto.getProjectType());
        }
        if (PROJECT_TYPE_DEFAULT.equals(project.getProjectType())) {
            if (dto.getIsShare() != null && !Constants.NO_VALUE_N.equalsIgnoreCase(dto.getIsShare())) {
                // 默认项目不支持共享成员配置，接口层固定为否，避免绕过前端打开共享。
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.default.share.forbidden");
            }
            project.setIsShare(Constants.NO_VALUE_N);
        }
        else if (dto.getIsShare() != null) {
            project.setIsShare(dto.getIsShare());
        }
        project.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        project.setUpdateTime(new Date());
        projectService.update(project);
        if (dto.getRepos() != null) {
            // 接口文档 update 支持 repos，传入时以前端提交的仓库列表为准做整体替换。
            projectRepoMapper
                .delete(new LambdaQueryWrapper<ProjectRepo>().eq(ProjectRepo::getProjectId, dto.getProjectId()));
            saveProjectRepos(dto.getProjectId(), dto.getRepos());
        }

        // 如果不分享的，移除分享成员
        if (Constants.NO_VALUE_N.equalsIgnoreCase(project.getIsShare())) {
            projectMemberService.removeMember(project.getProjectId(), MemberRole.MEMBER);
        }
        else if (dto.getShareTargets() != null) {
            this.saveOrUpdateProjectMember(project.getProjectId(), dto.getShareTargets());
        }
    }

    /**
     * 增量添加分享成员，已存在则跳过。
     *
     * @param projectId 项目 ID
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
                projectMemberService.addMember(projectId, userId, MemberRole.MEMBER);
            }
        }
    }

    /**
     * 软删除项目，幂等处理，默认项目禁止删除。
     *
     * @param projectId 项目 ID
     */
    public void deleteProject(Long projectId) {
        Project project = projectService.findById(projectId);
        if (project == null) {
            // 删除操作按幂等处理，列表旧数据或重复提交时不再把已不存在项目暴露成报错。
            log.warn("Delete project ignored because project not found, projectId={}", projectId);
            return;
        }
        if (DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            // 已经软删除的项目再次删除视为成功，前端刷新列表后会自然消失。
            log.warn("Delete project ignored because project already deleted, projectId={}", projectId);
            return;
        }
        if (PROJECT_TYPE_DEFAULT.equals(project.getProjectType())) {
            // 默认项目是系统内置分组，接口层兜底禁止删除，避免绕过前端操作入口。
            log.warn("Delete project rejected because project is default, projectId={}", projectId);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.default.delete.forbidden");
        }
        project.setDeleteFlag(DeleteFlag.DELETED);
        project.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        project.setUpdateTime(new Date());
        projectService.update(project);
    }

    /**
     * 查询项目成员列表，可按成员姓名筛选。
     *
     * @param projectId 项目 ID
     * @param userName 成员姓名，可为空
     * @return 成员列表
     */
    public List<ProjectMemberListDto> listProjectMembers(Long projectId, String userName) {
        return projectMemberService.listProjectMembers(projectId, StringUtils.trimToNull(userName));
    }

    /**
     * 添加项目成员；若项目未共享则同步开启共享。
     *
     * @param params 含 projectId、userId
     */
    public void addProjectMember(Map<String, Object> params) {
        Long projectId = MapParamUtil.getLongValue(params, "projectId");
        Long userId = MapParamUtil.getLongValue(params, "userId");

        Project project = projectService.findById(projectId);
        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.not.found");
        }
        if (projectMemberService.isMember(projectId, userId)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.member.already.exists");
        }
        projectMemberService.addMember(projectId, userId, MemberRole.MEMBER);
        if (!Constants.YES_VALUE_Y.equals(project.getIsShare())) {
            // 从成员 tab 主动添加成员时，项目已经具备共享成员，需同步项目共享状态。
            project.setIsShare(Constants.YES_VALUE_Y);
            project.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            project.setUpdateTime(new Date());
            projectService.update(project);
        }
    }

    /**
     * 移除项目成员，项目创建者不可移除。
     *
     * @param memberId 成员记录 ID
     */
    public void removeProjectMember(Long memberId) {
        ProjectMember member = projectMemberService.getById(memberId);
        if (member != null) {
            Project project = projectService.findById(member.getProjectId());
            if (project != null && project.getCreateBy() != null && project.getCreateBy().equals(member.getUserId())) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.member.creator.remove.forbidden");
            }
        }
        projectMemberService.removeMember(memberId);
    }

    /**
     * 批量添加项目成员。
     *
     * @param memberBatchDTO 含 projectId、userIds
     */
    public void batchAddProjectMembers(MemberBatchDTO memberBatchDTO) {
        Long projectId = memberBatchDTO.getProjectId();
        List<Long> userIds = memberBatchDTO.getUserIds();
        if (ListUtil.isEmpty(userIds)) {
            return;
        }

        for (Long userId : userIds) {
            ProjectMember projectMember = projectMemberService.findByProjectAndUser(projectId, userId);
            if (projectMember == null) {
                projectMemberService.addMember(projectId, userId, MemberRole.MEMBER);
            }
        }
    }

    /**
     * 批量移除项目成员。
     *
     * @param memberBatchDTO 含 projectId、userIds
     */
    public void batchRemoveProjectMembers(MemberBatchDTO memberBatchDTO) {
        Long projectId = memberBatchDTO.getProjectId();

        List<Long> userIds = memberBatchDTO.getUserIds();

        if (ListUtil.isEmpty(userIds)) {
            return;
        }

        for (Long userId : userIds) {
            ProjectMember projectMember = projectMemberService.findByProjectAndUser(projectId, userId);
            // 存在当前成员，并且不是创建人
            if (projectMember != null && !MemberRole.OWNER.equalsIgnoreCase(projectMember.getRole())) {
                projectMemberService.removeMember(projectMember.getMemberId());
            }
        }
    }

    /**
     * 绑定数字员工到项目成员。
     *
     * @param params 含 memberId、agentId
     */
    public void bindMemberAgent(Map<String, Object> params) {
        Long memberId = MapParamUtil.getLongValue(params, "memberId");
        Long agentId = MapParamUtil.getLongValue(params, "agentId");
        projectMemberService.bindAgent(memberId, agentId);
    }

    /**
     * 查询项目详情，含仓库、分享对象与会话。
     *
     * @param projectId 项目 ID
     * @return 项目详情
     */
    public Map<String, Object> getProject(Long projectId) {
        Project project = projectService.findById(projectId);
        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.not.found");
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
        return map;
    }

    /**
     * 规范化项目名称。
     *
     * @param projectName 原始名称
     * @return 去首尾空格后的名称
     */
    private String normalizeProjectName(String projectName) {
        return projectName == null ? "" : projectName.trim();
    }

    /**
     * 查询项目会话列表，关联表缺失时返回空列表。
     *
     * @param projectId 项目 ID
     * @return 会话列表
     */
    private List<ByaiSessionDto> safeListProjectSessions(Long projectId) {
        return projectSessionMapper.selectSessionsByProjectId(projectId);

    }

    /**
     * 判断是否为项目分享对象表不存在异常。
     *
     * @param error 异常
     * @return true 表示表不存在
     */
    private boolean isProjectShareTableMissing(Throwable error) {
        return isTableMissing(error, "byai_project_share");
    }

    /**
     * 判断异常链中是否包含指定表不存在错误。
     *
     * @param error 异常
     * @param tableName 表名
     * @return true 表示表不存在
     */
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

    /**
     * 批量保存项目仓库。
     *
     * @param projectId 项目 ID
     * @param repos 仓库列表
     */
    private void saveProjectRepos(Long projectId, List<ProjectRepoDTO> repos) {
        if (repos == null) {
            return;
        }
        for (ProjectRepoDTO repoDto : repos) {
            insertProjectRepo(projectId, repoDto);
        }
    }

    /**
     * 插入单条项目仓库，仓库全名为空则跳过。
     *
     * @param projectId 项目 ID
     * @param repoDto 仓库信息
     * @return 插入后的仓库实体，跳过时返回 null
     */
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

    /**
     * 新增单个项目仓库。
     *
     * @param dto 含 projectId、repoFullName
     * @return 新建仓库基本信息
     */
    public Map<String, Object> createProjectRepo(ProjectRepoDTO dto) {
        if (dto == null || dto.getProjectId() == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.id.required");
        }
        if (dto.getRepoFullName() == null || dto.getRepoFullName().trim().isEmpty()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.repo.name.required");
        }
        ProjectRepo repo = insertProjectRepo(dto.getProjectId(), dto);
        Map<String, Object> result = new HashMap<>();
        result.put("repoId", repo.getRepoId());
        result.put("repoFullName", repo.getRepoFullName());
        result.put("repoUrl", repo.getRepoUrl());
        result.put("defaultBranch", repo.getDefaultBranch());
        return result;
    }

    /**
     * 删除项目仓库，已被扫描源关联时拒绝删除。
     *
     * @param repoId 仓库 ID
     */
    public void deleteProjectRepo(Long repoId) {
        if (repoId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.repo.id.required");
        }
        Long boundCount = scanSourceService.countByRepoId(repoId);
        if (boundCount != null && boundCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("project.repo.bound", boundCount));
        }
        projectRepoMapper.deleteById(repoId);
    }

    /**
     * 查询项目分享对象列表。
     *
     * @param projectId 项目 ID
     * @return 分享对象列表
     */
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

    /**
     * 查询项目分享对象，分享表缺失时返回空列表。
     *
     * @param projectId 项目 ID
     * @return 分享对象列表
     */
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

    /**
     * 绑定会话到项目，一个会话仅保留一个有效项目归属。
     *
     * @param projectId 项目 ID
     * @param sessionId 会话 ID
     */
    public void bindProjectSession(Long projectId, Long sessionId) {
        Project project = projectService.findById(projectId);
        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.not.found");
        }
        ByaiSession session = byaiSessionMapper.selectById(sessionId);
        if (session == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.session.not.found");
        }

        String currentUserId = String.valueOf(CurrentUserHolder.getCurrentUserId());
        Date now = new Date();

        // 项目会话列表按 byai_session.project_id 查询，关系表仅用于保留归属历史，绑定时必须同步主记录。
        session.setProjectId(projectId);
        session.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        session.setUpdateTime(now);
        byaiSessionMapper.updateById(session);

        ProjectSession archivedRelation = new ProjectSession();
        archivedRelation.setDeleteFlag(DeleteFlag.DELETED);
        archivedRelation.setUpdateBy(currentUserId);
        archivedRelation.setUpdateTime(now);
        projectSessionMapper.update(archivedRelation,
            new LambdaUpdateWrapper<ProjectSession>().eq(ProjectSession::getSessionId, sessionId)
                .eq(ProjectSession::getDeleteFlag, DeleteFlag.NORMAL).ne(ProjectSession::getProjectId, projectId));

        LambdaQueryWrapper<ProjectSession> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectSession::getProjectId, projectId).eq(ProjectSession::getSessionId, sessionId);
        List<ProjectSession> existingRelations = projectSessionMapper.selectList(wrapper);
        if (!existingRelations.isEmpty()) {
            ProjectSession relation = existingRelations.get(0);
            relation.setDeleteFlag(DeleteFlag.NORMAL);
            relation.setUpdateBy(currentUserId);
            relation.setUpdateTime(now);
            projectSessionMapper.updateById(relation);
            return;
        }

        ProjectSession relation = new ProjectSession();
        relation.setRelationId(sequenceService.nextVal());
        relation.setProjectId(projectId);
        relation.setSessionId(sessionId);
        relation.setCreateBy(currentUserId);
        relation.setCreateTime(now);
        relation.setDeleteFlag(DeleteFlag.NORMAL);
        projectSessionMapper.insert(relation);
    }

    /**
     * 取消项目与会话的有效关联，软删除并保留历史。
     *
     * @param projectId 项目 ID
     * @param sessionId 会话 ID
     */
    public void unbindProjectSession(Long projectId, Long sessionId) {
        ProjectSession relation = new ProjectSession();
        relation.setDeleteFlag(DeleteFlag.DELETED);
        relation.setUpdateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        relation.setUpdateTime(new Date());
        projectSessionMapper.update(relation,
            new LambdaUpdateWrapper<ProjectSession>().eq(ProjectSession::getProjectId, projectId)
                .eq(ProjectSession::getSessionId, sessionId).eq(ProjectSession::getDeleteFlag, DeleteFlag.NORMAL));
    }

    /**
     * 按项目分页查询关联会话。
     *
     * @param projectSessionQo 含 projectId，可带分页与关键字
     * @return 会话分页结果
     */
    public PageInfo<ByaiSessionDto> listSessionsByProject(ProjectSessionQo projectSessionQo) {
        if (projectSessionQo.getProjectId() == null) {
            return PageHelperUtil.emptyPage(projectSessionQo.getPageNum(), projectSessionQo.getPageSize());
        }

        projectSessionQo.setCreateBy(CurrentUserHolder.getCurrentUserId());

        return projectSessionService.listSessionsByProject(projectSessionQo);
    }

    /**
     * 将会话文件复制保存到项目空间。
     *
     * @param dto 含 projectId、sessionId、filePath、fileName
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
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.share.save.failed", e);
        }
    }

    /**
     * 查询项目空间文件列表。
     *
     * @param dto 含 projectId
     * @return 空间文件列表
     */
    public List<ProjectShareFileListDto> listSpaceFiles(ProjectShareFileQueryDto dto) {
        if (dto == null || dto.getProjectId() == null || dto.getProjectId() == 0L) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.id.required");
        }
        return projectShareFileService.listSpaceFiles(dto.getProjectId());
    }

}
