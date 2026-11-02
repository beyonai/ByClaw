package com.iwhalecloud.byai.gateway.sandbox.platform;

import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.net.URI;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "byclaw.platform.execution-mode", havingValue = "remote")
public class PlatformAlertForwarder {
    private final PlatformAlertClient client;
    private final PlatformBridgeTokens tokens;

    public PlatformAlertForwarder(
            PlatformAlertClient client, PlatformBridgeTokens tokens, Environment env) {
        String base = env.getRequiredProperty("byclaw.platform.base-url");
        URI url = URI.create(base);
        if (!("http".equals(url.getScheme()) || "https".equals(url.getScheme()))
                || url.getHost() == null
                || url.getUserInfo() != null
                || url.getRawQuery() != null
                || url.getFragment() != null)
            throw new IllegalArgumentException("Invalid platform base URL");
        this.client = client;
        this.tokens = tokens;
    }

    public ResponseUtil forward(Map<String, Object> payload, String incomingToken) {
        tokens.verify(incomingToken);
        Map<String, Object> result = client.receive(payload);
        if (result == null
                || !(result.get("code") instanceof Number)
                || ((Number) result.get("code")).intValue() != 0)
            throw new IllegalStateException("Platform alert delivery failed");
        Object data = result.get("data");
        if (!(data instanceof Map)
                || ((Map<?, ?>) data).get("status") == null
                || "FAILED".equals(((Map<?, ?>) data).get("status")))
            throw new IllegalStateException("Platform alert processing was not confirmed");
        return ResponseUtil.successResponse(data);
    }
}
