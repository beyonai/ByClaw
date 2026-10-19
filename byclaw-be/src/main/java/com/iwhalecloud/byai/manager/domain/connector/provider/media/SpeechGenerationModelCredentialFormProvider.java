package com.iwhalecloud.byai.manager.domain.connector.provider.media;

import org.springframework.stereotype.Component;

@Component
public class SpeechGenerationModelCredentialFormProvider extends AbstractMediaModelCredentialFormProvider {

    public static final String PROVIDER_CODE = "speech-generation-model";

    public SpeechGenerationModelCredentialFormProvider(
            MediaModelConfigParser parser, MediaConnectorProtocolVerifierRegistry verifierRegistry) {
        super(PROVIDER_CODE, MediaModelType.TTS, parser, verifierRegistry);
    }
}
