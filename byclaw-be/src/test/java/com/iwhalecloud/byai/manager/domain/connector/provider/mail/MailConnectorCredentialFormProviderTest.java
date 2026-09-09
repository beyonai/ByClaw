package com.iwhalecloud.byai.manager.domain.connector.provider.mail;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.dto.users.MailServerConfigDTO;

class MailConnectorCredentialFormProviderTest {

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
