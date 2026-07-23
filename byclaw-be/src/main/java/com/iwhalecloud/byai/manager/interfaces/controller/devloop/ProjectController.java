package com.iwhalecloud.byai.manager.interfaces.controller.devloop;

import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberSaveDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileSaveDto;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectQo;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectSessionQo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 项目管理控制器 提供研发项目的创建、查询、修改、删除接口
 */
@RestController
@RequestMapping("/project")
public class ProjectController {

    @Autowired
    private ProjectApplicationService projectApplicationService;

    /**
     * 创建项目
     *
     * @param dto 项目信息（projectName必填，description、resourceId、repos可选）
     * @return 新建项目
     */
    @PostMapping("/create")
    public ResponseUtil<Project> createProject(@RequestBody ProjectDTO dto) {
        return ResponseUtil.successResponse(projectApplicationService.createProject(dto));
    }

    /**
     * 查询项目列表
     *
     * @param projectQo 查询条件（keyword / projectType / isShare，可分页）
     * @return 项目列表
     */
    @PostMapping("/list")
    public ResponseUtil<List<ProjectListDto>> listProjects(@RequestBody ProjectQo projectQo) {
        return ResponseUtil.successResponse(projectApplicationService.listProjects(projectQo));
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
    public ResponseUtil<Void> updateProject(@RequestBody ProjectDTO dto) {
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
}
