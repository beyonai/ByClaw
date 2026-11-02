package com.iwhalecloud.byai.state.domain.chat.service;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;

/**
 * 统一解析聊天链路中的最终 targetAgent。
 *
 * @author codex
 * @date 2026-04-30
 */
@Service
public class TargetAgentResolver {

    private static final Logger logger = LoggerFactory.getLogger(TargetAgentResolver.class);

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SystemParamTargetAgentResolver systemParamTargetAgentResolver;

    @Autowired(required = false)
    private com.iwhalecloud.byai.gateway.sandbox.shared.SharedSandboxGateway sharedSandboxGateway;

    @Value("${byclaw.super-enabled:false}")
    private boolean superEnabled;

    /** 将服务端最终路由转换为前端可消费的运行时类型。 */
    public String resolveRuntimeType(String targetAgentType) {
        if (StringUtils.startsWith(targetAgentType, WorkerAgentType.BYCLAW_DSH.getCode())
                || StringUtils.startsWith(targetAgentType, WorkerAgentType.HARNESS.getCode())) {
            return "dsh";
        }
        return StringUtils.isBlank(targetAgentType) ? "unknown" : "openclaw";
    }

    /**
     * 根据基础 workerAgentType、agentId、sourceAgentType 与 userCode 计算最终 targetAgentType。
     *
     * @param workerAgentType 基础 workerAgentType
     * @param agentId 资源/数字员工标识
     * @param resumeAgentType 客户端透传的 sourceAgentType，通常用于 resume 场景
     * @param userCode 当前用户标识
     * @return 最终 targetAgentType
     */
    public String resolveAgentType(String workerAgentType, Long agentId, String resumeAgentType, String userCode) {
        String targetAgentType = workerAgentType;

        if (StringUtils.isNotBlank(targetAgentType)
                && targetAgentType.startsWith(WorkerAgentType.DEBUG.getCode())) {
            targetAgentType = WorkerAgentType.DEBUG.getCode() + "_" + agentId;
        }

        targetAgentType = resolveUserSandboxAgentType(targetAgentType, userCode);
        if (StringUtils.isNotBlank(resumeAgentType)) {
            targetAgentType = resumeAgentType;
        }
        else {
            targetAgentType = systemParamTargetAgentResolver.resolve(targetAgentType, agentId, userCode);
        }
        // 在所有覆盖规则之后执行，防止历史 Resume 或资源配置绕过 Super 兼容开关。
        if (!superEnabled && WorkerAgentType.BY_SUPER.getCode().equalsIgnoreCase(targetAgentType)) {
            targetAgentType = buildUserAgentType(WorkerAgentType.HARNESS, userCode);
        }
        targetAgentType = resolveRuntimeAgentType(targetAgentType, userCode);
        if (sharedSandboxGateway != null && StringUtils.startsWith(targetAgentType, "BYCLAW_DSH")) {
            var shared = sharedSandboxGateway.tryAcquire(userCode, "byclaw-dsh");
            if (shared != null) {
                if (StringUtils.isBlank(shared.getWorkerAgentType())) {
                    throw new IllegalStateException("共享沙箱映射缺少 Worker 路由");
                }
                return shared.getWorkerAgentType();
            }
            // 客户端不能用旧映射的 resume target 绕过当前用户路由。
            if (targetAgentType.startsWith("BYCLAW_DSH_SHARED_")) {
                return buildUserAgentType(WorkerAgentType.BYCLAW_DSH, userCode);
            }
        }
        return targetAgentType;
    }

    /**
     * 根据对话入参解析最终 agentId。BY_SUPER 默认超级助手保留资源 ID，
     * 尚未迁移的默认超级助手继续沿用 Gateway main 路由。
     *
     * @param assistantChatDto 对话请求参数
     * @return 最终 agentId
     */
    public Long resolveAgentId(AssistantChatDto assistantChatDto) {
        if (assistantChatDto == null) {
            return null;
        }
        return resolveAgentId(assistantChatDto.getAgentId());
    }

    /**
     * 根据 agentId 解析最终 agentId。已迁移到 BY_SUPER 的默认超级助手保留真实资源 ID；
     * 尚未迁移的默认超级助手继续沿用 Gateway main 路由并返回 null。
     *
     * @param agentId 数字员工标识
     * @return 最终 agentId
     */
    public Long resolveAgentId(Long agentId) {
        if (agentId == null) {
            return null;
        }
        SsResource ssResource = ssResourceService.findById(agentId);
        if (ssResource == null) {
            return agentId;
        }
        boolean isDigitalEmployee = Constants.ResourceBizType.DIG_EMPLOYEE.equals(ssResource.getResourceBizType());
        boolean isDefaultSuperAssistant = StringUtils.endsWith(ssResource.getResourceCode(), "main");
        boolean routesToSuperWorker =
            WorkerAgentType.BY_SUPER.getCode().equalsIgnoreCase(ssResource.getWorkerAgentType());
        if (isDigitalEmployee && isDefaultSuperAssistant && !routesToSuperWorker) {
            logger.info("识别到默认超级助手，清空agentId以沿用main路由, userId={}, agentId={}, resourceCode={}",
                CurrentUserHolder.getCurrentUserId(), agentId, ssResource.getResourceCode());
            return null;
        }
        return agentId;
    }

    public boolean isUserSandboxAgentType(String targetAgentType, String userCode) {
        return (sharedSandboxGateway != null && StringUtils.startsWith(targetAgentType, "BYCLAW_DSH_SHARED_")
                && targetAgentType.equals(sharedSandboxGateway.currentWorkerTarget(userCode)))
            || StringUtils.equalsIgnoreCase(targetAgentType, buildUserAgentType(WorkerAgentType.BYCLAW_EXE, userCode))
            || StringUtils.equalsIgnoreCase(targetAgentType, buildUserAgentType(WorkerAgentType.BYCLAW_CODE, userCode))
            || StringUtils.equalsIgnoreCase(targetAgentType, buildUserAgentType(WorkerAgentType.HARNESS, userCode))
            || StringUtils.equalsIgnoreCase(targetAgentType,
                buildUserAgentType(WorkerAgentType.BYCLAW_DSH, userCode));
    }

    private String resolveUserSandboxAgentType(String targetAgentType, String userCode) {
        if (StringUtils.isBlank(targetAgentType)) {
            return targetAgentType;
        }
        if (targetAgentType.startsWith(WorkerAgentType.BYCLAW_EXE.getCode())) {
            return buildUserAgentType(WorkerAgentType.BYCLAW_EXE, userCode);
        }
        if (targetAgentType.startsWith(WorkerAgentType.BYCLAW_CODE.getCode())) {
            return buildUserAgentType(WorkerAgentType.BYCLAW_CODE, userCode);
        }
        if (targetAgentType.startsWith(WorkerAgentType.HARNESS.getCode())) {
            return buildUserAgentType(WorkerAgentType.HARNESS, userCode);
        }
        return targetAgentType;
    }

    private String resolveRuntimeAgentType(String targetAgentType, String userCode) {
        // HARNESS 是数据库中的稳定逻辑类型；当前运行时使用 DeepSeek Harness（DSH），后续可替换为其他实现。
        if (StringUtils.startsWith(targetAgentType, WorkerAgentType.HARNESS.getCode())
                || StringUtils.equals(targetAgentType, WorkerAgentType.BYCLAW_DSH.getCode())) {
            return buildUserAgentType(WorkerAgentType.BYCLAW_DSH, userCode);
        }
        return targetAgentType;
    }

    private String buildUserAgentType(WorkerAgentType workerAgentType, String userCode) {
        return workerAgentType.getCode() + "_" + userCode;
    }

}
