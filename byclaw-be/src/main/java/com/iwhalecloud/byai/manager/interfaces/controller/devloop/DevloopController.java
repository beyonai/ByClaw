package com.iwhalecloud.byai.manager.interfaces.controller.devloop;

import com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.dto.devloop.ScanSourceDTO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 研发闭环控制器
 * 提供需求收集源管理、扫描触发、扫描日志、GitHub PAT、钉钉群搜索等接口
 */
@RestController
@RequestMapping("/devloop")
public class DevloopController {

    @Autowired
    private DevloopApplicationService applicationService;

    /**
     * 创建扫描源
     * @param dto 扫描源信息（projectId、sourceName、sourceType、config必填）
     * @return 新建源ID
     */
    @PostMapping("/source/create")
    public ResponseUtil<Map<String, Object>> createScanSource(@RequestBody ScanSourceDTO dto) {
        return applicationService.createScanSource(dto);
    }

    /**
     * 修改扫描源配置
     * @param dto 包含 sourceId（必填）、sourceName、config、cronExpr（可选）
     */
    @PostMapping("/source/update")
    public ResponseUtil<Void> updateScanSource(@RequestBody ScanSourceDTO dto) {
        return applicationService.updateScanSource(dto);
    }

    /**
     * 删除扫描源
     * @param params 包含 sourceId
     */
    @PostMapping("/source/delete")
    public ResponseUtil<Void> deleteScanSource(@RequestBody Map<String, Object> params) {
        Long sourceId = Long.valueOf(params.get("sourceId").toString());
        return applicationService.deleteScanSource(sourceId);
    }

    /**
     * 查询项目下的扫描源列表
     * @param params 包含 projectId
     * @return 扫描源列表（含启用状态、最近扫描时间等）
     */
    @PostMapping("/source/list")
    public ResponseUtil<List<Map<String, Object>>> listScanSources(@RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        return applicationService.listScanSources(projectId);
    }

    /**
     * 启用/停用扫描源
     * @param params 包含 sourceId、enabled（"1"启用/"0"停用）
     */
    @PostMapping("/source/toggle")
    public ResponseUtil<Void> toggleScanSource(@RequestBody Map<String, Object> params) {
        Long sourceId = Long.valueOf(params.get("sourceId").toString());
        String enabled = params.get("enabled").toString();
        return applicationService.toggleScanSource(sourceId, enabled);
    }

    /**
     * 手动触发一次扫描
     * @param params 包含 sourceId
     * @return 本次扫描新建的条目数
     */
    @PostMapping("/source/scan")
    public ResponseUtil<Map<String, Object>> triggerScan(@RequestBody Map<String, Object> params) {
        Long sourceId = Long.valueOf(params.get("sourceId").toString());
        return applicationService.triggerScan(sourceId);
    }

    /**
     * 查询扫描日志列表
     * @param params 包含 sourceId、limit（可选，默认20）
     * @return 按时间倒序的扫描日志
     */
    @PostMapping("/log/list")
    public ResponseUtil<List<Map<String, Object>>> listScanLogs(@RequestBody Map<String, Object> params) {
        Long sourceId = Long.valueOf(params.get("sourceId").toString());
        int limit = params.containsKey("limit") ? Integer.parseInt(params.get("limit").toString()) : 20;
        return applicationService.listScanLogs(sourceId, limit);
    }

    /**
     * 查询某次扫描的详细条目
     * @param params 包含 logId
     * @return 扫描发现的每条需求/Issue信息
     */
    @PostMapping("/log/items")
    public ResponseUtil<List<Map<String, Object>>> listScanLogItems(@RequestBody Map<String, Object> params) {
        Long logId = Long.valueOf(params.get("logId").toString());
        return applicationService.listScanLogItems(logId);
    }

    /**
     * 保存GitHub Personal Access Token
     * @param params 包含 pat（明文，后端SM4加密存储）
     */
    @PostMapping("/pat/github")
    public ResponseUtil<Void> saveGitHubPat(@RequestBody Map<String, Object> params) {
        String pat = params.get("pat") != null ? params.get("pat").toString() : "";
        if (pat.isEmpty()) {
            return ResponseUtil.failRes("PAT不能为空");
        }
        return applicationService.saveGitHubPat(pat);
    }

    /**
     * 检查当前用户是否已保存GitHub PAT
     * @return hasPat布尔值，已存储时额外返回last4
     */
    @PostMapping("/pat/github/check")
    public ResponseUtil<Map<String, Object>> checkGitHubPat() {
        return applicationService.checkGitHubPat();
    }

    /**
     * 搜索钉钉群（通过DWS CLI）
     * @param params 包含 query（群名关键词，至少2个字符）
     * @return 匹配的群列表（openConversationId + name）
     */
    @PostMapping("/dingtalk/groups/search")
    public ResponseUtil<List<Map<String, Object>>> searchDingtalkGroups(@RequestBody Map<String, Object> params) {
        String query = params.get("query") != null ? params.get("query").toString() : "";
        if (query.isEmpty()) {
            return ResponseUtil.failRes("查询关键词不能为空");
        }
        return applicationService.searchDingtalkGroups(query);
    }

    // ========== 研发任务 ==========

    /** 从需求创建任务 */
    @PostMapping("/task/create")
    public ResponseUtil<Map<String, Object>> createTask(@RequestBody Map<String, Object> params) {
        return applicationService.createTask(params);
    }

    /** 查询项目任务列表 */
    @PostMapping("/task/list")
    public ResponseUtil<List<Map<String, Object>>> listTasks(@RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        return applicationService.listTasks(projectId);
    }

    /** 获取任务(会话)详情 */
    @PostMapping("/task/detail")
    public ResponseUtil<Map<String, Object>> getTaskDetail(@RequestBody Map<String, Object> params) {
        Long sessionId = Long.valueOf(params.get("sessionId") != null ? params.get("sessionId").toString()
            : params.get("taskId").toString());
        return applicationService.getTaskDetail(sessionId);
    }

    // ========== 项目成员 ==========

    /** 添加项目成员 */
    @PostMapping("/member/add")
    public ResponseUtil<Void> addProjectMember(@RequestBody Map<String, Object> params) {
        return applicationService.addProjectMember(params);
    }

    /** 查询项目成员列表 */
    @PostMapping("/member/list")
    public ResponseUtil<List<ProjectMemberListDto>> listProjectMembers(@RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        return applicationService.listProjectMembers(projectId);
    }

    /** 移除项目成员 */
    @PostMapping("/member/remove")
    public ResponseUtil<Void> removeProjectMember(@RequestBody Map<String, Object> params) {
        Long memberId = Long.valueOf(params.get("memberId").toString());
        return applicationService.removeProjectMember(memberId);
    }

    /** 绑定数字员工到成员 */
    @PostMapping("/member/bindAgent")
    public ResponseUtil<Void> bindMemberAgent(@RequestBody Map<String, Object> params) {
        return applicationService.bindMemberAgent(params);
    }

    // ========== DWS 钉钉授权 ==========

    /** 启动设备授权流程（返回userCode和verificationUrl，前端打开URL让用户授权） */
    @PostMapping("/dws/startDeviceAuth")
    public ResponseUtil<Map<String, Object>> startDwsDeviceAuth() {
        return applicationService.startDwsDeviceAuth();
    }

    /** 检查DWS授权状态（前端轮询，直到tokenValid=true） */
    @PostMapping("/dws/authStatus")
    public ResponseUtil<Map<String, Object>> checkDwsAuthStatus() {
        return applicationService.checkDwsAuthStatus();
    }

    /** 直接使用token授权 */
    @PostMapping("/dws/saveToken")
    public ResponseUtil<Void> saveDwsToken(@RequestBody Map<String, Object> params) {
        String token = params.get("token") != null ? params.get("token").toString() : "";
        if (token.isEmpty()) {
            return ResponseUtil.failRes("Token不能为空");
        }
        return applicationService.saveDwsToken(token);
    }
}
