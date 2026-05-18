package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.Map;

/**
 * 沙箱启动上下文。
 */
public class SandboxLaunchContext {

    private final String sandboxType;

    private final Map<String, String> envs;

    private final Map<String, Object> userInfo;

    private final String gatewayToken;

    public SandboxLaunchContext(String sandboxType, Map<String, String> envs, Map<String, Object> userInfo,
        String gatewayToken) {
        this.sandboxType = sandboxType;
        this.envs = envs;
        this.userInfo = userInfo;
        this.gatewayToken = gatewayToken;
    }

    public String getSandboxType() {
        return sandboxType;
    }

    public Map<String, String> getEnvs() {
        return envs;
    }

    public Map<String, Object> getUserInfo() {
        return userInfo;
    }

    public String getGatewayToken() {
        return gatewayToken;
    }
}
