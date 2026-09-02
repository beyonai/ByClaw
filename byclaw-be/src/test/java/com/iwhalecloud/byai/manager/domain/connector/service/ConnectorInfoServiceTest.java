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

    @Test
    void exposesGenericCredentialFormMetadataForWeixinOfficialApi() {
        ConnectorListDto dto = credentialConnector("""
            {"credentialForm":{
              "helpUrl":"https://mp.weixin.qq.com/",
              "helpLinkText":"  前往微信开发者平台获取凭据  ",
              "helpText":"  设置与开发 → 开发接口管理 → 基本配置 → 公众号开发信息  ",
              "fields":[
                {"key":"appId","label":"AppID","inputType":"text","maxLength":256},
                {"key":"appSecret","label":"AppSecret","inputType":"password","maxLength":2048}
              ]
            }}
            """);

        ConnectorInfoService.sanitizeCredentialForm(dto);

        assertThat(dto.getCredentialForm()).isNotNull();
        assertThat(dto.getCredentialForm().getHelpUrl()).isEqualTo("https://mp.weixin.qq.com/");
        assertThat(dto.getCredentialForm().getHelpLinkText())
            .isEqualTo("前往微信开发者平台获取凭据");
        assertThat(dto.getCredentialForm().getHelpText())
            .isEqualTo("设置与开发 → 开发接口管理 → 基本配置 → 公众号开发信息");
        assertThat(dto.getCredentialForm().getFields())
            .extracting(field -> field.getKey())
            .containsExactly("appId", "appSecret");
        assertThat(JSON.toJSONString(dto)).doesNotContain("authConfig");
    }

    @Test
    void suppressesCredentialFormsWithUnsafeGenericSchema() {
        assertInvalidCredentialForm("""
            {"credentialForm":{"helpUrl":"https://mp.weixin.qq.com/","fields":[
              {"key":"app-id","label":"AppID","inputType":"text","maxLength":256}
            ]}}
            """);
        assertInvalidCredentialForm("""
            {"credentialForm":{"helpUrl":"https://mp.weixin.qq.com/","fields":[
              {"key":"appId","label":"AppID","inputType":"text","maxLength":256},
              {"key":"appId","label":"AppSecret","inputType":"password","maxLength":2048}
            ]}}
            """);
        assertInvalidCredentialForm("""
            {"credentialForm":{"helpUrl":"https://mp.weixin.qq.com/","fields":[
              {"key":"appId","label":"AppID","inputType":"email","maxLength":256}
            ]}}
            """);
        assertInvalidCredentialForm("""
            {"credentialForm":{"helpUrl":"https://mp.weixin.qq.com/","helpText":"%s","fields":[
              {"key":"appId","label":"AppID","inputType":"text","maxLength":256}
            ]}}
            """.formatted("x".repeat(501)));
        assertInvalidCredentialForm("""
            {"credentialForm":{"helpUrl":"https://mp.weixin.qq.com/","helpLinkText":"   ","fields":[
              {"key":"appId","label":"AppID","inputType":"text","maxLength":256}
            ]}}
            """);
        assertInvalidCredentialForm("""
            {"credentialForm":{"helpUrl":"https://mp.weixin.qq.com/","helpLinkText":"%s","fields":[
              {"key":"appId","label":"AppID","inputType":"text","maxLength":256}
            ]}}
            """.formatted("x".repeat(101)));
        assertInvalidCredentialForm("""
            {"credentialForm":{"helpUrl":"https://mp.weixin.qq.com/","helpLinkText":123,"fields":[
              {"key":"appId","label":"AppID","inputType":"text","maxLength":256}
            ]}}
            """);
        assertInvalidCredentialForm("""
            {"credentialForm":{"helpUrl":"https://mp.weixin.qq.com/","helpLinkText":true,"fields":[
              {"key":"appId","label":"AppID","inputType":"text","maxLength":256}
            ]}}
            """);
        assertInvalidCredentialForm("""
            {"credentialForm":{"helpUrl":"https://mp.weixin.qq.com/","helpLinkText":["link"],"fields":[
              {"key":"appId","label":"AppID","inputType":"text","maxLength":256}
            ]}}
            """);
        assertInvalidCredentialForm("""
            {"credentialForm":{"helpUrl":"https://mp.weixin.qq.com/","helpLinkText":{"text":"link"},"fields":[
              {"key":"appId","label":"AppID","inputType":"text","maxLength":256}
            ]}}
            """);
    }

    private static ConnectorListDto credentialConnector(String authConfig) {
        ConnectorListDto dto = new ConnectorListDto();
        dto.setAuthMode("AK_SK");
        dto.setAuthConfig(authConfig);
        return dto;
    }

    private static void assertInvalidCredentialForm(String authConfig) {
        ConnectorListDto dto = credentialConnector(authConfig);

        ConnectorInfoService.sanitizeCredentialForm(dto);

        assertThat(dto.getCredentialForm()).isNull();
        assertThat(JSON.toJSONString(dto)).doesNotContain("authConfig");
    }
}
