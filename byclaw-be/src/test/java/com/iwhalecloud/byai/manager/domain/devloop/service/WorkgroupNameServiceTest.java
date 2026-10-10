package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import java.util.Map;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class WorkgroupNameServiceTest {
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final ByaiSessionMapper sessions = mock(ByaiSessionMapper.class);
    private final WorkgroupNameService service = new WorkgroupNameService(node, sessions);
    private String originalEnvironment;

    @BeforeEach
    void setUp() {
        originalEnvironment = System.getProperty("BE_ENV");
        System.setProperty("BE_ENV", "production");
        if (TableInfoHelper.getTableInfo(ByaiSession.class) == null) {
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), ByaiSession.class);
        }
    }

    @AfterEach
    void clear() {
        TenantRequestContextHolder.clear();
        if (originalEnvironment == null) System.clearProperty("BE_ENV");
        else System.setProperty("BE_ENV", originalEnvironment);
    }

    @Test
    void readsAvailabilityFromTheTenantNodeWithoutAccessingPersonalSessions() {
        var tenant = new TenantRequestContext(88L, 10L, "OWNER");
        TenantRequestContextHolder.set(tenant);
        when(node.request(eq(tenant), eq("POST"), eq("/internal/v1/group-chats/name-check"),
            eq(Map.of("name", "Team")), any())).thenReturn(new WorkgroupNameService.NameCheck(false));

        assertThat(service.exists("Team", 88L, 10L)).isFalse();

        verifyNoInteractions(sessions);
    }

    @Test
    void propagatesNodeUnavailabilityWithoutTreatingTheNameAsFree() {
        var tenant = new TenantRequestContext(88L, 10L, "OWNER");
        TenantRequestContextHolder.set(tenant);
        when(node.request(eq(tenant), any(), any(), any(), any())).thenThrow(new IllegalStateException("offline"));

        assertThatThrownBy(() -> service.exists("Team", 88L, 10L)).hasMessage("offline");
        verifyNoInteractions(sessions);
    }

    @Test
    void refusesAMissingNameCheckResult() {
        TenantRequestContextHolder.set(new TenantRequestContext(88L, 10L, "OWNER"));
        assertThatThrownBy(() -> service.exists("Team", 88L, 10L)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void rejectsScopeMismatchBeforeQueryingEitherDatabase() {
        TenantRequestContextHolder.set(new TenantRequestContext(88L, 10L, "OWNER"));
        assertThatThrownBy(() -> service.exists("Team", 88L, 11L)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.exists("Team", 89L, 10L)).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(node, sessions);
    }

    @Test
    void legacyCheckExcludesOnlyDissolvedGroupsWithinTheTenantAndCreator() {
        when(sessions.selectCount(any())).thenReturn(1L);

        assertThat(service.exists("Team", 88L, 10L)).isTrue();

        LambdaQueryWrapper<ByaiSession> query = query();
        assertThat(query.getSqlSegment()).contains("creator_id =", "enterprise_id =", "session_type =", "state <>", "state IS NULL");
        assertThat(query.getParamNameValuePairs().values()).containsExactlyInAnyOrder(88L, "Team", "hs_as", 10L, "GROUP_DISSOLVED");
        verifyNoInteractions(node);
    }

    @Test
    void developmentUsesTheSameTenantScopeInTheLegacyDatabase() {
        TenantRequestContextHolder.set(new TenantRequestContext(88L, 10L, "OWNER"));
        System.setProperty("BE_ENV", "development");
        when(sessions.selectCount(any())).thenReturn(0L);

        assertThat(service.exists("Team", 88L, 10L)).isFalse();
        assertThat(query().getSqlSegment()).contains("enterprise_id =").doesNotContain("enterprise_id IS NULL");
        verifyNoInteractions(node);
    }

    @SuppressWarnings("unchecked")
    private LambdaQueryWrapper<ByaiSession> query() {
        ArgumentCaptor<LambdaQueryWrapper<ByaiSession>> query = ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        verify(sessions).selectCount(query.capture());
        return query.getValue();
    }
}
