package com.iwhalecloud.byai.manager.domain.connector.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson.JSON;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorConnectionDto;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.List;
import java.util.Map;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorListDto;

class ConnectorInfoServiceTest {

    @Test
    void exposesOAuthHelpWithoutCredentialsOrRawOAuthConfiguration() {
        ConnectorListDto dto = new ConnectorListDto();
        dto.setAuthMode("OAUTH2");
        dto.setAuthConfig("""
            {"clientSecretEnv":"PRIVATE_ENV_NAME","credentialForm":{
              "helpUrl":"https://support.google.com/accounts/answer/14012355",
              "helpText":"连接器作用：读取邮件。\\n\\n获取步骤：\\n1. 前往 Google 授权。",
              "helpLinkText":"查看授权说明","fields":[]}}
            """);
        ConnectorInfoService.sanitizeCredentialForm(dto);
        assertThat(dto.getCredentialForm()).isNotNull();
        assertThat(dto.getCredentialForm().getFields()).isEmpty();
        assertThat(dto.getCredentialForm().getHelpText()).contains("连接器作用", "获取步骤");
        assertThat(JSON.toJSONString(dto)).doesNotContain("PRIVATE_ENV_NAME", "authConfig");
    }

    @Test
    void rejectsOAuthHelpThatRequestsCredentialInput() {
        ConnectorListDto dto = new ConnectorListDto();
        dto.setAuthMode("OAUTH2");
        dto.setAuthConfig("""
            {"credentialForm":{"helpUrl":"https://support.google.com/","helpText":"授权说明",
              "fields":[{"key":"password","label":"密码","inputType":"password","maxLength":256}]}}
            """);
        ConnectorInfoService.sanitizeCredentialForm(dto);
        assertThat(dto.getCredentialForm()).isNull();
        assertThat(dto.getAuthConfig()).isNull();
    }

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
    void exposesMediaModelFieldsIncludingNumbersAndJsonTextareas() {
        ConnectorListDto dto = credentialConnector("""
            {"credentialForm":{"helpUrl":"https://docs.example.com/models","fields":[
              {"key":"modelName","label":"模型名称","inputType":"text","maxLength":256},
              {"key":"modelCode","label":"模型型号","inputType":"text","maxLength":256},
              {"key":"modelProtocol","label":"模型协议","inputType":"text","maxLength":64},
              {"key":"apiEndpoint","label":"API Endpoint","inputType":"text","maxLength":2048},
              {"key":"apiToken","label":"API Token","inputType":"password","maxLength":2048},
              {"key":"headersJson","label":"Headers (JSON)","inputType":"textarea","maxLength":8192},
              {"key":"connectTimeoutSeconds","label":"连接超时（秒）","inputType":"number","maxLength":4},
              {"key":"readTimeoutSeconds","label":"读取超时（秒）","inputType":"number","maxLength":4},
              {"key":"maxRetryCount","label":"最大重试次数","inputType":"number","maxLength":2},
              {"key":"retryIntervalSeconds","label":"重试间隔（秒）","inputType":"number","maxLength":4},
              {"key":"optionsJson","label":"高级参数 (JSON)","inputType":"textarea","maxLength":8192}
            ]}}
            """);

        ConnectorInfoService.sanitizeCredentialForm(dto);

        assertThat(dto.getCredentialForm()).isNotNull();
        assertThat(dto.getCredentialForm().getFields()).hasSize(11);
        assertThat(dto.getCredentialForm().getFields())
            .extracting(field -> field.getInputType())
            .contains("number", "textarea");
    }

    @Test
    void exposesSafeDefaultsButNeverPasswordDefaults() {
        ConnectorListDto dto = credentialConnector("""
            {"credentialForm":{"helpUrl":"https://docs.example.com/models","fields":[
              {"key":"modelProtocol","label":"模型协议","inputType":"text","maxLength":64,
               "defaultValue":"OPENAI_IMAGE","placeholder":"OPENAI_IMAGE",
               "description":"当前仅支持 OPENAI_IMAGE。","advanced":true},
              {"key":"apiToken","label":"API Token","inputType":"password","maxLength":2048,
               "defaultValue":"must-not-leak"},
              {"key":"connectTimeoutSeconds","label":"连接超时（秒）","inputType":"number","maxLength":4,
               "defaultValue":"30"}
            ]}}
            """);

        ConnectorInfoService.sanitizeCredentialForm(dto);

        assertThat(dto.getCredentialForm()).isNotNull();
        assertThat(dto.getCredentialForm().getFields())
            .extracting(field -> field.getDefaultValue())
            .containsExactly("OPENAI_IMAGE", null, "30");
        assertThat(dto.getCredentialForm().getFields().get(0).getPlaceholder()).isEqualTo("OPENAI_IMAGE");
        assertThat(dto.getCredentialForm().getFields().get(0).getDescription())
            .isEqualTo("当前仅支持 OPENAI_IMAGE。");
        assertThat(dto.getCredentialForm().getFields().get(0).getAdvanced()).isTrue();
        assertThat(dto.getCredentialForm().getFields().get(1).getAdvanced()).isFalse();
        assertThat(JSON.toJSONString(dto)).doesNotContain("must-not-leak", "authConfig");
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

    @Test
    void connectorListProjectsPermissionWarningWithoutExposingBindingMetadata() throws Exception {
        ConnectorListDto dto = new ConnectorListDto();
        dto.setAuthCredential(permissionMetadata());
        assertThat(JSON.toJSONString(dto)).doesNotContain("authCredential", "private-ref");
        assertThat(new ObjectMapper().writeValueAsString(dto)).doesNotContain("authCredential", "private-ref");

        ConnectorInfoService.sanitizePermissionSummary(dto);

        assertThat(dto.getPermissionStatus()).isEqualTo("partial");
        assertThat(dto.getMissingScopes()).containsExactly("contact:user.email:readonly");
        assertThat(dto.getAuthCredential()).isNull();
        assertThat(JSON.toJSONString(dto)).doesNotContain("private-ref", "authorizationId");
    }

    @Test
    void connectionsProjectTheSamePermissionSummaryAfterRefresh() throws Exception {
        ConnectorConnectionDto dto = new ConnectorConnectionDto();
        dto.setAuthCredential(permissionMetadata());
        assertThat(new ObjectMapper().writeValueAsString(dto)).doesNotContain("authCredential", "private-ref");
        assertThat(JSON.toJSONString(dto)).doesNotContain("authCredential", "private-ref");
        ConnectorInfoMapper mapper = mock(ConnectorInfoMapper.class);
        when(mapper.selectConnectionsByUserId("user-1")).thenReturn(List.of(dto));
        ConnectorInfoService service = new ConnectorInfoService();
        ReflectionTestUtils.setField(service, "connectorInfoMapper", mapper);

        assertThat(service.listConnections("user-1")).containsExactly(dto);
        assertThat(dto.getPermissionStatus()).isEqualTo("partial");
        assertThat(dto.getMissingScopes()).containsExactly("contact:user.email:readonly");
        assertThat(dto.getAuthCredential()).isNull();
    }

    @Test
    void legacyAndUnreadableBindingsDoNotIntroducePermissionWarnings() {
        for (String cipher : new String[] {null, "invalid-cipher", Sm4Util.encrypt("{\"accountId\":\"account-1\"}")}) {
            ConnectorListDto dto = new ConnectorListDto();
            dto.setAuthCredential(cipher);
            ConnectorInfoService.sanitizePermissionSummary(dto);
            assertThat(dto.getPermissionStatus()).isNull();
            assertThat(dto.getMissingScopes()).isEmpty();
            assertThat(dto.getAuthCredential()).isNull();
        }
    }

    private static String permissionMetadata() {
        return Sm4Util.encrypt(JSON.toJSONString(Map.of(
            "permissionStatus", "partial", "missingScopes", "[\"contact:user.email:readonly\"]",
            "credentialReference", "private-ref", "authorizationId", "private-authorization")));
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
