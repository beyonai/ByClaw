package com.iwhalecloud.byai.state.domain.groupchat.forward;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import com.iwhalecloud.byai.manager.domain.tenant.*;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;

class ForwardTenantRoutingTest {
    @ParameterizedTest
    @ValueSource(strings = {"TRIAL", "STANDARD"})
    void createStatusAndRetryUseConfiguredMode(String mode) {
        var config = mock(TenantAdminTenantMapper.class);
        when(config.selectConfig(10L, "TENANT_MODE")).thenReturn(mode);
        var modes = new TenantModeService(config);
        var legacy = mock(LegacyGroupChatForwardStore.class);
        var tenant = mock(TenantGroupForwardService.class);
        var service = new GroupChatForwardService(legacy, tenant, null,
            mock(ForwardPlatformPolicy.class), null, null, null, null, null, modes);
        var actor = new ForwardActor(20, 10);
        var result = new ForwardOperation(40, ForwardOperationState.SUCCEEDED, List.of());
        com.iwhalecloud.byai.state.domain.groupchat.forward.port.GroupChatForwardStore owner =
            "TRIAL".equals(mode) ? legacy : tenant;
        when(owner.prepare(actor, 30, null)).thenReturn(result);
        when(owner.status(actor, 30, 40)).thenReturn(result);
        when(owner.retry(actor, 30, 40, Set.of())).thenReturn(result);
        TenantRequestContextHolder.set(new TenantRequestContext(20, 10, "MEMBER"));
        try {
            assertThat(service.create(actor, 30, null)).isSameAs(result);
            assertThat(service.status(actor, 30, 40)).isSameAs(result);
            assertThat(service.retry(actor, 30, 40, Set.of())).isSameAs(result);
            verifyNoInteractions("TRIAL".equals(mode) ? tenant : legacy);
            TenantRequestContextHolder.set(new TenantRequestContext(21, 10, "MEMBER"));
            assertThatThrownBy(() -> service.status(actor, 30, 40)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
        } finally {
            TenantRequestContextHolder.clear();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"TRIAL", "STANDARD"})
    void detailsUseSameModeAndValidateActor(String mode) {
        var config = mock(TenantAdminTenantMapper.class);
        when(config.selectConfig(10L, "TENANT_MODE")).thenReturn(mode);
        var tenant = mock(TenantGroupForwardService.class);
        var policy = mock(ForwardPlatformPolicy.class);
        var query = new GroupChatForwardQueryService(mock(JdbcTemplate.class),
            mock(org.springframework.transaction.PlatformTransactionManager.class),
            new com.fasterxml.jackson.databind.ObjectMapper(), tenant, policy, new TenantModeService(config));
        var actor = new ForwardActor(20, 10);
        TenantRequestContextHolder.set(new TenantRequestContext(20, 10, "MEMBER"));
        try {
            // 查询后端选择发生在权限检查之后，试用模式不会调用 Node。
            Boolean dedicated = org.springframework.test.util.ReflectionTestUtils.invokeMethod(query, "tenant", actor);
            assertThat(dedicated).isEqualTo("STANDARD".equals(mode));
            if ("TRIAL".equals(mode)) verify(policy).requireNewWork(actor, ForwardBackend.LEGACY);
            TenantRequestContextHolder.set(new TenantRequestContext(20, 11, "MEMBER"));
            assertThatThrownBy(() -> query.items(actor, 30, 40, 20, null)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
            verifyNoInteractions(tenant);
        } finally {
            TenantRequestContextHolder.clear();
        }
    }

    @Test
    void recoveryAdvancesPastEntireSharedPage() {
        var config = mock(TenantAdminTenantMapper.class);
        when(config.selectConfig(10L, "TENANT_MODE")).thenReturn("TRIAL");
        var db = mock(JdbcTemplate.class);
        when(db.queryForList(anyString(), eq(Long.class), eq(0L), eq(2))).thenReturn(List.of(1L, 10L));
        when(db.queryForList(anyString(), eq(Long.class), eq(10L), eq(2))).thenReturn(List.of(20L));
        var directory = new ForwardRecoveryDirectory(db, new TenantModeService(config));
        assertThat(directory.readyTenants(0, 2)).containsExactly(20L);
    }
}
