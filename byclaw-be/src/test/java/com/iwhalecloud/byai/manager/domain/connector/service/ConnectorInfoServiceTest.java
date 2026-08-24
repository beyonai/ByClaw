package com.iwhalecloud.byai.manager.domain.connector.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorListDto;

class ConnectorInfoServiceTest {

    @Test
    void exposesOnlyWhitelistedImaCredentialFormMetadata() {
        ConnectorListDto dto = new ConnectorListDto();
        dto.setAuthMode("AK_SK");
        dto.setAuthConfig("""
            {"credentialForm":{"helpUrl":"https://ima.qq.com/agent-interface","fields":[
              {"key":"clientId","label":"Client ID","inputType":"text","maxLength":256},
              {"key":"apiKey","label":"API Key","inputType":"password","maxLength":2048}
            ]}}
            """);

        ConnectorInfoService.sanitizeCredentialForm(dto);

        assertThat(dto.getCredentialForm()).isNotNull();
        assertThat(dto.getCredentialForm().getHelpUrl()).isEqualTo("https://ima.qq.com/agent-interface");
        assertThat(dto.getCredentialForm().getFields())
            .extracting(field -> field.getKey())
            .containsExactly("clientId", "apiKey");
        assertThat(JSON.toJSONString(dto)).doesNotContain("authConfig", "apiKeyValue", "clientIdValue");
    }

    @Test
    void suppressesInvalidCredentialFormMetadataAndNeverSerializesRawConfig() {
        ConnectorListDto dto = new ConnectorListDto();
        dto.setAuthMode("AK_SK");
        dto.setAuthConfig("""
            {"credentialForm":{"helpUrl":"http://ima.qq.com/agent-interface","fields":[]}}
            """);

        ConnectorInfoService.sanitizeCredentialForm(dto);

        assertThat(dto.getCredentialForm()).isNull();
        assertThat(JSON.toJSONString(dto)).doesNotContain("authConfig", "http://ima.qq.com");
    }
}
