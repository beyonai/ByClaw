package com.iwhalecloud.byai.manager.interfaces.controller.devloop;

import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectRepositoryService;
import com.iwhalecloud.byai.manager.application.service.devloop.WorkspaceInitService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberSaveDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoBranchDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoFileContentDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoFileQueryDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoTreeQueryDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoTreeNodeDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectResourceDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileDeleteDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileRenameDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileSaveDto;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectResource;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectQo;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectSessionQo;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/**
 * 项目管理控制器 提供研发项目的创建、查询、修改、删除接口
 */
@RestController
@RequestMapping("/project")
@Tag(name = "项目管理", description = "研发项目的创建、查询、修改、删除及初始化接口")
public class ProjectController {

    @Autowired
    private ProjectApplicationService projectApplicationService;

    @Autowired
    private WorkspaceInitService workspaceInitService;

    @Autowired
    private ProjectRepositoryService projectRepositoryService;

    /**
     * 创建项目
     *
     * @param dto 项目信息（projectName必填，description、resourceId、repos可选）
     * @return 新建项目
     */
    @PostMapping("/create")
    public ResponseUtil<Project> createProject(@Valid @RequestBody ProjectDTO dto) {
        return ResponseUtil.successResponse(projectApplicationService.createProject(dto));
    }

    /**
     * 分页查询项目列表
     *
     * @param projectQo 查询条件（keyword / projectType / isShare，可分页）
     * @return 项目分页列表
     */
    @PostMapping("/list")
    public ResponseUtil<PageInfo<ProjectListDto>> listProjects(@RequestBody ProjectQo projectQo) {
        return ResponseUtil.successResponse(projectApplicationService.selectProjectsByQo(projectQo));
    }

    /**
     * 查询项目详情
     *
     * @param params 包含 projectId
     * @return 项目基本信息及关联的代码仓库列表
     */
    @PostMapping("/get")
    public ResponseUtil<Map<String, Object>> getProject(@RequestBody Map<String, Object> params) {
        Long projectId = MapParamUtil.getLongValue(params, "projectId");
        return ResponseUtil.successResponse(projectApplicationService.getProject(projectId));
    }

    /**
     * 修改项目信息
     *
     * @param dto 包含 projectId（必填）、projectName、description（可选）
     */
    @PostMapping("/update")
    public ResponseUtil<Void> updateProject(@Valid @RequestBody ProjectDTO dto) {
        projectApplicationService.updateProject(dto);
        return ResponseUtil.successResponse();
    }

    /**
     * 删除项目（软删除）
     *
     * @param params 包含 projectId
     */
    @PostMapping("/delete")
    public ResponseUtil<Void> deleteProject(@RequestBody Map<String, Object> params) {
        Long projectId = MapParamUtil.getLongValue(params, "projectId");
        projectApplicationService.deleteProject(projectId);
        return ResponseUtil.successResponse();
    }

    /**
     * 触发研发项目工作区初始化：下发架构数字员工在沙箱内完成克隆/骨架/技能包/推送。
     *
     * <p>接口只负责下发与置 initializing，真正的完成由 DevloopWorkspaceInitJob 读会话状态文件判定后置 ready。
     *
     * @param params 含 projectId（必填）、buildIndex（是否建索引）、skillPackages（技能包数组）
     * @return 本次初始化的会话ID，前端可据此跳进架构员工聊天
     */
    @PostMapping("/init/start")
    public ResponseUtil<Map<String, Object>> initProject(@RequestBody Map<String, Object> params) {
        Long projectId = MapParamUtil.getLongValue(params, "projectId");
        boolean buildIndex = Boolean.TRUE.equals(params.get("buildIndex"))
            || "Y".equalsIgnoreCase(MapParamUtil.getStringValue(params, "buildIndex"));
        Long sessionId = workspaceInitService.startWorkspaceInit(projectId, buildIndex,
            params.get("skillPackages"));
        return ResponseUtil.successResponse(Map.of("sessionId", sessionId));
    }

    /**
     * 查询项目成员列表
     *
     * @param params 包含 projectId，可选 userName / keyword
     * @return 成员列表
     */
    @PostMapping("/member/list")
    public ResponseUtil<List<ProjectMemberListDto>> listProjectMembers(@RequestBody Map<String, Object> params) {
        Long projectId = MapParamUtil.getLongValue(params, "projectId");
        String userName = MapParamUtil.getStringValue(params, "userName");
        // 兼容已发布前端的 keyword 入参，但后续查询仍只按成员姓名执行。
        if (StringUtil.isEmpty(userName)) {
            userName = MapParamUtil.getStringValue(params, "keyword");
        }
        return ResponseUtil.successResponse(projectApplicationService.listProjectMembers(projectId, userName));
    }

    /**
     * 批量添加项目成员
     *
     * @param params 包含 projectId、userIds；兼容旧版单个 userId
     */
    @PostMapping("/member/add")
    public ResponseUtil<Void> addProjectMember(@RequestBody Map<String, Object> params) {
        projectApplicationService.addProjectMember(params);
        return ResponseUtil.successResponse();
    }

    /**
     * 整体保存项目成员列表。
     *
     * @param dto 包含 projectId、userIds，userIds 为空数组时移除全部普通成员
     */
    @PostMapping("/member/save")
    public ResponseUtil<Void> saveProjectMembers(@RequestBody ProjectMemberSaveDto dto) {
        projectApplicationService.saveProjectMembers(dto);
        return ResponseUtil.successResponse();
    }

    /**
     * 移除项目成员
     *
     * @param params 包含 memberId
     */
    @PostMapping("/member/remove")
    public ResponseUtil<Void> removeProjectMember(@RequestBody Map<String, Object> params) {
        Long memberId = MapParamUtil.getLongValue(params, "memberId");
        projectApplicationService.removeProjectMember(memberId);
        return ResponseUtil.successResponse();
    }

    /**
     * 绑定数字员工到项目成员
     *
     * @param params 包含 memberId、agentId
     */
    @PostMapping("/member/bindAgent")
    public ResponseUtil<Void> bindMemberAgent(@RequestBody Map<String, Object> params) {
        projectApplicationService.bindMemberAgent(params);
        return ResponseUtil.successResponse();
    }

    /** 解除项目成员已绑定的数字员工。 */
    @PostMapping("/member/unbindAgent")
    public ResponseUtil<Void> unbindMemberAgent(@RequestBody Map<String, Object> params) {
        projectApplicationService.unbindMemberAgent(params);
        return ResponseUtil.successResponse();
    }

    /**
     * 新增项目仓库
     *
     * @param dto 仓库信息（projectId、repoFullName 必填，repoUrl、defaultBranch 可选）
     * @return 新建仓库ID及基本信息
     */
    @PostMapping("/repo/create")
    public ResponseUtil<Map<String, Object>> createProjectRepo(@RequestBody ProjectRepoDTO dto) {
        return ResponseUtil.successResponse(projectApplicationService.createProjectRepo(dto));
    }

    /**
     * 查询项目关联的代码仓库列表。
     *
     * @param params 包含 projectId（必填）
     * @return 项目仓库列表
     */
    @PostMapping("/repo/list")
    public ResponseUtil<List<ProjectRepo>> listProjectRepos(@RequestBody Map<String, Object> params) {
        Long projectId = MapParamUtil.getLongValue(params, "projectId");
        return ResponseUtil.successResponse(projectApplicationService.listProjectRepos(projectId));
    }

    /**
     * 查询项目仓库目录的直接子节点。
     *
     * <p>path 为空查询仓库根目录；展开目录时将返回节点的 path 作为下一次请求的 path，
     * 因此同一个接口即可按需查询任意层级，避免一次性拉取整个仓库。</p>
     *
     * @param query 包含 projectId、repoId；path、ref 可选
     * @return 当前目录下的文件和目录
     */
    @PostMapping("/repo/tree")
    public ResponseUtil<List<ProjectRepoTreeNodeDTO>> listProjectRepoTree(
        @RequestBody ProjectRepoTreeQueryDTO query) {
        return ResponseUtil.successResponse(projectRepositoryService.listTree(query == null ? null : query.getProjectId(),
            query == null ? null : query.getRepoId(), query == null ? null : query.getPath(),
            query == null ? null : query.getRef()));
    }

    /**
     * 查询仓库的全部远程分支。
     *
     * @param params 包含 repoId（必填）
     * @return 远程分支列表
     */
    @PostMapping("/repo/branch/list")
    public ResponseUtil<List<ProjectRepoBranchDTO>> listProjectRepoBranches(
        @RequestBody Map<String, Object> params) {
        Long repoId = MapParamUtil.getLongValue(params, "repoId");
        return ResponseUtil.successResponse(projectRepositoryService.listBranches(repoId));
    }

    /**
     * 查询指定远程分支上的文件内容。
     *
     * @param query 包含 repoId、branch、path，path 使用目录接口返回的文件路径
     * @return 文件内容及元数据
     */
    @PostMapping("/repo/file/content")
    public ResponseUtil<ProjectRepoFileContentDTO> getProjectRepoFileContent(
        @RequestBody ProjectRepoFileQueryDTO query) {
        return ResponseUtil.successResponse(projectRepositoryService.getFileContent(
            query == null ? null : query.getRepoId(), query == null ? null : query.getBranch(),
            query == null ? null : query.getPath()));
    }

    /** 查询项目绑定的知识库、数字员工和本体。 */
    @PostMapping("/resource/list")
    public ResponseUtil<List<ProjectResource>> listProjectResources(@RequestBody Map<String, Object> params) {
        Long projectId = MapParamUtil.getLongValue(params, "projectId");
        return ResponseUtil.successResponse(projectApplicationService.listProjectResources(projectId));
    }

    /** 全量保存项目资源绑定关系。 */
    @PostMapping("/resource/save")
    public ResponseUtil<Void> saveProjectResources(@RequestBody Map<String, Object> params) {
        Long projectId = MapParamUtil.getLongValue(params, "projectId");
        List<ProjectResourceDTO> resources = com.alibaba.fastjson.JSON.parseArray(
            com.alibaba.fastjson.JSON.toJSONString(params.get("resources")), ProjectResourceDTO.class);
        projectApplicationService.saveProjectResources(projectId, resources);
        return ResponseUtil.successResponse();
    }

    /**
     * 删除项目仓库
     *
     * @param params 包含 repoId
     */
    @PostMapping("/repo/delete")
    public ResponseUtil<Void> deleteProjectRepo(@RequestBody Map<String, Object> params) {
        Long repoId = MapParamUtil.getLongValue(params, "repoId");
        projectApplicationService.deleteProjectRepo(repoId);
        return ResponseUtil.successResponse();
    }

    /**
     * 根据项目查询关联会话列表
     *
     * @param qo 查询对象（projectId 必填，可带 pageNum/pageSize/keyword）
     * @return 项目下有效会话列表
     */
    @PostMapping("/session/listByQo")
    public ResponseUtil<PageInfo<ByaiSessionDto>> listSessionsByProject(@RequestBody ProjectSessionQo qo) {
        return ResponseUtil.successResponse(projectApplicationService.listSessionsByProject(qo));
    }

    /**
     * 保存到项目空间
     *
     * @param dto 请求参数
     */
    @PostMapping("/share/saveToSpace")
    public ResponseUtil<Void> saveShareToSpace(@RequestBody ProjectShareFileSaveDto dto) {
        projectApplicationService.saveShareToSpace(dto);
        return ResponseUtil.successResponse();
    }

    /**
     * 查询空间文件列表
     *
     * @param dto 包含 projectId
     */
    @PostMapping("/share/listSpaceFiles")
    public ResponseUtil<List<ProjectShareFileListDto>> listSpaceFiles(@RequestBody ProjectShareFileQueryDto dto) {
        return ResponseUtil.successResponse(projectApplicationService.listSpaceFiles(dto));
    }

    /**
     * 重命名项目共享文件，仅项目创建者可操作。
     *
     * @param dto 包含 projectId、fileId、fileName
     */
    @PostMapping("/share/rename")
    public ResponseUtil<Void> renameShareFile(@RequestBody ProjectShareFileRenameDto dto) {
        projectApplicationService.renameShareFile(dto);
        return ResponseUtil.successResponse();
    }

    /**
     * 删除项目共享文件，仅项目创建者可操作。
     *
     * @param dto 包含 projectId、fileId
     */
    @PostMapping("/share/delete")
    public ResponseUtil<Void> deleteShareFile(@RequestBody ProjectShareFileDeleteDto dto) {
        projectApplicationService.deleteShareFile(dto);
        return ResponseUtil.successResponse();
    }
}
