package com.iwhalecloud.byai.manager.domain.usermcp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.InetAddress;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;

class UserMcpConfigParserTest {

    private UserMcpConfigParser parser;

    @BeforeEach
    void setUp() throws Exception {
        InetAddress publicAddress = InetAddress.getByAddress("mcp.example.com", new byte[] {93, (byte) 184, (byte) 216, 34});
        McpEndpointPolicy endpointPolicy = new McpEndpointPolicy(host -> List.of(publicAddress), Set.of(443));
        parser = new UserMcpConfigParser(new ObjectMapper(), endpointPolicy);
    }

    @Test
    void rebuildsCanonicalNoneConfigWithoutUnknownOrSecretFields() {
        String input = """
            {
              "domainURL": "https://mcp.example.com/",
              "metaContent": {
                "mcpType": "streamable-http",
                "mcpServerUrl": "/mcp",
                "authProfile": {"mode": "NONE"}
              },
              "timeoutSeconds": 15
            }
            """;

        UserMcpPublicConfig result = parser.parse(input);
        String persisted = parser.toJson(result);

        assertThat(result.endpoint().toString()).isEqualTo("https://mcp.example.com/mcp");
        assertThat(result.authProfile().mode()).isEqualTo(UserMcpAuthMode.NONE);
        assertThat(result.endpointFingerprint()).hasSize(64);
        assertThat(persisted).contains("\"domainURL\":\"https://mcp.example.com\"")
            .contains("\"mcpServerUrl\":\"/mcp\"")
            .doesNotContain("headers", "token", "secret");
    }

    @Test
    void acceptsOnlyServerMappedStaticCredentialTypes() {
        String input = """
            {
              "domainURL": "https://mcp.example.com",
              "metaContent": {
                "mcpType": "streamable-http",
                "mcpServerUrl": "/events",
                "authProfile": {"mode": "STATIC_HEADER", "credentialType": "BEARER_TOKEN"}
              }
            }
            """;

        UserMcpPublicConfig result = parser.parse(input);

        assertThat(result.authProfile().credentialType()).isEqualTo("BEARER_TOKEN");
        assertThat(parser.toJson(result)).doesNotContain("Authorization", "value");
    }

    @Test
    void rejectsUnknownFieldsAndCredentialBearingContainers() {
        assertRejected(withTopLevel("\"headers\":{\"Authorization\":\"canary-secret\"}"));
        assertRejected(withTopLevel("\"env\":{\"TOKEN\":\"canary-secret\"}"));
        assertRejected(withTopLevel("\"unexpected\":true"));
    }

    @Test
    void rejectsUnsupportedTransportsAndAuthModes() {
        assertRejected(config("stdio", "/mcp", "NONE", null));
        assertRejected(config("sse", "/mcp", "NONE", null));
        assertRejected(config("streamable-http", "/mcp", "TOOL_DRIVEN_QR", null));
        assertRejected(config("streamable-http", "/mcp", "OAUTH2", null));
        assertRejected(config("streamable-http", "/mcp", "STATIC_HEADER", "Host"));
    }

    @Test
    void rejectsCredentialsEmbeddedInUrl() {
        assertRejected(configWithDomain("https://user:pass@mcp.example.com", "/mcp"));
        assertRejected(configWithDomain("https://mcp.example.com?token=canary-secret", "/mcp"));
    }

    private void assertRejected(String json) {
        assertThatThrownBy(() -> parser.parse(json)).isInstanceOf(IllegalArgumentException.class);
    }

    private String withTopLevel(String extra) {
        return """
            {"domainURL":"https://mcp.example.com","metaContent":{"mcpType":"sse","mcpServerUrl":"/mcp","authProfile":{"mode":"NONE"}},%s}
            """.formatted(extra);
    }

    private String config(String transport, String endpoint, String mode, String credentialType) {
        String credential = credentialType == null ? "" : ",\"credentialType\":\"" + credentialType + "\"";
        return """
            {"domainURL":"https://mcp.example.com","metaContent":{"mcpType":"%s","mcpServerUrl":"%s","authProfile":{"mode":"%s"%s}}}
            """.formatted(transport, endpoint, mode, credential);
    }

    private String configWithDomain(String domain, String endpoint) {
        return """
            {"domainURL":"%s","metaContent":{"mcpType":"sse","mcpServerUrl":"%s","authProfile":{"mode":"NONE"}}}
            """.formatted(domain, endpoint);
    }
}
