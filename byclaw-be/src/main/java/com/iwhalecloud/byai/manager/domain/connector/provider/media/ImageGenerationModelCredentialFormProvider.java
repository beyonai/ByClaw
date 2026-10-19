package com.iwhalecloud.byai.manager.domain.connector.provider.media;

import org.springframework.stereotype.Component;

@Component
public class ImageGenerationModelCredentialFormProvider extends AbstractMediaModelCredentialFormProvider {

    public static final String PROVIDER_CODE = "image-generation-model";

    public ImageGenerationModelCredentialFormProvider(
            MediaModelConfigParser parser, MediaConnectorProtocolVerifierRegistry verifierRegistry) {
        super(PROVIDER_CODE, MediaModelType.IMAGE, parser, verifierRegistry);
    }
}
