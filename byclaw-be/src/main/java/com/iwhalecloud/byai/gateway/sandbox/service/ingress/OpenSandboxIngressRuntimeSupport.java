package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;

import okhttp3.Request;

@Service
public class OpenSandboxIngressRuntimeSupport implements SandboxIngressRuntimeSupport {

    private final SandboxProperties sandboxProperties;

    public OpenSandboxIngressRuntimeSupport(SandboxProperties sandboxProperties) {
        this.sandboxProperties = sandboxProperties;
    }

    @Override
    public boolean supports(String storageType) {
        return !com.iwhalecloud.byai.common.storage.constants.StorageType.WHALE_AGENT.equalsIgnoreCase(storageType);
    }

    @Override
    public String baseUrl() {
        return sandboxProperties.getOpensandbox().getBaseUrl();
    }

    @Override
    public void customizeRequest(Request.Builder requestBuilder, SandboxIngressRequestContext requestContext) {
        String apiKey = sandboxProperties.getOpensandbox().getApiKey();
        if (StringUtils.hasText(apiKey)) {
            requestBuilder.header("OPEN-SANDBOX-API-KEY", apiKey.trim());
        }
    }
}
