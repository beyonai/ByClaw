package com.iwhalecloud.byai.gateway.sandbox.service;

/**
 * 沙箱启动路由信息。
 * 负责描述一次启动/复用应使用的沙箱类型和幂等资源键。
 */
public class SandboxLaunchRouting {

    public static final String DEFAULT_SANDBOX_TYPE = "openclaw";

    public static final String BYCLAW_CODE_AGENT_SANDBOX_TYPE = "byclaw-code-agent";

    public static final Long DEFAULT_RESOURCE_ID = -1L;

    public static final Long DEFAULT_CODE_AGENT_RESOURCE_ID = -2L;

    private final String sandboxType;

    private final Long effectiveResourceId;

    public SandboxLaunchRouting(String sandboxType, Long effectiveResourceId) {
        this.sandboxType = sandboxType;
        this.effectiveResourceId = normalizeEffectiveResourceId(sandboxType, effectiveResourceId);
    }

    public String getSandboxType() {
        return sandboxType;
    }

    public Long getEffectiveResourceId() {
        return effectiveResourceId;
    }

    public boolean isByclawCodeAgent() {
        return BYCLAW_CODE_AGENT_SANDBOX_TYPE.equals(sandboxType);
    }

    public static Long normalizeEffectiveResourceId(String sandboxType, Long resourceId) {
        if (DEFAULT_SANDBOX_TYPE.equals(sandboxType)) {
            return DEFAULT_RESOURCE_ID;
        }
        if (BYCLAW_CODE_AGENT_SANDBOX_TYPE.equals(sandboxType)) {
            return DEFAULT_CODE_AGENT_RESOURCE_ID;
        }
        return resourceId;
    }
}
