package com.iwhalecloud.byai.manager.application.service.devloop;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
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
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanLogService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanSourceService;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFilePathResolver;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFileStorage;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectListDto;
import com.iwhalecloud.byai.manager.dto.devloop.MemberBatchDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberSaveDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileDeleteDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileRenameDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileSaveDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareTargetDTO;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectMember;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.entity.devloop.ScanRequireItem;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectQo;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectSessionQo;
import com.iwhalecloud.byai.state.domain.file.service.FileService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.MediaTypeFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.UriComponentsBuilder;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

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

    /** 手工需求复用的内部扫描源类型，仓库关联实际保存于单条需求 JSON。 */
    private static final String MANUAL_SOURCE_TYPE = "manual";

    /** 手工需求内容 JSON 的命名空间，与需求创建和编辑链路保持一致。 */
    private static final String MANUAL_REQUIREMENT_CONTENT_KEY = "manualRequirement";

    @Autowired
    private FileService fileService;

    @Autowired
    private ProjectService projectService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    @Autowired
    private ScanSourceService scanSourceService;

    @Autowired
    private ScanLogService scanLogService;

    @Autowired
    private CommonFileStorage commonFileStorage;

    @Autowired
    private ProjectMemberService projectMemberService;

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
        // 成员列表需要以当前登录用户为第二优先级，排序逻辑由查询 SQL 统一处理。
        return projectMemberService.listProjectMembers(projectId, StringUtils.trimToNull(userName),
            CurrentUserHolder.getCurrentUserId());
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
     * 按前端提交的当前成员列表整体保存项目普通成员。
     * <p>
     * 项目创建者始终保留：即使请求列表未携带创建者，也不会删除其成员记录；
     * 其余成员按最终列表一次性完成删除和批量新增，避免前端逐个调用删除接口。
     *
     * @param dto 含项目 ID 与当前成员用户 ID 列表的请求参数
     */
    @Transactional(rollbackFor = Exception.class)
    public void saveProjectMembers(ProjectMemberSaveDto dto) {
        if (dto == null || dto.getProjectId() == null || dto.getUserIds() == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.member.user.ids.required");
        }

        Project project = projectService.findById(dto.getProjectId());
        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.not.found");
        }

        Set<Long> selectedUserIds = new LinkedHashSet<>();
        for (Long userId : dto.getUserIds()) {
            addProjectMemberUserId(selectedUserIds, userId);
        }

        Long creatorId = project.getCreateBy();
        List<ProjectMember> existingMembers = projectMemberService.listByProjectId(project.getProjectId());
        Set<Long> existingUserIds = new HashSet<>();
        List<Long> memberIdsToRemove = new ArrayList<>();
        boolean creatorMemberExists = false;
        for (ProjectMember member : existingMembers) {
            Long memberUserId = member.getUserId();
            if (memberUserId != null) {
                existingUserIds.add(memberUserId);
            }
            if (creatorId != null && creatorId.equals(memberUserId)) {
                // 创建者即使未出现在请求成员列表中，也必须保留其成员记录。
                creatorMemberExists = true;
                continue;
            }
            if (memberUserId != null && !selectedUserIds.contains(memberUserId)) {
                memberIdsToRemove.add(member.getMemberId());
            }
        }

        if (!memberIdsToRemove.isEmpty()) {
            projectMemberService.removeMembers(memberIdsToRemove);
        }

        if (creatorId != null && !creatorMemberExists) {
            // 兼容历史项目缺失 owner 成员记录的情况，整体保存时补齐创建者。
            projectMemberService.addMember(project.getProjectId(), creatorId, "owner");
            existingUserIds.add(creatorId);
        }

        List<Long> userIdsToAdd = new ArrayList<>();
        for (Long selectedUserId : selectedUserIds) {
            if (!existingUserIds.contains(selectedUserId)) {
                userIdsToAdd.add(selectedUserId);
            }
        }
        projectMemberService.addMembers(project.getProjectId(), userIdsToAdd, "member");
        if (!userIdsToAdd.isEmpty() && !Constants.YES_VALUE_Y.equals(project.getIsShare())) {
            // 通过成员整体保存新增普通成员时，与旧新增成员接口保持一致地开启项目共享。
            project.setIsShare(Constants.YES_VALUE_Y);
            project.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            project.setUpdateTime(new Date());
            projectService.update(project);
        }
    }

    /**
     * 过滤空值和非正数用户 ID，避免非法参数被写入项目成员表。
     *
     * @param userIds 去重后的用户 ID 集合
     * @param rawUserId 原始用户 ID
     */
    private void addProjectMemberUserId(Set<Long> userIds, Object rawUserId) {
        if (rawUserId == null) {
            return;
        }
        Long userId;
        if (rawUserId instanceof Number) {
            userId = ((Number) rawUserId).longValue();
        }
        else {
            try {
                userId = Long.valueOf(String.valueOf(rawUserId));
            }
            catch (NumberFormatException exception) {
                return;
            }
        }
        if (userId > 0) {
            userIds.add(userId);
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
            Long currentUserId = CurrentUserHolder.getCurrentUserId();
            boolean isProjectCreator = project != null && Objects.equals(project.getCreateBy(), currentUserId);
            boolean isRemovingSelf = Objects.equals(member.getUserId(), currentUserId);
            if (!isProjectCreator && !isRemovingSelf) {
                // 成员移除接口仅允许创建者管理成员，或普通成员主动退出项目。
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.member.remove.forbidden");
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
     * 查询项目详情，含仓库与会话。
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
        List<ByaiSessionDto> sessions = projectSessionService.listSessionsByProjectId(projectId);

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
     * 删除项目仓库，已被扫描源或手工需求关联时拒绝删除。
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
        ProjectRepo repo = projectRepoMapper.selectById(repoId);
        long manualRequirementBoundCount = repo == null ? 0
            : countManualRequirementRepoBindings(repo.getProjectId(), repoId);
        if (manualRequirementBoundCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("project.repo.manualRequirement.bound", manualRequirementBoundCount));
        }
        projectRepoMapper.deleteById(repoId);
    }

    /**
     * 统计项目内明确关联该仓库的手工需求。仓库 ID 写在单条需求 JSON 中，不能只查项目共用 manual 扫描源。
     */
    private long countManualRequirementRepoBindings(Long projectId, Long repoId) {
        long count = 0;
        for (ScanSource source : scanSourceService.listByProjectId(projectId)) {
            if (!MANUAL_SOURCE_TYPE.equals(source.getSourceType()) || source.getSourceId() == null) {
                continue;
            }
            for (ScanRequireItem item : scanLogService.listCreatedItemsBySource(source.getSourceId())) {
                if (isManualRequirementBoundToRepo(item, repoId)) {
                    count++;
                }
            }
        }
        return count;
    }

    /**
     * 仅识别带手工需求命名空间的 JSON，历史需求未保存 repoId 时返回 false，保持原有删除行为。
     */
    private boolean isManualRequirementBoundToRepo(ScanRequireItem item, Long repoId) {
        if (item == null || StringUtils.isBlank(item.getContent()) || repoId == null) {
            return false;
        }
        try {
            JSONObject root = JSON.parseObject(item.getContent());
            JSONObject manualRequirement = root != null ? root.getJSONObject(MANUAL_REQUIREMENT_CONTENT_KEY) : null;
            return manualRequirement != null && repoId.equals(manualRequirement.getLong("repoId"));
        }
        catch (Exception ignored) {
            // 非 JSON 的扫描内容及异常历史数据不属于手工需求仓库关联。
            return false;
        }
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

    /**
     * 修改项目共享文件的展示名称；对象存储路径保持不变，避免重命名影响已有预览链接。
     *
     * @param dto 含项目 ID、文件 ID 和新文件名
     */
    public void renameShareFile(ProjectShareFileRenameDto dto) {
        Project project = validateShareFileOperation(dto == null ? null : dto.getProjectId(),
            dto == null ? null : dto.getFileId());
        String fileName = StringUtils.trimToEmpty(dto.getFileName());
        if (fileName.isEmpty() || fileName.contains("/") || fileName.contains("\\")) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.share.file.name.invalid");
        }

        Files file = fileService.findById(dto.getFileId());
        if (file == null || !Objects.equals(file.getProjectId(), project.getProjectId())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.share.file.not.found");
        }
        // 共享文件通过 fileUrl 预览，名称仅更新文件元数据即可保持已有链接可用。
        file.setFileName(fileName);
        file.setConvertFileName(fileName);
        fileService.update(file);
    }

    /**
     * 删除项目共享文件及其文件元数据；仅移除当前项目已关联的文件。
     *
     * @param dto 含项目 ID、文件 ID
     */
    @Transactional(rollbackFor = Exception.class)
    public void deleteShareFile(ProjectShareFileDeleteDto dto) {
        Project project = validateShareFileOperation(dto == null ? null : dto.getProjectId(),
            dto == null ? null : dto.getFileId());
        Files file = fileService.findById(dto.getFileId());
        if (file == null || !Objects.equals(file.getProjectId(), project.getProjectId())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.share.file.not.found");
        }

        deleteShareFileStorage(file);
        // 存储文件删除成功后，再删除项目关联和文件元数据，避免列表残留已删除文件。
        projectShareFileService.removeByProjectAndFile(project.getProjectId(), dto.getFileId());
        fileService.remove(dto.getFileId());
    }

    /**
     * 根据共享文件预览地址提取对象存储路径，并删除实际文件。
     *
     * @param file 项目共享文件元数据
     */
    private void deleteShareFileStorage(Files file) {
        try {
            String filePath = UriComponentsBuilder.fromUriString(file.getFileUrl()).build().getQueryParams()
                .getFirst("filePath");
            if (StringUtils.isBlank(filePath)) {
                throw new IllegalArgumentException("project shared file path is empty");
            }
            commonFileStorage.delete(commonFilePathResolver.projectShare(filePath));
        }
        catch (Exception e) {
            log.error("Failed to delete project shared file storage, fileId={}", file.getFileId(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.share.file.delete.failed", e);
        }
    }

    /**
     * 校验共享文件操作参数、文件归属和项目创建者权限。
     *
     * @param projectId 项目 ID
     * @param fileId 文件 ID
     * @return 已校验项目
     */
    private Project validateShareFileOperation(Long projectId, Long fileId) {
        if (projectId == null || projectId == 0L) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.id.required");
        }
        if (fileId == null || fileId == 0L) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.share.file.not.found");
        }
        Project project = projectService.findById(projectId);
        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.not.found");
        }
        if (!Objects.equals(project.getCreateBy(), CurrentUserHolder.getCurrentUserId())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.creator.operation.forbidden");
        }
        if (!projectShareFileService.existsByProjectAndFile(projectId, fileId)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.share.file.not.found");
        }
        return project;
    }

}
