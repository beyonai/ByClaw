package com.iwhalecloud.byai.manager.domain.connector.provider.media;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class OpenAiImageConfigurationVerifierTest {

    private final OpenAiImageConfigurationVerifier verifier = new OpenAiImageConfigurationVerifier();

    @Test
    void acceptsOpenAiCompatibleImageEndpoint() {
        verifier.verify(config("https://api.example.com/v1/images/generations"));
    }

    @Test
    void rejectsEndpointThatIsNotAnImageGenerationRoute() {
        assertThatThrownBy(() -> verifier.verify(config("https://api.example.com/v1/chat/completions")))
            .isInstanceOf(IllegalArgumentException.class);
    }

    private MediaModelConfig config(String endpoint) {
        return new MediaModelConfig(1, "revision", "image-generation-model", "image", "image-v1",
            MediaModelType.IMAGE, "OPENAI_IMAGE", endpoint, "token", List.of(), 30, 60, 1, 1, Map.of());
    }
}
