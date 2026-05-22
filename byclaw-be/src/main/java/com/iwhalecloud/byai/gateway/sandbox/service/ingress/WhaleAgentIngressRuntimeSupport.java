package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;

import okhttp3.Request;

@Service
public class WhaleAgentIngressRuntimeSupport implements SandboxIngressRuntimeSupport {

    private final String whaleAgentUrl;
    private final SandboxProperties sandboxProperties;

    public WhaleAgentIngressRuntimeSupport(@Value("${feign.whale-agent.url:}") String whaleAgentUrl,
                                           SandboxProperties sandboxProperties) {
        this.whaleAgentUrl = whaleAgentUrl;
        this.sandboxProperties = sandboxProperties;
    }

    @Override
    public boolean supports(String storageType) {
        return com.iwhalecloud.byai.common.storage.constants.StorageType.WHALE_AGENT.equalsIgnoreCase(storageType);
    }

    @Override
    public String baseUrl() {
        if (StringUtils.hasText(whaleAgentUrl)) {
            return whaleAgentUrl;
        }
        return sandboxProperties.getOpensandbox().getBaseUrl();
    }

    @Override
    public void customizeRequest(Request.Builder requestBuilder, SandboxIngressRequestContext requestContext) {
        // WhaleAgent 暂不额外改写请求头，保持透传。
    }
}
