package com.iwhalecloud.byai.manager.interfaces.controller.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantCredentialCrypto;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

class TenantNodeInternalControllerTest {

    private final TenantAdminTenantMapper tenantMapper = mock(TenantAdminTenantMapper.class);
    private final TenantCredentialCrypto crypto = mock(TenantCredentialCrypto.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final TenantNodeInternalController controller = new TenantNodeInternalController(
        tenantMapper, crypto, jdbc, new ObjectMapper(), "test-internal-token");

    @Test
    void rejectsUnauthenticatedSchemaCallbackBeforeDatabaseAccess() {
        assertThatThrownBy(() -> controller.report(null, Map.of()))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
        verifyNoInteractions(jdbc, tenantMapper, crypto);
    }

    @Test
    void rejectsReportThatDoesNotMatchTheExistingAuditAttempt() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq("audit-1"), eq(123L), eq(1L), eq(1)))
            .thenReturn(0);

        assertThatThrownBy(() -> controller.report("Bearer test-internal-token", verifiedReport()))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
        verify(jdbc).queryForObject(anyString(), eq(Integer.class), eq("audit-1"), eq(123L), eq(1L), eq(1));
    }

    @Test
    void marksMatchingVerifiedAttemptCurrent() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq("audit-1"), eq(123L), eq(1L), eq(1)))
            .thenReturn(1);

        controller.report("Bearer test-internal-token", verifiedReport());

        verify(jdbc).update(startsWith("UPDATE byai.tenant_schema_audit SET is_current=FALSE"), eq(123L));
        verify(jdbc).update(startsWith("UPDATE byai.tenant_schema_audit SET status=?"),
            eq("VERIFIED"), eq("V0.5.0"), eq(true), eq("[]"),
            eq(null), eq(null), eq(null), eq(null), eq(null),
            eq("audit-1"), eq(123L), eq(1L), eq(1));
    }

    private Map<String, Object> verifiedReport() {
        return Map.of("enterpriseId", "123", "generation", "1", "auditId", "audit-1",
            "attemptNo", 1, "status", "VERIFIED", "observedVersion", "V0.5.0", "steps", List.of());
    }
}
