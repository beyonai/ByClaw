package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantConfigPublisher;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TenantConfigCommandLeaseTest {
    @Test void expiredWorkerCannotPublishRedisSnapshot() {
        var redis=mock(StringRedisTemplate.class);
        var publisher=new TenantConfigPublisher(redis,new ObjectMapper());
        var rows=Map.of("DB_HOST","localhost","DB_PORT","5432","DB_NAME","byclaw_t_2","DB_USER","bc_t_2_admin",
            "DB_PASSWORD","encrypted-test-envelope","DB_SANDBOX_RECORD_ID","3","DB_CREDENTIAL_VERSION","1",
            "PROVISION_STATE","{\"status\":\"READY\",\"generation\":\"1\",\"fencingToken\":\"1\",\"commandLeaseUntilEpochSeconds\":\"1\"}");
        assertFalse(publisher.publish(2,rows));
        verifyNoInteractions(redis);
    }
}
