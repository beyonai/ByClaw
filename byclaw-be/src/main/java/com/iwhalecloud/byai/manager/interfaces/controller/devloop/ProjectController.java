package com.iwhalecloud.byai.manager.interfaces.controller.devloop;

import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectShareFileSaveDto;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
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
@RequestMapping("/devloop/project")
public class ProjectController {

    @Autowired
    private DevloopApplicationService applicationService;

    /**
     * 创建项目
     *
     * @param dto 项目信息（projectName必填，description、resourceId、repos可选）
     * @return 新建项目ID
     */
    @PostMapping("/create")
    public ResponseUtil<Map<String, Object>> createProject(@RequestBody ProjectDTO dto) {
        return applicationService.createProject(dto);
    }

    /**
     * 查询项目列表
     *
     * @param projectQo 查询条件（keyword / projectType / isShare，可分页）
     * @return 项目列表
     */
    @PostMapping("/list")
    public ResponseUtil<List<ProjectListDto>> listProjects(@RequestBody ProjectQo projectQo) {
        List<ProjectListDto> projectListDtos = applicationService.listProjects(projectQo);
        return ResponseUtil.successResponse(projectListDtos);
    }

    /**
     * 查询项目详情
     *
     * @param params 包含 projectId
     * @return 项目基本信息及关联的代码仓库列表
     */
    @PostMapping("/get")
    public ResponseUtil<Map<String, Object>> getProject(@RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        return applicationService.getProject(projectId);
    }

    /**
     * 修改项目信息
     *
     * @param dto 包含 projectId（必填）、projectName、description（可选）
     */
    @PostMapping("/update")
    public ResponseUtil<Void> updateProject(@RequestBody ProjectDTO dto) {
        return applicationService.updateProject(dto);
    }

    /**
     * 删除项目（软删除）
     *
     * @param params 包含 projectId
     */
    @PostMapping("/delete")
    public ResponseUtil<Void> deleteProject(@RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        return applicationService.deleteProject(projectId);
    }

    /**
     * 新增项目仓库
     *
     * @param dto 仓库信息（projectId、repoFullName 必填，repoUrl、defaultBranch 可选）
     * @return 新建仓库ID及基本信息
     */
    @PostMapping("/repo/create")
    public ResponseUtil<Map<String, Object>> createProjectRepo(@RequestBody ProjectRepoDTO dto) {
        return applicationService.createProjectRepo(dto);
    }

    /**
     * 删除项目仓库
     *
     * @param params 包含 repoId
     */
    @PostMapping("/repo/delete")
    public ResponseUtil<Void> deleteProjectRepo(@RequestBody Map<String, Object> params) {
        Long repoId = Long.valueOf(params.get("repoId").toString());
        return applicationService.deleteProjectRepo(repoId);
    }

    /**
     * 根据项目查询关联会话列表
     *
     * @param qo 查询对象（projectId 必填，可带 pageNum/pageSize/keyword）
     * @return 项目下有效会话列表
     */
    @PostMapping("/session/listByQo")
    public ResponseUtil<PageInfo<ByaiSessionDto>> listSessionsByProject(@RequestBody ProjectSessionQo qo) {
        PageInfo<ByaiSessionDto> pageInfo = applicationService.listSessionsByProject(qo);
        return ResponseUtil.successResponse(pageInfo);
    }

    /**
     * 绑定会话到项目，用于项目空间下新建会话后建立分组关系
     *
     * @param params 包含 projectId、sessionId
     */
    @PostMapping("/session/bind")
    public ResponseUtil<Void> bindProjectSession(@RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        Long sessionId = Long.valueOf(params.get("sessionId").toString());
        return applicationService.bindProjectSession(projectId, sessionId);
    }

    /**
     * 取消项目和会话的有效关联
     *
     * @param params 包含 projectId、sessionId
     */
    @PostMapping("/session/unbind")
    public ResponseUtil<Void> unbindProjectSession(@RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        Long sessionId = Long.valueOf(params.get("sessionId").toString());
        return applicationService.unbindProjectSession(projectId, sessionId);
    }

    /**
     * 保存到项目空间
     *
     * @param dto 请求参数
     */
    @PostMapping("/share/saveToSpace")
    public ResponseUtil<Void> saveShareToSpace(@RequestBody ProjectShareFileSaveDto dto) {
        applicationService.saveShareToSpace(dto);
        return ResponseUtil.successResponse();
    }

    /**
     * 查询空间文件列表
     *
     * @param dto 包含 projectId
     */
    @PostMapping("/share/listSpaceFiles")
    public ResponseUtil<List<ProjectShareFileListDto>> listSpaceFiles(@RequestBody ProjectShareFileQueryDto dto) {
        if (dto == null || dto.getProjectId() == null || dto.getProjectId() == 0L) {
            return ResponseUtil.failRes("projectId不能为空");
        }
        return ResponseUtil.successResponse(applicationService.listSpaceFiles(dto));
    }
}
