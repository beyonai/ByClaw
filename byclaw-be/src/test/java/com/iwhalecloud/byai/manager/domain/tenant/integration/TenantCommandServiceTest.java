package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Replays must be resolved before checking versions or performing any new reservation. */
class TenantCommandServiceTest {
    @Test void identicalReplayReturnsOriginalAndDifferentDigestConflicts() {
        var existing = new TenantCommandStore.Command("1","hacu","req-0001","abc","PROVISION","2","PENDING","RESERVED",null,0);
        assertSame(existing,TenantCommandService.match(existing,"abc"));
        var failure=assertThrows(TenantCommandException.class, () -> TenantCommandService.match(existing,"changed"));
        assertEquals(409,failure.status());
        assertEquals("REQUEST_ID_CONFLICT",failure.getMessage());
    }
}
