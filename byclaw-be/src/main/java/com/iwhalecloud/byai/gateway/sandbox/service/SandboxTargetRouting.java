package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.function.Supplier;

/** 对话最终 Worker 目标决定沙箱类型；不重复执行业务覆盖规则。 */
public final class SandboxTargetRouting {
    private SandboxTargetRouting() { }

    public static SandboxLaunchRouting resolve(String userCode, String targetAgentType,
            Supplier<SandboxLaunchRouting> originalRouting) {
        if (userCode != null && !userCode.trim().isEmpty()) {
            // Managed target is authenticated and selected by TargetAgentResolver before this routing helper.
            if ((targetAgentType != null && targetAgentType.startsWith("BYCLAW_DSH_SHARED_"))
                    || matches("BYCLAW_DSH", userCode, targetAgentType)
                    || matches("HARNESS", userCode, targetAgentType)) {
                return new SandboxLaunchRouting(SandboxLaunchRouting.BYCLAW_DSH_SANDBOX_TYPE,
                    SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
            }
            if (matches("BYCLAW_CODE", userCode, targetAgentType)) {
                return new SandboxLaunchRouting(SandboxLaunchRouting.BYCLAW_CODE_AGENT_SANDBOX_TYPE,
                    SandboxLaunchRouting.DEFAULT_CODE_AGENT_RESOURCE_ID);
            }
            if (matches("BYCLAW_EXE", userCode, targetAgentType)) {
                SandboxLaunchRouting original = originalRouting.get();
                // 保留 OpenClaw 已选档位，其他类型不能覆盖本次明确的 OpenClaw 目标。
                return original != null && SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE.equals(original.getSandboxType())
                    ? original : new SandboxLaunchRouting(SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE,
                        SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
            }
        }
        return originalRouting.get();
    }

    private static boolean matches(String type, String user, String target) {
        return (type + "_" + user).equalsIgnoreCase(target);
    }
}
