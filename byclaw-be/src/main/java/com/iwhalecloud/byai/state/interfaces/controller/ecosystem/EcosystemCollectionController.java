package com.iwhalecloud.byai.state.interfaces.controller.ecosystem;

import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.application.service.ecosystem.EcosystemCollectionApplicationService;
import com.iwhalecloud.byai.manager.dto.ecosystem.EcosystemAgentHeartbeatRequest;
import com.iwhalecloud.byai.manager.dto.ecosystem.EcosystemRunStartRequest;
import com.iwhalecloud.byai.manager.dto.ecosystem.EcosystemTaskCreateRequest;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemAgentStatusVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemConnectorVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemRunVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemTaskVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 生态采集接口。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@RestController
@RequestMapping("/ecosystemCollection")
public class EcosystemCollectionController {

    /**
     * 生态采集应用服务，承载连接器、任务、运行和聊天技能入口的业务编排。
     */
    @Autowired
    private EcosystemCollectionApplicationService ecosystemCollectionApplicationService;

    /**
     * 查询当前启用的生态连接器能力清单。
     *
     * @return 连接器列表
     */
    @GetMapping("/connectors")
    public ResponseUtil<List<EcosystemConnectorVo>> listConnectors() {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.connector.query.success"),
            ecosystemCollectionApplicationService.listConnectors());
    }

    /**
     * 查询当前用户最近一次本机采集端状态。
     *
     * @return 本机采集端状态
     */
    @GetMapping("/localAgent/status")
    public ResponseUtil<EcosystemAgentStatusVo> getLocalAgentStatus() {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.local.agent.status.query.success"),
            ecosystemCollectionApplicationService.getLocalAgentStatus());
    }

    /**
     * 查询当前用户保存的连接配置，可按连接器过滤。
     *
     * @param connectorCode 连接器编码
     * @return 连接配置列表
     */
    @GetMapping("/connections")
    public ResponseUtil<List<Map<String, Object>>> listConnections(
        @RequestParam(value = "connectorCode", required = false) String connectorCode) {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.connection.query.success"),
            ecosystemCollectionApplicationService.listConnections(connectorCode));
    }

    /**
     * 新增或更新连接配置。
     *
     * @param request 连接器、认证方式、运行位置、凭据和运行时配置
     * @return 保存后的安全视图，不返回明文密钥
     */
    @PostMapping("/connections")
    public ResponseUtil<Map<String, Object>> saveConnection(@RequestBody Map<String, Object> request) {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.connection.save.success"),
            ecosystemCollectionApplicationService.saveConnection(request));
    }

    /**
     * 接收本机采集端心跳，更新 OpenCLI、Browser Bridge 和站点登录态状态。
     *
     * @param request 心跳请求
     * @return 最新采集端状态
     */
    @PostMapping("/localAgent/heartbeat")
    public ResponseUtil<EcosystemAgentStatusVo> heartbeat(@RequestBody EcosystemAgentHeartbeatRequest request) {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.local.agent.heartbeat.success"),
            ecosystemCollectionApplicationService.heartbeat(request));
    }

    /**
     * 由后端主动检测本机 OpenCLI 运行时状态。
     *
     * @return 检测后的采集端状态
     */
    @PostMapping("/localAgent/detect")
    public ResponseUtil<EcosystemAgentStatusVo> detectLocalAgent() {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.local.agent.detect.success"),
            ecosystemCollectionApplicationService.detectLocalAgent());
    }

    /**
     * 创建生态采集任务。
     *
     * @param request 采集来源、范围、入库目标、调度和信号配置
     * @return 创建后的任务视图
     */
    @PostMapping("/tasks")
    public ResponseUtil<EcosystemTaskVo> createTask(@RequestBody EcosystemTaskCreateRequest request) {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.task.create.success"),
            ecosystemCollectionApplicationService.createTask(request));
    }

    /**
     * 查询当前用户的生态采集任务列表。
     *
     * @return 任务列表
     */
    @GetMapping("/tasks")
    public ResponseUtil<List<EcosystemTaskVo>> listTasks() {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.task.query.success"),
            ecosystemCollectionApplicationService.listTasks());
    }

    /**
     * 更新采集任务状态，例如禁用或归档。
     *
     * @param request 包含 taskId 和 status
     * @return 更新后的任务视图
     */
    @PostMapping("/tasks/status")
    public ResponseUtil<EcosystemTaskVo> updateTaskStatus(@RequestBody Map<String, Object> request) {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.task.status.update.success"),
            ecosystemCollectionApplicationService.updateTaskStatus(request));
    }

    /**
     * 手动启动一次采集运行。
     *
     * @param request 包含任务 ID 和触发来源
     * @return 运行结果
     */
    @PostMapping("/runs/start")
    public ResponseUtil<EcosystemRunVo> startRun(@RequestBody EcosystemRunStartRequest request) {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.run.start.success"),
            ecosystemCollectionApplicationService.startRun(request));
    }

    /**
     * 查询一次采集运行详情。
     *
     * @param runId 运行 ID
     * @return 运行详情、步骤、产物和信号
     */
    @GetMapping("/runs/detail")
    public ResponseUtil<EcosystemRunVo> getRun(@RequestParam("runId") Long runId) {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.run.query.success"),
            ecosystemCollectionApplicationService.getRun(runId));
    }

    /**
     * 处理运行中的用户动作，例如重试、重新检测本机采集端、跳过或确认。
     *
     * @param request 包含 runId 和 action
     * @return 处理后的运行详情
     */
    @PostMapping("/runs/action")
    public ResponseUtil<EcosystemRunVo> handleRunAction(@RequestBody Map<String, Object> request) {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.run.action.success"),
            ecosystemCollectionApplicationService.handleRunAction(request));
    }

    /**
     * 从聊天入口构建采集计划卡片。
     *
     * @param request 聊天原文、链接、知识库目标等上下文
     * @return 采集计划、缺失动作和操作卡片
     */
    @PostMapping("/chat/plan")
    public ResponseUtil<Map<String, Object>> buildChatPlan(@RequestBody Map<String, Object> request) {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.chat.plan.success"),
            ecosystemCollectionApplicationService.buildChatPlan(request));
    }

    /**
     * 从 OpenClaw 技能入口构建采集计划。
     *
     * @param request 技能解析出的采集上下文
     * @return 采集计划、缺失动作和操作卡片
     */
    @PostMapping("/skill/plan")
    public ResponseUtil<Map<String, Object>> buildSkillPlan(@RequestBody Map<String, Object> request) {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.skill.plan.success"),
            ecosystemCollectionApplicationService.buildSkillPlan(request));
    }

    /**
     * 从聊天入口确认并启动采集。
     *
     * @param request 采集计划或直接采集参数
     * @return 创建的任务和运行结果
     */
    @PostMapping("/chat/start")
    public ResponseUtil<Map<String, Object>> startChatCollection(@RequestBody Map<String, Object> request) {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.chat.start.success"),
            ecosystemCollectionApplicationService.startChatCollection(request));
    }

    /**
     * 从 OpenClaw 技能入口确认并启动采集。
     *
     * @param request 采集计划或直接采集参数
     * @return 创建的任务和运行结果
     */
    @PostMapping("/skill/start")
    public ResponseUtil<Map<String, Object>> startSkillCollection(@RequestBody Map<String, Object> request) {
        return ResponseUtil.successResponse(I18nUtil.get("ecosystem.skill.start.success"),
            ecosystemCollectionApplicationService.startSkillCollection(request));
    }
}
