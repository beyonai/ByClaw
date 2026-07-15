package com.iwhalecloud.byai.manager.interfaces.controller.devloop;

import com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 项目管理控制器
 * 提供研发项目的创建、查询、修改、删除接口
 */
@RestController
@RequestMapping("/devloop/project")
public class ProjectController {

    @Autowired
    private DevloopApplicationService applicationService;

    /**
     * 创建项目
     * @param dto 项目信息（projectName必填，description、resourceId、repos可选）
     * @return 新建项目ID
     */
    @PostMapping("/create")
    public ResponseUtil<Map<String, Object>> createProject(@RequestBody ProjectDTO dto) {
        return applicationService.createProject(dto);
    }

    /**
     * 查询项目列表
     * @return 当前用户可见的所有项目
     */
    @PostMapping("/list")
    public ResponseUtil<List<Map<String, Object>>> listProjects() {
        return applicationService.listProjects();
    }

    /**
     * 查询项目详情
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
     * @param dto 包含 projectId（必填）、projectName、description（可选）
     */
    @PostMapping("/update")
    public ResponseUtil<Void> updateProject(@RequestBody ProjectDTO dto) {
        return applicationService.updateProject(dto);
    }

    /**
     * 删除项目（软删除）
     * @param params 包含 projectId
     */
    @PostMapping("/delete")
    public ResponseUtil<Void> deleteProject(@RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        return applicationService.deleteProject(projectId);
    }
}
