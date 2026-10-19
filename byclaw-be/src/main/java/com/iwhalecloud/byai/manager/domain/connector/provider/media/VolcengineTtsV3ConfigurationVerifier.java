package com.iwhalecloud.byai.manager.domain.connector.provider.media;

import java.net.URI;
import org.springframework.stereotype.Component;

/** Performs protocol-specific structural checks without issuing a billable synthesis request. */
@Component
public class VolcengineTtsV3ConfigurationVerifier implements MediaConnectorProtocolVerifier {

    @Override
    public boolean supports(MediaModelType modelType, String modelProtocol) {
        return modelType == MediaModelType.TTS && "VOLCENGINE_TTS_V3".equals(modelProtocol);
    }

    @Override
    public void verify(MediaModelConfig config) {
        URI endpoint = URI.create(config.apiEndpoint());
        if (!endpoint.getPath().endsWith("/api/v3/tts/unidirectional") || config.apiToken().isBlank()) {
            throw new IllegalArgumentException("Invalid Volcengine TTS v3 configuration");
        }
    }
}
