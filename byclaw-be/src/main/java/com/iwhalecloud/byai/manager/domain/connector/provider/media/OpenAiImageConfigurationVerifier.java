package com.iwhalecloud.byai.manager.domain.connector.provider.media;

import java.net.URI;
import org.springframework.stereotype.Component;

/** Performs structural validation for OpenAI-compatible image generation endpoints. */
@Component
public class OpenAiImageConfigurationVerifier implements MediaConnectorProtocolVerifier {

    @Override
    public boolean supports(MediaModelType modelType, String modelProtocol) {
        return modelType == MediaModelType.IMAGE && "OPENAI_IMAGE".equals(modelProtocol);
    }

    @Override
    public void verify(MediaModelConfig config) {
        URI endpoint = URI.create(config.apiEndpoint());
        String path = endpoint.getPath();
        if (path == null || !path.endsWith("/images/generations") || config.apiToken().isBlank()) {
            throw new IllegalArgumentException("Invalid OpenAI-compatible image configuration");
        }
    }
}
