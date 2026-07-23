package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import java.net.URI;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.ObjectProvider;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "recorder.browser", name = "vnc-provider", havingValue = "external", matchIfMissing = true)
public class ExternalRecorderVncProvider implements RecorderVncProvider {

    private final RecorderBrowserProperties properties;
    private final RecorderSandboxEndpointResolver endpointResolver;

    public ExternalRecorderVncProvider(RecorderBrowserProperties properties) {
        this((RecorderSandboxEndpointResolver) null, properties);
    }

    public ExternalRecorderVncProvider(RecorderSandboxEndpointResolver endpointResolver, RecorderBrowserProperties properties) {
        this.endpointResolver = endpointResolver;
        this.properties = properties;
    }

    @Autowired
    public ExternalRecorderVncProvider(ObjectProvider<RecorderSandboxEndpointResolver> endpointResolver, RecorderBrowserProperties properties) {
        this(endpointResolver.getIfAvailable(), properties);
    }

    @Override
    public RecorderVncEndpoint start(RecorderSession session) {
        if (endpointResolver != null && session != null && session.owner() != null) {
            URI endpoint = endpointResolver.resolve(session.owner(), "vnc", "");
            String vncUrl = endpoint.getRawPath()
                + (endpoint.getRawQuery() == null ? "" : "?" + endpoint.getRawQuery());
            return new RecorderVncEndpoint("external", vncUrl, properties.getGatewayHost(), 0, null, null);
        }
        return start(session == null ? null : session.sessionId());
    }

    @Override
    public RecorderVncEndpoint start(String sessionId) {
        String vncUrl = properties.getVncUrl();
        Integer gatewayPort = properties.getGatewayPort();
        if (vncUrl == null || vncUrl.isBlank() || gatewayPort == null || gatewayPort <= 0) {
            throw new RecorderBrowserException(
                "validation_failed",
                "recorder.browser.vnc-url and recorder.browser.gateway-port are required for external VNC provider",
                400
            );
        }
        String gatewayHost = properties.getGatewayHost();
        if (gatewayHost == null || gatewayHost.isBlank()) {
            gatewayHost = properties.getDaemonHost();
        }
        return new RecorderVncEndpoint("external", vncUrl, gatewayHost, gatewayPort, null, null);
    }

    @Override
    public void stop(String sessionId) {
    }

    @Override
    public void stopAll() {
    }
}
