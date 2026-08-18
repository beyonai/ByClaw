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

    @Value("${byclaw.route-by-super-to-user-sandbox:false}")
    private boolean routeBySuperToUserSandbox;

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

        if (routeBySuperToUserSandbox && agentId != null
                && WorkerAgentType.BY_SUPER.getCode().equalsIgnoreCase(targetAgentType)) {
            return buildUserAgentType(WorkerAgentType.BYCLAW_EXE, userCode);
        }

        // agentId 为空代表公共超级助手入口；不能被旧会话透传的 BYCLAW_EXE sourceAgentType 覆盖。
        if (agentId == null && WorkerAgentType.BY_SUPER.getCode().equalsIgnoreCase(targetAgentType)) {
            return WorkerAgentType.BY_SUPER.getCode();
        }

        if (StringUtils.isNotBlank(targetAgentType) && targetAgentType.startsWith(WorkerAgentType.DEBUG.getCode())) {
            targetAgentType = WorkerAgentType.DEBUG.getCode() + "_" + agentId;
        }

        if (StringUtils.isNotBlank(resumeAgentType)) {
            targetAgentType = resumeAgentType;
        }

        return resolveUserSandboxAgentType(targetAgentType, userCode);
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
        return StringUtils.equalsIgnoreCase(targetAgentType, buildUserAgentType(WorkerAgentType.BYCLAW_EXE, userCode))
            || StringUtils.equalsIgnoreCase(targetAgentType, buildUserAgentType(WorkerAgentType.BYCLAW_CODE, userCode));
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
        return targetAgentType;
    }

    private String buildUserAgentType(WorkerAgentType workerAgentType, String userCode) {
        return workerAgentType.getCode() + "_" + userCode;
    }
}
