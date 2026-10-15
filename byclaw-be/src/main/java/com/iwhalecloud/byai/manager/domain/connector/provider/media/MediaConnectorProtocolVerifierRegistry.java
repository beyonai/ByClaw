package com.iwhalecloud.byai.manager.domain.connector.provider.media;

import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class MediaConnectorProtocolVerifierRegistry {

    private final List<MediaConnectorProtocolVerifier> verifiers;

    public MediaConnectorProtocolVerifierRegistry(List<MediaConnectorProtocolVerifier> verifiers) {
        this.verifiers = List.copyOf(verifiers);
    }

    public MediaConnectorProtocolVerifier require(MediaModelType modelType, String modelProtocol) {
        return verifiers.stream()
            .filter(verifier -> verifier.supports(modelType, modelProtocol))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Unsupported media model protocol"));
    }
}
