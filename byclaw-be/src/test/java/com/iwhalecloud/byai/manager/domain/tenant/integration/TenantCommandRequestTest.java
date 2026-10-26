package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Request identity must bind the whole business snapshot, not JSON field order or transport metadata. */
class TenantCommandRequestTest {
    private final ObjectMapper json = new ObjectMapper();
    private final String request = """
        {"sourceSystem":"hacu","requestId":"provision-001","ownerUserId":"10001",
         "enterpriseName":"Example","actor":{"type":"PLATFORM_ADMIN","id":"42"},"reason":"contract",
         "resourceSpec":{"profileKey":"m","bindingVersion":"1"},
         "initialPolicy":{"revision":"1","accessMode":"PREPARED","effectiveFrom":null,"effectiveUntil":null,
         "limits":{"memberLimit":10,"groupLimit":15,"groupMemberLimit":10,"storageBytes":"214748364800","agentLimit":50,"parallelTaskLimit":5}}}
        """;

    @Test void sameBusinessObjectHasStableHashRegardlessOfFieldOrder() throws Exception {
        var original = TenantCommandRequest.parse(json.readTree(request));
        var reordered = json.createObjectNode();
        var fields = new java.util.ArrayList<String>();
        json.readTree(request).fieldNames().forEachRemaining(fields::add);
        java.util.Collections.reverse(fields);
        for (String key : fields) reordered.set(key, json.readTree(request).get(key));
        assertEquals(original.hash(), TenantCommandRequest.parse(reordered).hash());
        reordered.put("ownerUserId", "10002");
        assertNotEquals(original.hash(), TenantCommandRequest.parse(reordered).hash());
        assertEquals(10001, original.ownerUserId());
    }

    @Test void invalidOrUnknownFieldsCannotBeSilentlyDiscarded() throws Exception {
        var value = (com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(request);
        value.put("paid", true);
        assertThrows(TenantCommandException.class, () -> TenantCommandRequest.parse(value));
        value.remove("paid");
        value.put("ownerUserId", "9223372036854775808");
        assertThrows(TenantCommandException.class, () -> TenantCommandRequest.parse(value));
        value.put("ownerUserId", 10001);
        assertThrows(TenantCommandException.class, () -> TenantCommandRequest.parse(value));
    }

    @Test void provisioningCannotStartWithEnabledPolicyOrMissingAudit() throws Exception {
        var value = (com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(request);
        ((com.fasterxml.jackson.databind.node.ObjectNode) value.get("initialPolicy")).put("accessMode", "ENABLED");
        assertThrows(TenantCommandException.class, () -> TenantCommandRequest.parse(value));
        ((com.fasterxml.jackson.databind.node.ObjectNode) value.get("initialPolicy")).put("accessMode", "PREPARED");
        value.remove("actor");
        assertThrows(TenantCommandException.class, () -> TenantCommandRequest.parse(value));
    }
}
