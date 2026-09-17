package com.iwhalecloud.byai.manager.domain.connector.provider.mail;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.dto.users.MailServerConfigDTO;

class MailConnectorCredentialFormProviderTest {

    @Test
    void verificationProducesIsolatedConfigurationWithoutWritingAnAccount() throws Exception {
        var mapper = org.mockito.Mockito.mock(com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper.class);
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        var store = new com.iwhalecloud.byai.manager.domain.mail.MailPrivateParamStore(mapper, json);
        var provider = new MailConnectorCredentialFormProvider(store) {
            @Override
            void probe(com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo connector,
                    com.iwhalecloud.byai.manager.dto.users.UserMailAccountDTO request, String secret) {
                var defaults = serverDefaults(request.getProviderCode());
                request.setImap(defaults[0]);
                request.setSmtp(defaults[1]);
            }
        };
        var connector = new com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo();
        connector.setConnectorId(11L);
        connector.setConnectorCode("qq-mail");
        connector.setConnectorName("QQ");
        var verified = provider.verify("42", connector, java.util.Map.of("email", "test@qq.com", "authCode", "test-secret"));
        assertThat(verified.runtimeEnvironment()).containsOnlyKeys("MAIL_CONNECTOR_11");
        var config = json.readTree(verified.runtimeEnvironment().get("MAIL_CONNECTOR_11"));
        assertThat(config.path("email").asText()).isEqualTo("test@qq.com");
        assertThat(config.path("imapPort").asInt()).isEqualTo(993);
        assertThat(config.path("status").asText()).isEqualTo("PENDING");
        assertThat(com.iwhalecloud.byai.common.ecrypt.Sm4Util.decrypt(config.path("authCodeCipher").asText()))
            .isEqualTo("test-secret");
        org.mockito.Mockito.verifyNoInteractions(mapper);
    }

    @Test
    void fillsNativeProviderServerSettingsBeforeProbe() {
        MailServerConfigDTO[] servers = MailConnectorCredentialFormProvider.serverDefaults("qq");

        assertThat(servers).hasSize(2);
        assertThat(servers[0].getHost()).isEqualTo("imap.qq.com");
        assertThat(servers[0].getPort()).isEqualTo(993);
        assertThat(servers[1].getHost()).isEqualTo("smtp.qq.com");
        assertThat(servers[1].getPort()).isEqualTo(465);
    }
}
