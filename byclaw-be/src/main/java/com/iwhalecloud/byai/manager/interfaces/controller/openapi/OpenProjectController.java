package com.iwhalecloud.byai.manager.interfaces.controller.openapi;

import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkProactiveMessageService;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectContextApplicationService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectContextDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectContextQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectListDto;
import com.iwhalecloud.byai.manager.dto.devloop.MemberBatchDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberSaveDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectQo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;
import java.util.Map;

/**
 * @author he.duming
 * @date 2026-07-22 23:40:16
 * @description TODO
 */
@RestController
@RequestMapping("/open/api/v1")
public class OpenProjectController {

    @Autowired
    private ProjectApplicationService projectApplicationService;

    @Autowired
    private ProjectContextApplicationService projectContextApplicationService;

    @Autowired
    private DingtalkProactiveMessageService dingtalkProactiveMessageService;

    /**
     * 查询项目列表
     *
     * @param projectQo 查询条件（keyword / projectType / isShare，可分页）
     * @return 项目列表
     */
    @ManageLogAnnotation(name = "API调用", description = "查询项目列表")
    @PostMapping("/selectProjectsByQo")
    public ResponseUtil<PageInfo<ProjectListDto>> selectProjectsByQo(@RequestBody ProjectQo projectQo) {
        PageInfo<ProjectListDto> pageInfo = projectApplicationService.selectProjectsByQo(projectQo);
        return ResponseUtil.successResponse(pageInfo);
    }

    /**
     * 创建项目
     *
     * @param dto 项目信息（projectName必填，description、resourceId、repos可选）
     * @return 新建项目
     */
    @ManageLogAnnotation(name = "API调用", description = "创建项目")
    @PostMapping("/createProject")
    public ResponseUtil<Project> createProject(@RequestBody ProjectDTO dto) {
        return ResponseUtil.successResponse(projectApplicationService.createProject(dto));
    }

    /**
     * 修改项目信息
     *
     * @param dto 包含 projectId（必填）、projectName、description（可选）
     */
    @ManageLogAnnotation(name = "API调用", description = "修改项目")
    @PostMapping("/updateProject")
    public ResponseUtil<Void> updateProject(@RequestBody ProjectDTO dto) {
        projectApplicationService.updateProject(dto);
        return ResponseUtil.successResponse();
    }

    /**
     * 查询项目详情
     *
     * @param params 包含 projectId
     * @return 项目基本信息及关联的代码仓库列表
     */
    @ManageLogAnnotation(name = "API调用", description = "查询项目详情")
    @PostMapping("/getProject")
    public ResponseUtil<Map<String, Object>> getProject(@RequestBody Map<String, Object> params) {
        Long projectId = MapParamUtil.getLongValue(params, "projectId");
        return ResponseUtil.successResponse(projectApplicationService.getProject(projectId));
    }

    /**
     * 按会话反查所属项目
     * <p>
     * 只知道 sessionId 的调用方（定时任务、外部技能）用它解析 projectId；会话没绑项目时
     * 返回 bound=false 而不是报错，调用方据此走自己的兜底流程。
     *
     * @param params 包含 sessionId
     * @return 含 bound、projectId、projectName、projectType
     */
    @ManageLogAnnotation(name = "API调用", description = "按会话查项目")
    @PostMapping("/resolveProjectBySession")
    public ResponseUtil<Map<String, Object>> resolveProjectBySession(@RequestBody Map<String, Object> params) {
        Long sessionId = MapParamUtil.getLongValue(params, "sessionId");
        return ResponseUtil.successResponse(projectApplicationService.resolveProjectBySession(sessionId));
    }

    /**
     * 查询当前项目的完整只读上下文，供 OpenClaw 底层 skill 使用。
     * projectId 优先；缺失时可按 sessionId 反查。接口仅返回当前用户可见项目，且成员信息不含手机号。
     */
    @ManageLogAnnotation(name = "API调用", description = "查询项目上下文")
    @PostMapping("/projectContext")
    public ResponseUtil<ProjectContextDto> projectContext(@RequestBody ProjectContextQueryDto query) {
        return ResponseUtil.successResponse(projectContextApplicationService.getProjectContext(query));
    }

    /**
     * 删除项目（软删除）
     *
     * @param params 包含 projectId
     */
    @ManageLogAnnotation(name = "API调用", description = "删除项目")
    @PostMapping("/deleteProject")
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
    @ManageLogAnnotation(name = "API调用", description = "查询项目成员列表")
    @PostMapping("/listProjectMembers")
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
    @ManageLogAnnotation(name = "API调用", description = "添加项目成员")
    @PostMapping("/addProjectMember")
    public ResponseUtil<Void> addProjectMember(@RequestBody Map<String, Object> params) {
        projectApplicationService.addProjectMember(params);
        return ResponseUtil.successResponse();
    }

    /**
     * 整体保存项目成员列表。
     *
     * @param dto 包含 projectId、userIds，userIds 为空数组时移除全部普通成员
     */
    @ManageLogAnnotation(name = "API调用", description = "整体保存项目成员")
    @PostMapping("/saveProjectMembers")
    public ResponseUtil<Void> saveProjectMembers(@RequestBody ProjectMemberSaveDto dto) {
        projectApplicationService.saveProjectMembers(dto);
        return ResponseUtil.successResponse();
    }

    /**
     * 移除项目成员
     *
     * @param params 包含 memberId
     */
    @ManageLogAnnotation(name = "API调用", description = "移除项目成员")
    @PostMapping("/removeProjectMember")
    public ResponseUtil<Void> removeProjectMember(@RequestBody Map<String, Object> params) {
        Long memberId = MapParamUtil.getLongValue(params, "memberId");
        projectApplicationService.removeProjectMember(memberId);
        return ResponseUtil.successResponse();
    }

    /**
     * 批量添加项目成员
     *
     * @param dto 包含 projectId、userIds
     */
    @ManageLogAnnotation(name = "API调用", description = "批量添加项目成员")
    @PostMapping("/batchAddProjectMembers")
    public ResponseUtil<Void> batchAddProjectMembers(@RequestBody MemberBatchDTO dto) {
        projectApplicationService.batchAddProjectMembers(dto);
        return ResponseUtil.successResponse();
    }

    /**
     * 批量移除项目成员
     *
     * @param dto 包含 projectId、userIds
     */
    @ManageLogAnnotation(name = "API调用", description = "批量移除项目成员")
    @PostMapping("/batchRemoveProjectMembers")
    public ResponseUtil<Void> batchRemoveProjectMembers(@RequestBody MemberBatchDTO dto) {
        projectApplicationService.batchRemoveProjectMembers(dto);
        return ResponseUtil.successResponse();
    }

    /**
     * 通过 dws 给项目成员发送钉钉单聊消息
     *
     * @param params 包含 senderUserId (发送人/执行 skill 的用户)、receiverUserId (接收人)、content (消息内容)
     * @return 成功/失败结果
     */
    @ManageLogAnnotation(name = "API调用", description = "钉钉发送消息(dws)")
    @PostMapping("/dingtalk/sendUserToUser")
    public ResponseUtil<Void> sendDingtalkToUser(@RequestBody Map<String, Object> params) {
        Long senderUserId = MapParamUtil.getLongValue(params, "senderUserId");
        Long receiverUserId = MapParamUtil.getLongValue(params, "receiverUserId");
        String content = MapParamUtil.getStringValue(params, "content");

        if (senderUserId == null || receiverUserId == null || StringUtil.isEmpty(content)) {
            return ResponseUtil.failRes("参数不完整: 需要 senderUserId, receiverUserId, content");
        }

        try {
            dingtalkProactiveMessageService.sendUserToUserViaDws(senderUserId, receiverUserId, content);
            return ResponseUtil.successResponse();
        }
        catch (IllegalStateException e) {
            // 未授权或映射失败
            return ResponseUtil.failRes(e.getMessage());
        }
        catch (Exception e) {
            return ResponseUtil.failRes("钉钉消息发送失败: " + e.getMessage());
        }
    }

    /**
     * 测试钉钉消息发送 (GET 版本，方便浏览器直接测试)
     *
     * @param senderUserId 发送人 userId
     * @param receiverUserId 接收人 userId
     * @param content 消息内容（可选，默认为测试消息）
     * @return 成功/失败结果
     */
    @ManageLogAnnotation(name = "API调用", description = "钉钉发送消息测试(GET)")
    @GetMapping("/dingtalk/testSend")
    public ResponseUtil<String> testSendDingtalk(@RequestParam Long senderUserId, @RequestParam Long receiverUserId,
        @RequestParam(required = false) String content) {

        // 默认测试消息
        if (StringUtil.isEmpty(content)) {
            content = "## 钉钉消息测试\n\n这是一条测试消息。\n\n时间: " + new java.util.Date();
        }

        try {
            dingtalkProactiveMessageService.sendUserToUserViaDws(senderUserId, receiverUserId, content);
            return ResponseUtil.successResponse("发送成功！请检查钉钉单聊。");
        }
        catch (IllegalStateException e) {
            return ResponseUtil.failRes(e.getMessage());
        }
        catch (Exception e) {
            return ResponseUtil.failRes("发送失败: " + e.getMessage());
        }
    }

}
