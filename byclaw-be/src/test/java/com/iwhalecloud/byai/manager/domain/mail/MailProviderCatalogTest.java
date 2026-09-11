package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.nio.file.Path;
import java.util.stream.StreamSupport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.vo.users.MailProviderVO;
import org.junit.jupiter.api.Test;

class MailProviderCatalogTest {

    @Test
    void removedProviderAndDefaultContractsAreAbsent() throws Exception {
        assertThat(MailProviderCatalog.list()).extracting(MailProviderVO::getCode).doesNotContain("iwhalecloud");
        ObjectMapper mapper = new ObjectMapper();
        for (Object value : List.of(
                new com.iwhalecloud.byai.manager.entity.users.UserMailAccount(),
                new com.iwhalecloud.byai.manager.dto.users.UserMailAccountDTO(),
                new com.iwhalecloud.byai.manager.vo.users.UserMailAccountVO())) {
            JsonNode serialized = mapper.valueToTree(value);
            assertThat(serialized.has("default")).isFalse();
            assertThat(serialized.has("defaultFlag")).isFalse();
            assertThat(serialized.has("defaultAccount")).isFalse();
        }
        assertThat(java.util.Arrays.stream(
            com.iwhalecloud.byai.manager.interfaces.controller.user.UserMailAccountController.class.getDeclaredMethods())
                .map(java.lang.reflect.Method::getName)).doesNotContain("setDefault");
    }

    @Test
    void exposesGuaranteedCapabilitiesAndConditionalDeleteStatus() {
        List<MailProviderVO> providers = MailProviderCatalog.list();

        assertThat(providers).extracting(MailProviderVO::getCode).containsExactly(
            "gmail", "fastmail", "qq", "netease-163", "aliyun-mail", "microsoft-365",
            "custom-imap"
        );
        assertThat(MailProviderCatalog.require("gmail").getCapabilityStatus().values()).containsOnly("YES");
        assertThat(MailProviderCatalog.require("fastmail").getCapabilityStatus().values()).containsOnly("YES");
        assertThat(MailProviderCatalog.require("microsoft-365").getCapabilityStatus().values()).containsOnly("YES");
        for (String provider : List.of("qq", "netease-163", "aliyun-mail", "custom-imap")) {
            assertThat(MailProviderCatalog.require(provider).getCapabilities()).containsExactly(
                "list", "get", "search", "downloadAttachment", "send", "reply");
            assertThat(MailProviderCatalog.require(provider).getCapabilityStatus().get("delete"))
                .isEqualTo("CONDITIONAL_MOVE_OR_UIDPLUS");
        }
        assertThat(MailProviderCatalog.require("qq").getSetupRequirements()).containsExactly(
            "ENABLE_IMAP_SMTP", "USE_AUTHORIZATION_CODE");
        assertThat(MailProviderCatalog.require("aliyun-mail").getSetupRequirements()).containsExactly(
            "ADMIN_ENABLE_THIRD_PARTY_CLIENT", "USE_SECURITY_PASSWORD");
    }

    @Test
    void suppliesProviderTransportAuthenticationAndDefaultServers() {
        MailProviderVO gmail = MailProviderCatalog.require("gmail");
        assertThat(gmail.getName()).isEqualTo("Gmail");
        assertThat(gmail.getTransport()).isEqualTo("Gmail API");
        assertThat(gmail.getAuthType()).isEqualTo("OAUTH2");
        assertThat(gmail.getConnectorCode()).isEqualTo("gmail-mail");
        assertThat(gmail.getImap()).isNull();
        assertThat(gmail.getSmtp()).isNull();

        MailProviderVO qq = MailProviderCatalog.require("qq");
        assertThat(qq.getTransport()).isEqualTo("IMAP_SMTP");
        assertThat(qq.getAuthType()).isEqualTo("APP_PASSWORD");
        assertThat(qq.getImap().getHost()).isEqualTo("imap.qq.com");
        assertThat(qq.getImap().getPort()).isEqualTo(993);
        assertThat(qq.getImap().getEncryption()).isEqualTo("ssl");
        assertThat(qq.getSmtp().getHost()).isEqualTo("smtp.qq.com");
        assertThat(qq.getSmtp().getPort()).isEqualTo(465);
        assertThat(qq.getSmtp().getEncryption()).isEqualTo("ssl");

        assertThat(MailProviderCatalog.require("custom-imap").getAdvancedServerEditable()).isTrue();
        assertThat(MailProviderCatalog.list().stream()
            .filter(provider -> !"custom-imap".equals(provider.getCode())))
            .allSatisfy(provider -> assertThat(provider.getAdvancedServerEditable()).isFalse());
    }

    @Test
    void rejectsUnknownProvider() {
        assertThatThrownBy(() -> MailProviderCatalog.require("unknown"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("unknown");
    }

    @Test
    void serverConfigurationsAreDeeplyImmutable() {
        MailProviderCatalog.require("qq").getImap().setHost("mutated.example.com");

        assertThat(MailProviderCatalog.require("qq").getImap().getHost()).isEqualTo("imap.qq.com");
        assertThat(MailProviderCatalog.list().stream()
            .filter(provider -> "qq".equals(provider.getCode()))
            .findFirst()
            .orElseThrow()
            .getImap()
            .getHost()).isEqualTo("imap.qq.com");
    }

    @Test
    void sharedProjectionFixtureMatchesCatalogCapabilityMetadata() throws Exception {
        for (String code : List.of("qq-mail", "netease-163-mail", "gmail-mail", "custom-imap-mail")) {
            Path fixture = Path.of("../middleware/openclaw/skills/mail/tests/fixtures", code + ".json").normalize();
            JsonNode account = new ObjectMapper().readTree(fixture.toFile()).path("account");
            MailProviderVO provider = MailProviderCatalog.require(account.path("provider").asText());
            assertThat(StreamSupport.stream(account.path("capabilities").spliterator(), false)
                .map(JsonNode::asText).toList())
                .containsExactlyElementsOf(provider.getCapabilities());
            assertThat(account.path("capabilityStatus").path("delete").asText())
                .isEqualTo(provider.getCapabilityStatus().get("delete"));
            assertThat(StreamSupport.stream(account.path("setupRequirements").spliterator(), false)
                .map(JsonNode::asText).toList())
                .containsExactlyElementsOf(provider.getSetupRequirements());
        }
    }
}
