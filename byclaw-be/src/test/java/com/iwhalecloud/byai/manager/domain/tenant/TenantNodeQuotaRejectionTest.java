package com.iwhalecloud.byai.manager.domain.tenant;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import static org.junit.jupiter.api.Assertions.assertEquals;

/** Known quota rejections retain their business HTTP status across the tenant Node boundary. */
class TenantNodeQuotaRejectionTest {
    @Test
    void preservesQuotaConflictAndUnavailable() {
        assertEquals(HttpStatus.CONFLICT, new TenantNodeClient.NodeRejection(409, "GROUP_MEMBER_LIMIT_EXCEEDED").getStatusCode());
        assertEquals(HttpStatus.CONFLICT, new TenantNodeClient.NodeRejection(409, "GROUP_AGENT_LIMIT_EXCEEDED").getStatusCode());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, new TenantNodeClient.NodeRejection(503, "QUOTA_UNAVAILABLE").getStatusCode());
    }

    @Test
    void unknownUpstreamCodesKeepOriginalGatewayBoundary() {
        assertEquals(HttpStatus.BAD_GATEWAY, new TenantNodeClient.NodeRejection(409, "UNKNOWN").getStatusCode());
        assertEquals(HttpStatus.BAD_GATEWAY, new TenantNodeClient.NodeRejection(503, "UNKNOWN").getStatusCode());
    }
}
