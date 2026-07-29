package com.iwhalecloud.byai.state.application.service.recorder;

public record RecorderVncEndpoint(
    String provider,
    String vncUrl,
    String gatewayHost,
    int gatewayPort,
    String containerName,
    Integer vncPort
) {
}
