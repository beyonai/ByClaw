package com.iwhalecloud.byai.state.domain.chat.service;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;

/**
 * 统一解析聊天链路中的最终 targetAgentType。
 *
 * @author codex
 * @date 2026-04-30
 */
@Service
public class TargetAgentTypeResolver {

    /**
     * 根据基础 workerAgentType、agentId、sourceAgentType 与 userCode 计算最终 targetAgentType。
     *
     * @param workerAgentType 基础 workerAgentType
     * @param agentId 资源/数字员工标识
     * @param resumeAgentType 客户端透传的 sourceAgentType，通常用于 resume 场景
     * @param userCode 当前用户标识
     * @return 最终 targetAgentType
     */
    public String resolve(String workerAgentType, Long agentId, String resumeAgentType, String userCode) {
        String targetAgentType = workerAgentType;

        if (StringUtils.isNotBlank(targetAgentType) && targetAgentType.startsWith(WorkerAgentType.DEBUG.getCode())) {
            targetAgentType = WorkerAgentType.DEBUG.getCode() + "_" + agentId;
        }

        if (StringUtils.isNotBlank(resumeAgentType)) {
            targetAgentType = resumeAgentType;
        }

        return resolveUserSandboxAgentType(targetAgentType, userCode);
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
