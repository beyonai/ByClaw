package com.iwhalecloud.byai.manager.domain.usermcp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.InetAddress;
import java.net.URI;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class McpEndpointPolicyTest {

    @Test
    void canonicalizesValidatedHttpsEndpoint() throws Exception {
        McpEndpointPolicy policy = policy(address(93, 184, 216, 34));

        URI endpoint = policy.validate("https://mcp.example.com/", "/api/../mcp");

        assertThat(endpoint.toString()).isEqualTo("https://mcp.example.com/mcp");
    }

    @Test
    void rejectsPrivateReservedAndMappedAddresses() throws Exception {
        for (InetAddress blocked : List.of(
                address(127, 0, 0, 1),
                address(10, 0, 0, 1),
                address(169, 254, 1, 1),
                address(192, 168, 1, 1),
                InetAddress.getByName("::1"),
                InetAddress.getByName("::ffff:127.0.0.1"))) {
            McpEndpointPolicy policy = policy(blocked);
            assertThatThrownBy(() -> policy.validate("https://mcp.example.com", "/mcp"))
                .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void rejectsHttpCustomPortsCrossOriginAndProtocolRelativeEndpoints() throws Exception {
        McpEndpointPolicy policy = policy(address(93, 184, 216, 34));

        assertThatThrownBy(() -> policy.validate("http://mcp.example.com", "/mcp"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> policy.validate("https://mcp.example.com:8443", "/mcp"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> policy.validate("https://mcp.example.com", "https://evil.example/mcp"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> policy.validate("https://mcp.example.com", "//evil.example/mcp"))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void productionPolicyRejectsAllowlistedDnsNamesToPreventDnsRebinding() {
        McpEndpointPolicy policy = new McpEndpointPolicy("mcp.example.com");

        assertThatThrownBy(() -> policy.validate("https://mcp.example.com", "/mcp"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("public IP literal");
    }

    @Test
    void productionPolicyAcceptsAnAllowlistedPublicIpLiteral() {
        SystemConfigService systemConfigService = mock(SystemConfigService.class);
        when(systemConfigService.getStringParamValueByCode("BYAI_MCP_ALLOWED_ADDRESSES")).thenReturn("8.8.8.8");
        McpEndpointPolicy policy = new McpEndpointPolicy(systemConfigService);

        assertThat(policy.validate("https://8.8.8.8", "/mcp").toString())
            .isEqualTo("https://8.8.8.8/mcp");
    }

    @Test
    void productionPolicyReadsTheLatestAdministratorAllowlist() {
        SystemConfigService systemConfigService = mock(SystemConfigService.class);
        when(systemConfigService.getStringParamValueByCode("BYAI_MCP_ALLOWED_ADDRESSES"))
            .thenReturn("8.8.8.8", "1.1.1.1", "1.1.1.1");
        McpEndpointPolicy policy = new McpEndpointPolicy(systemConfigService);

        assertThat(policy.validate("https://8.8.8.8", "/mcp")).isNotNull();
        assertThatThrownBy(() -> policy.validate("https://8.8.8.8", "/mcp"))
            .hasMessageContaining("not approved");
        assertThat(policy.validate("https://1.1.1.1", "/mcp")).isNotNull();
    }

    private McpEndpointPolicy policy(InetAddress address) {
        return new McpEndpointPolicy(host -> List.of(address), Set.of(443));
    }

    private InetAddress address(int a, int b, int c, int d) throws Exception {
        return InetAddress.getByAddress(new byte[] {(byte) a, (byte) b, (byte) c, (byte) d});
    }
}
