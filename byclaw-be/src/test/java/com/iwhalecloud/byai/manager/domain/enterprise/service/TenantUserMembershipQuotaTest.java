package com.iwhalecloud.byai.manager.domain.enterprise.service;

import com.iwhalecloud.byai.common.quota.QuotaSnapshot;
import com.iwhalecloud.byai.common.quota.SharedQuotaAdmission;
import com.iwhalecloud.byai.manager.entity.enterprise.TenantUserMembership;
import com.iwhalecloud.byai.manager.mapper.enterprise.TenantUserMembershipMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class TenantUserMembershipQuotaTest {
    private final TenantUserMembershipMapper mapper = mock(TenantUserMembershipMapper.class);
    private final SharedQuotaAdmission quota = mock(SharedQuotaAdmission.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final TenantUserMembershipService service = new TenantUserMembershipService();
    private final Optional<QuotaSnapshot> snapshot = Optional.of(new QuotaSnapshot(42, "1", 1, 3, 3, 3));
    @BeforeEach void setup() {
        ReflectionTestUtils.setField(service, "tenantUserMembershipMapper", mapper);
        ReflectionTestUtils.setField(service, "sequenceService", sequence);
        ReflectionTestUtils.setField(service, "quotaAdmission", quota);
        when(quota.beginEnterprise(42L)).thenReturn(snapshot);
    }
    @Test void repeatedActiveMembershipHasZeroIncrementAndKeepsOwnerRole() {
        var row = membership("ACTIVE"); when(mapper.selectOne(any())).thenReturn(row);
        assertSame(row, service.add(2L, 42L, "MEMBER", 1L));
        assertEquals("OWNER", row.getRole());
        verify(quota, never()).checkMembers(snapshot, 1);
        verify(mapper, never()).insert(any(TenantUserMembership.class));
    }
    @Test void disabledMembershipCannotBeReactivatedByGroupAdmission() {
        var row = membership("DISABLED"); when(mapper.selectOne(any())).thenReturn(row);
        assertThrows(RuntimeException.class, () -> service.add(2L, 42L, "MEMBER", 1L));
        assertEquals("DISABLED", row.getStatus());
        verify(mapper, never()).updateById(any(TenantUserMembership.class));
        verify(mapper, never()).insert(any(TenantUserMembership.class));
    }
    @Test void fullEnterpriseRejectsNewRelationshipBeforeWriting() {
        doThrow(new ResponseStatusException(HttpStatus.CONFLICT, "tenant.member.limit.reached"))
            .when(quota).checkMembers(snapshot, 1);
        assertThrows(ResponseStatusException.class, () -> service.add(2L, 42L, "MEMBER", 1L));
        verify(mapper, never()).insert(any(TenantUserMembership.class));
    }
    private TenantUserMembership membership(String status) {
        var row = new TenantUserMembership(); row.setMembershipId(8L); row.setUserId(2L);
        row.setEnterpriseId(42L); row.setRole("OWNER"); row.setStatus(status); return row;
    }
}
