package com.iwhalecloud.byai.manager.domain.connector.provider.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class VolcengineDigitalHumanCredentialFormProviderTest {

    private final VolcengineDigitalHumanCredentialFormProvider provider =
        new VolcengineDigitalHumanCredentialFormProvider();

    @Test
    void preservesOnlyTheFiveProjectionFieldsWithoutExportingSecretsToTheEnvironment() {
        var result = provider.verify("1001", connector(), credentials());
        assertThat(result.status().status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.status().credentialState()).isEqualTo(CredentialState.READY);
        assertThat(result.runtimeEnvironment()).isEmpty();
        assertThat(result.status().accountName()).isEqualTo("火山数字人");
        var config = JSON.parseObject(result.status().accountAttributes().get(
            VolcengineDigitalHumanCredentialFormProvider.CONFIG_ATTRIBUTE));
        assertThat(config).containsExactlyInAnyOrderEntriesOf(Map.of(
            "schemaVersion", 1, "connectorCode", "volcengine-digital-human", "enabled", true,
            "accessKeyId", "test-ak", "secretAccessKey", "test-sk"));
    }

    @Test
    void rejectsMissingExtraBlankControlAndOversizedFieldsWithoutEchoingSecrets() {
        for (Map<String, String> values : java.util.List.of(
                Map.of("accessKeyId", "test-ak"),
                Map.of("accessKeyId", "test-ak", "secretAccessKey", "test-sk", "enabled", "true"),
                Map.of("accessKeyId", " ", "secretAccessKey", "test-sk"),
                Map.of("accessKeyId", "test-ak", "secretAccessKey", "test-secret\n"),
                Map.of("accessKeyId", "test-ak", "secretAccessKey", "x".repeat(2049)))) {
            assertThatThrownBy(() -> provider.verify("1001", connector(), values))
                .isInstanceOf(IllegalArgumentException.class).hasMessageNotContaining("test-secret");
        }
        Map<String, String> nullSecret = new HashMap<>(credentials());
        nullSecret.put("secretAccessKey", null);
        assertThatThrownBy(() -> provider.verify("1001", connector(), nullSecret))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> provider.verify("1001", connector(), null))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsAnotherConnectorTemplate() {
        ConnectorInfo connector = connector();
        connector.setConnectorCode("image-generation-model");
        assertThatThrownBy(() -> provider.verify("1001", connector, credentials()))
            .isInstanceOf(IllegalArgumentException.class);
        ConnectorInfo mismatched = connector();
        mismatched.setProviderCode("another-provider");
        assertThatThrownBy(() -> provider.verify("1001", mismatched, credentials()))
            .isInstanceOf(IllegalArgumentException.class);
    }

    private ConnectorInfo connector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorCode("volcengine-digital-human");
        connector.setProviderCode("volcengine-digital-human");
        connector.setConnectorName("火山数字人");
        return connector;
    }

    private Map<String, String> credentials() {
        return Map.of("accessKeyId", "test-ak", "secretAccessKey", "test-sk");
    }
}
