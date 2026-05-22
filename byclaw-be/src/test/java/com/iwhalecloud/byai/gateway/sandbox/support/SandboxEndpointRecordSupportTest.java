package com.iwhalecloud.byai.gateway.sandbox.support;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class SandboxEndpointRecordSupportTest {

    @Test
    void parseEndpointRecord_flattensNestedJsonEndpointValue() {
        SandboxEndpointRecordSupport.EndpointRecordParseResult result =
            SandboxEndpointRecordSupport.parseEndpointRecord(
                "{\"openclaw\":\"{\\\"openclaw\\\":\\\"http://host/chat?token=old\\\"}\"}");

        assertThat(result.malformedJson()).isFalse();
        assertThat(result.instanceEndpoints())
            .containsEntry("openclaw", "http://host/chat?token=old");
    }

    @Test
    void parseEndpointRecord_marksIncompleteJsonAsMalformedAndPreservesRawValue() {
        String rawEndpoint = "{\"openclaw\":\"{\\\"openclaw\\\":\\\"http://host/chat?token=old";

        SandboxEndpointRecordSupport.EndpointRecordParseResult result =
            SandboxEndpointRecordSupport.parseEndpointRecord(rawEndpoint);

        assertThat(result.malformedJson()).isTrue();
        assertThat(result.rawValue()).isEqualTo(rawEndpoint);
        assertThat(result.instanceEndpoints())
            .containsEntry("openclaw", rawEndpoint);
    }
}
