package com.iwhalecloud.byai.manager.domain.connector.provider.media;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialFormProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialFormVerification;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import java.util.Date;
import java.util.Map;

abstract class AbstractMediaModelCredentialFormProvider implements ConnectorCredentialFormProvider {

    private final String providerCode;
    private final MediaModelType modelType;
    private final MediaModelConfigParser parser;
    private final MediaConnectorProtocolVerifierRegistry verifierRegistry;

    AbstractMediaModelCredentialFormProvider(
            String providerCode,
            MediaModelType modelType,
            MediaModelConfigParser parser,
            MediaConnectorProtocolVerifierRegistry verifierRegistry) {
        this.providerCode = providerCode;
        this.modelType = modelType;
        this.parser = parser;
        this.verifierRegistry = verifierRegistry;
    }

    @Override
    public String providerCode() {
        return providerCode;
    }

    @Override
    public CredentialFormVerification verify(
            String userId, ConnectorInfo connector, Map<String, String> credentials) {
        if (connector == null || !providerCode.equals(connector.getConnectorCode())
                || !providerCode.equals(connector.getProviderCode())) {
            throw new IllegalArgumentException("Media connector template mismatch");
        }
        MediaModelConfig config = parser.parse(credentials, modelType, providerCode);
        verifierRegistry.require(modelType, config.modelProtocol()).verify(config);
        AuthorizationStatusResult status = AuthorizationStatusResult.connected(
            null,
            config.modelName(),
            CredentialState.READY,
            CredentialRenewalMode.NONE,
            null,
            null,
            new Date(),
            null,
            Map.of(MediaModelConfigParser.MEDIA_MODEL_CONFIG_ATTRIBUTE, parser.serialize(config))
        );
        return new CredentialFormVerification(status, Map.of());
    }
}
