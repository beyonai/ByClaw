package com.iwhalecloud.byai.state.application.service.recorder;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "recorder.browser", name = "vnc-provider", havingValue = "external", matchIfMissing = true)
public class ExternalRecorderVncProvider implements RecorderVncProvider {

    private final RecorderBrowserProperties properties;

    public ExternalRecorderVncProvider(RecorderBrowserProperties properties) {
        this.properties = properties;
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
