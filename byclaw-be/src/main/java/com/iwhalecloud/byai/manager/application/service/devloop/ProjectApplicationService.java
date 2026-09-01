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
import com.iwhalecloud.byai.manager.application.service.project.ProjectInitService;
import com.iwhalecloud.byai.manager.application.service.project.ProjectWorkspaceManifestService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectResourceService;
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
import com.iwhalecloud.byai.manager.dto.devloop.ProjectResourceDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileDeleteDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileRenameDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileSaveDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareTargetDTO;
import com.iwhalecloud.byai.manager.dto.resource.DatasetDto;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectMember;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectResource;
import com.iwhalecloud.byai.manager.entity.devloop.ScanRequireItem;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectQo;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectSessionQo;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
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
import java.nio.file.Path;
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

    /**
     * 项目名称前后端统一限制为 100 个字符。
     */
    private static final int PROJECT_NAME_MAX_LENGTH = 100;

    /**
     * 项目描述业务层统一限制为 500 个字符，数据库使用 TEXT 避免中文存储长度语义差异。
     */
    private static final int PROJECT_DESCRIPTION_MAX_LENGTH = 500;

    /**
     * 手工需求复用的内部扫描源类型，仓库关联实际保存于单条需求 JSON。
     */
    private static final String MANUAL_SOURCE_TYPE = "manual";

    /**
     * 手工需求内容 JSON 的命名空间，与需求创建和编辑链路保持一致。
     */
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
    private ProjectResourceService projectResourceService;

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

    @Autowired
    private ProjectInitService projectInitService;

    @Autowired
    private ProjectWorkspaceManifestService projectWorkspaceManifestService;

    @Autowired
    private DatasetApplicationService datasetApplicationService;

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
    @Transactional
    public Project createProject(ProjectDTO dto) {
        String projectName = normalizeProjectName(dto.getProjectName());
        if (projectName.isEmpty()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.name.required");
        }
        if (projectService.existsProjectName(projectName, null)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.name.duplicate");
        }
        this.validateProjectDescription(dto.getDescription());

        Project project = new Project();
        project.setProjectId(sequenceService.nextVal());
        project.setProjectName(projectName);
        project.setDescription(dto.getDescription());
        project.setResourceId(dto.getResourceId());
        // 项目类型字段已废弃，所有新项目统一按普通项目处理。
        String projectType = "normal";
        project.setProjectType(projectType);
        project.setIsShare(dto.getIsShare() != null ? dto.getIsShare() : Constants.NO_VALUE_N);
        project.setInitStatus("ready");
        project.setBuildIndex(Constants.NO_VALUE_N);
        project.setCreateBy(CurrentUserHolder.getCurrentUserId());
        project.setCreateTime(new Date());
        project.setDeleteFlag(DeleteFlag.NORMAL);
        projectService.save(project);

        saveProjectRepos(project.getProjectId(), dto.getRepos());
        saveProjectResources(project.getProjectId(), dto.getResources());
        if (Constants.YES_VALUE_Y.equalsIgnoreCase(project.getIsShare())) {
            this.saveOrUpdateProjectMember(project.getProjectId(), dto.getShareTargets());
        }

        // 创建者自动加为 owner 成员
        projectMemberService.addMember(project.getProjectId(), CurrentUserHolder.getCurrentUserId(),
            MemberRole.OWNER);

        // 创建云盘知识库并回写项目关联
        SsResource cloudResource = this.createCloudResource(project);
        project.setCloudResourceId(cloudResource.getResourceId());
        projectService.update(project);

        // 工作目录属于项目创建结果的一部分，初始化失败时由事务回滚项目数据库记录。
        projectInitService.initProjectWorkspace(project.getProjectId());
        projectWorkspaceManifestService.syncProjectGitmodules(project.getProjectId());

        return project;
    }


    /**
     * 为项目创建云盘知识库资源。
     *
     * @param project 项目实体
     * @return 新建的云盘知识库资源
     */
    public SsResource createCloudResource(Project project) {
        String projectName = project.getProjectName();
        DatasetDto datasetDto = new DatasetDto();
        datasetDto.setResourceName(I18nUtil.get("project.cloud.resource.name", projectName));
        datasetDto.setResourceDesc(I18nUtil.get("project.cloud.resource.desc", projectName));
        datasetDto.setSystemCode("BYAI");
        datasetDto.setResourceBizType("KG_DOC");
        datasetDto.setType("dataset");
        return datasetApplicationService.createDataset(datasetDto);
    }

    /**
     * 获取项目工作目录，目录不存在时自动创建。
     *
     * @param projectId 项目 ID
     * @return 项目工作目录
     */
    public Path getProjectWorkspacePath(Long projectId) {
        return projectInitService.initProjectWorkspace(projectId);
    }

    /**
     * 校验项目存在且未删除，否则抛出业务异常。
     *
     * @param projectId 项目 ID
     * @return 项目实体
     */
    private Project requireProject(Long projectId) {
        if (projectId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.id.required");
        }
        Project project = projectService.findById(projectId);
        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.not.found");
        }
        return project;
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


        //如果没有初始化云盘，创建云盘知识库
        Long cloudResourceId = project.getCloudResourceId();
        if (cloudResourceId == null) {
            SsResource cloudResource = this.createCloudResource(project);
            project.setCloudResourceId(cloudResource.getResourceId());
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
            validateProjectDescription(dto.getDescription());
            project.setDescription(dto.getDescription());
        }
        if (dto.getResourceId() != null) {
            project.setResourceId(dto.getResourceId());
        }
        if (PROJECT_TYPE_DEFAULT.equals(project.getProjectType())) {
            if (dto.getIsShare() != null && !Constants.NO_VALUE_N.equalsIgnoreCase(dto.getIsShare())) {
                // 默认项目不支持共享成员配置，接口层固定为否，避免绕过前端打开共享。
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.default.share.forbidden");
            }
            project.setIsShare(Constants.NO_VALUE_N);
        } else if (dto.getIsShare() != null) {
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
            projectWorkspaceManifestService.syncProjectGitmodules(dto.getProjectId());
        }
        if (dto.getResources() != null) {
            saveProjectResources(dto.getProjectId(), dto.getResources());
        }

        // 如果不分享的，移除分享成员
        if (Constants.NO_VALUE_N.equalsIgnoreCase(project.getIsShare())) {
            projectMemberService.removeMember(project.getProjectId(), MemberRole.MEMBER);
        } else if (dto.getShareTargets() != null) {
            this.saveOrUpdateProjectMember(project.getProjectId(), dto.getShareTargets());
        }


    }

    /**
     * 增量添加分享成员，已存在则跳过。
     *
     * @param projectId              项目 ID
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
            } else {
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
     * @param userName  成员姓名，可为空
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
     * @param userIds   去重后的用户 ID 集合
     * @param rawUserId 原始用户 ID
     */
    private void addProjectMemberUserId(Set<Long> userIds, Object rawUserId) {
        if (rawUserId == null) {
            return;
        }
        Long userId;
        if (rawUserId instanceof Number) {
            userId = ((Number) rawUserId).longValue();
        } else {
            try {
                userId = Long.valueOf(String.valueOf(rawUserId));
            } catch (NumberFormatException exception) {
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
     * 解除项目成员与数字员工的绑定关系。
     *
     * @param params 含 memberId
     */
    public void unbindMemberAgent(Map<String, Object> params) {
        Long memberId = MapParamUtil.getLongValue(params, "memberId");
        projectMemberService.unbindAgent(memberId);
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
        List<ProjectResource> resources = projectResourceService.listByProjectId(projectId);

        Map<String, Object> map = new HashMap<>();
        map.put("projectId", project.getProjectId());
        map.put("projectName", project.getProjectName());
        map.put("description", project.getDescription());
        map.put("resourceId", project.getResourceId());
        map.put("isShare", project.getIsShare());
        // 研发项目初始化状态与配置:前端据此拦截建需求/启动任务并展示初始化中指示。
        map.put("initStatus", project.getInitStatus());
        map.put("buildIndex", project.getBuildIndex());
        map.put("indexSkills", project.getIndexSkills());
        // 初始化会话ID供前端直达架构助理会话；失败原因让 pending 态能说明为何回退，而不是只显示「未初始化」。
        map.put("initSessionId", project.getInitSessionId());
        map.put("initFailReason", project.getInitFailReason());
        map.put("repos", repos);
        map.put("resources", resources);
        return map;
    }

    /**
     * 按会话反查所属项目，供只知道 sessionId 的调用方（定时任务、外部技能）解析项目。
     * <p>
     * 会话未绑定项目、项目已删除都返回 {@code bound=false}，不抛异常：调用方要能区分
     * 「查不到」和「调用失败」，前者可以继续走追问兜底，后者必须重试或报错。
     *
     * @param sessionId 会话 ID，必填
     * @return 含 bound、projectId、projectName
     */
    public Map<String, Object> resolveProjectBySession(Long sessionId) {
        if (sessionId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "session.id.required");
        }
        Map<String, Object> map = new HashMap<>();
        map.put("sessionId", sessionId);
        Long projectId = projectSessionService.findProjectIdBySessionId(sessionId);
        Project project = projectId == null ? null : projectService.findById(projectId);
        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            map.put("bound", false);
            map.put("projectId", null);
            map.put("projectName", null);
            return map;
        }
        map.put("bound", true);
        map.put("projectId", project.getProjectId());
        map.put("projectName", project.getProjectName());
        return map;
    }

    /**
     * 查询项目关联的代码仓库列表。
     *
     * @param projectId 项目 ID，必填
     * @return 项目仓库列表
     */
    public List<ProjectRepo> listProjectRepos(Long projectId) {
        if (projectId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.id.required");
        }
        Project project = projectService.findById(projectId);
        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.not.found");
        }
        LambdaQueryWrapper<ProjectRepo> repoWrapper = new LambdaQueryWrapper<>();
        repoWrapper.eq(ProjectRepo::getProjectId, projectId);
        return projectRepoMapper.selectList(repoWrapper);
    }

    /**
     * 查询项目绑定的知识库、数字员工和本体资源。
     *
     * @param projectId 项目 ID
     * @return 绑定资源列表
     */
    public List<ProjectResource> listProjectResources(Long projectId) {
        requireProject(projectId);
        return projectResourceService.listByProjectId(projectId);
    }

    /**
     * 全量覆盖项目资源绑定，传空数组表示解除全部绑定。
     *
     * @param projectId 项目 ID
     * @param resources 待绑定资源列表
     */
    @Transactional
    public void saveProjectResources(Long projectId, List<ProjectResourceDTO> resources) {
        requireProject(projectId);
        projectResourceService.deleteByProjectId(projectId);
        if (resources == null || resources.isEmpty()) return;

        Set<String> uniqueKeys = new HashSet<>();
        int nextSortNo = 0;
        for (ProjectResourceDTO dto : resources) {
            String resourceType = StringUtils.trimToEmpty(dto.getResourceType()).toLowerCase(Locale.ROOT);
            Long resourceId = dto.getResourceId();
            if (!Set.of("knowledge", "digital_employee", "ontology").contains(resourceType)
                || resourceId == null) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.resource.invalid");
            }
            if (!uniqueKeys.add(resourceType + ":" + resourceId)) continue;

            ProjectResource entity = new ProjectResource();
            entity.setId(sequenceService.nextVal());
            entity.setProjectId(projectId);
            entity.setResourceType(resourceType);
            entity.setResourceId(resourceId);
            entity.setResourceName(StringUtils.trimToNull(dto.getResourceName()));
            entity.setSortNo(dto.getSortNo() == null ? nextSortNo++ : dto.getSortNo());
            entity.setCreateBy(CurrentUserHolder.getCurrentUserId());
            entity.setCreateTime(new Date());
            entity.setDeleteFlag(DeleteFlag.NORMAL);
            projectResourceService.save(entity);
        }
    }

    /**
     * 规范化项目名称。
     *
     * @param projectName 原始名称
     * @return 校验长度并去除首尾空格后的名称
     */
    private String normalizeProjectName(String projectName) {
        String normalizedName = projectName == null ? "" : projectName.trim();
        // 应用层再次校验，确保未经过 @Valid 的内部或开放接口同样受长度限制。
        if (normalizedName.length() > PROJECT_NAME_MAX_LENGTH) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.name.max.length");
        }
        return normalizedName;
    }

    /**
     * 校验项目描述长度，开放接口未统一启用 @Valid 时由应用层兜底。
     *
     * @param description 项目描述，可为空
     */
    private void validateProjectDescription(String description) {
        if (description == null) {
            return;
        }
        int characterCount = description.codePointCount(0, description.length());
        if (characterCount > PROJECT_DESCRIPTION_MAX_LENGTH) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.description.too.long");
        }
    }

    /**
     * 批量保存项目仓库。
     *
     * @param projectId 项目 ID
     * @param repos     仓库列表
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
     * @param repoDto   仓库信息
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
        // 描述可选,空串归一成 null,避免预拆提示词里出现空的 description= 行。
        repo.setDescription(StringUtils.trimToNull(repoDto.getDescription()));
        // 仅接受受支持的仓库类型,其余(含空)按代码仓库处理;工作区唯一性由应用层/前端保证。
        String repoType = "workspace".equals(repoDto.getRepoType()) ? "workspace" : "code";
        repo.setRepoType(repoType);
        repo.setProvider(normalizeProvider(repoDto.getProvider()));
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
    @Transactional
    public Map<String, Object> createProjectRepo(ProjectRepoDTO dto) {
        if (dto == null || dto.getProjectId() == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.id.required");
        }
        if (dto.getRepoFullName() == null || dto.getRepoFullName().trim().isEmpty()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.repo.name.required");
        }
        ProjectRepo repo = insertProjectRepo(dto.getProjectId(), dto);
        projectWorkspaceManifestService.syncProjectGitmodules(dto.getProjectId());
        Map<String, Object> result = new HashMap<>();
        result.put("repoId", repo.getRepoId());
        result.put("repoFullName", repo.getRepoFullName());
        result.put("repoUrl", repo.getRepoUrl());
        result.put("defaultBranch", repo.getDefaultBranch());
        result.put("description", repo.getDescription());
        result.put("repoType", repo.getRepoType());
        result.put("provider", repo.getProvider());
        return result;
    }

    /**
     * 更新单个项目仓库。
     * <p>
     * 直接更新原记录，不采用删除后重建，避免需求、任务或扫描源中保存的 repoId 失效。
     *
     * @param dto 含 repoId、projectId、仓库信息
     * @return 更新后的仓库基本信息
     */
    @Transactional
    public Map<String, Object> updateProjectRepo(ProjectRepoDTO dto) {
        if (dto == null || dto.getRepoId() == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.repo.id.required");
        }
        if (dto.getProjectId() == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.id.required");
        }
        if (dto.getRepoFullName() == null || dto.getRepoFullName().trim().isEmpty()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.repo.name.required");
        }
        ProjectRepo repo = projectRepoMapper.selectById(dto.getRepoId());
        if (repo == null || !dto.getProjectId().equals(repo.getProjectId())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.repo.not.found");
        }
        repo.setRepoFullName(dto.getRepoFullName().trim());
        repo.setRepoUrl(StringUtils.trimToNull(dto.getRepoUrl()));
        String defaultBranch = dto.getDefaultBranch() == null ? "" : dto.getDefaultBranch().trim();
        repo.setDefaultBranch(defaultBranch.isEmpty() ? "main" : defaultBranch);
        repo.setDescription(StringUtils.trimToNull(dto.getDescription()));
        repo.setRepoType("workspace".equals(dto.getRepoType()) ? "workspace" : "code");
        repo.setProvider(normalizeProvider(dto.getProvider()));
        projectRepoMapper.updateById(repo);
        projectWorkspaceManifestService.syncProjectGitmodules(repo.getProjectId());
        Map<String, Object> result = new HashMap<>();
        result.put("repoId", repo.getRepoId());
        result.put("projectId", repo.getProjectId());
        result.put("repoFullName", repo.getRepoFullName());
        result.put("repoUrl", repo.getRepoUrl());
        result.put("defaultBranch", repo.getDefaultBranch());
        result.put("description", repo.getDescription());
        result.put("repoType", repo.getRepoType());
        result.put("provider", repo.getProvider());
        return result;
    }

    /**
     * 规范化代码平台编码，仅接受 github/gitlab/gitea，其余按 github。
     *
     * @param provider 原始平台编码
     * @return 规范化后的平台编码
     */
    private static String normalizeProvider(String provider) {
        if ("gitlab".equals(provider) || "gitea".equals(provider)) {
            return provider;
        }
        return "github";
    }

    /**
     * 删除项目仓库，已被扫描源或手工需求关联时拒绝删除。
     *
     * @param repoId 仓库 ID
     */
    @Transactional
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
        if (repo != null) {
            projectWorkspaceManifestService.syncProjectGitmodules(repo.getProjectId());
        }
    }

    /**
     * 统计项目内明确关联该仓库的手工需求数。
     *
     * @param projectId 项目 ID
     * @param repoId    仓库 ID
     * @return 关联的手工需求数量
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
     * 判断手工需求内容 JSON 是否绑定指定仓库。
     *
     * @param item   扫描需求项
     * @param repoId 仓库 ID
     * @return 已绑定返回 true；历史无 repoId 或非 JSON 返回 false
     */
    private boolean isManualRequirementBoundToRepo(ScanRequireItem item, Long repoId) {
        if (item == null || StringUtils.isBlank(item.getContent()) || repoId == null) {
            return false;
        }
        try {
            JSONObject root = JSON.parseObject(item.getContent());
            JSONObject manualRequirement = root != null ? root.getJSONObject(MANUAL_REQUIREMENT_CONTENT_KEY) : null;
            return manualRequirement != null && repoId.equals(manualRequirement.getLong("repoId"));
        } catch (Exception ignored) {
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

        projectSessionQo.normalizeSearchCondition();
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

        // 默认项目所有用户可见，暂时禁止共享
        if (projectId < 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.share.to.default.forbidden");
        }


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
        } catch (Exception e) {
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
        } catch (Exception e) {
            log.error("Failed to delete project shared file storage, fileId={}", file.getFileId(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.share.file.delete.failed", e);
        }
    }

    /**
     * 校验共享文件操作参数、文件归属和项目创建者权限。
     *
     * @param projectId 项目 ID
     * @param fileId    文件 ID
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
