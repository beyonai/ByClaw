package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SandboxEndpointRegistryMetadataFactoryTest {

    @Test
    void build_addsQueryTokenMetadataForOpenclawAndLegacyBlankImageType() {
        SandboxEndpointRegistryMetadataFactory factory = new SandboxEndpointRegistryMetadataFactory("ztesoft");

        assertThat(factory.build("openclaw"))
            .containsEntry(SandboxEndpointRegistryMetadataFactory.AUTH_TYPE_KEY,
                SandboxEndpointRegistryMetadataFactory.QUERY_AUTH_TYPE)
            .containsEntry(SandboxEndpointRegistryMetadataFactory.AUTH_PARAM_KEY,
                SandboxEndpointRegistryMetadataFactory.TOKEN_PARAM_NAME)
            .containsEntry(SandboxEndpointRegistryMetadataFactory.TOKEN_KEY, "ztesoft");

        assertThat(factory.build(null))
            .containsEntry(SandboxEndpointRegistryMetadataFactory.TOKEN_KEY, "ztesoft");
    }

    @Test
    void build_skipsUiAgentAndBlankToken() {
        assertThat(new SandboxEndpointRegistryMetadataFactory("ztesoft").build("uiagent")).isNull();
        assertThat(new SandboxEndpointRegistryMetadataFactory("").build("openclaw")).isNull();
    }
}
