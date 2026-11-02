package com.iwhalecloud.byai.manager.domain.connector.provider.media;

public interface MediaConnectorProtocolVerifier {

    boolean supports(MediaModelType modelType, String modelProtocol);

    void verify(MediaModelConfig config);
}
