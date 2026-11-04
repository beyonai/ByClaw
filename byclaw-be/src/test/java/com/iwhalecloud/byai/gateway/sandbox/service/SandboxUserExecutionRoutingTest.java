package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SharedDshHostContexts;
import com.iwhalecloud.byai.gateway.sandbox.shared.SharedSandboxGateway;
import com.iwhalecloud.byai.gateway.sandbox.shared.SharedSandboxPolicy;
import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamCacheReader;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.state.domain.chat.service.SystemParamTargetAgentResolver;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

class SandboxUserExecutionRoutingTest {

    private static final String USER = "user-a";
    private final SandboxService service = new SandboxService();
    private final ByaiSystemConfigService config = mock(ByaiSystemConfigService.class);
    private final UserPrivateParamCacheReader privateParameters = mock(UserPrivateParamCacheReader.class);
    private final SandboxLaunchContextFactory factory = mock(SandboxLaunchContextFactory.class);
    private final PlatformRemoteGateway gateway = mock(PlatformRemoteGateway.class);
    private final SandboxProperties properties = new SandboxProperties();
    private final SandboxLaunchData launched = new SandboxLaunchData();

    @BeforeEach
    void setUp() {
        launched.setSandboxId("execution-sandbox");
        properties.getSharedDshHost().setToolServiceKey("configured-tools");
        ReflectionTestUtils.setField(service, "byaiSystemConfigService", config);
        ReflectionTestUtils.setField(service, "sandboxLaunchContextFactory", factory);
        ReflectionTestUtils.setField(service, "systemParamTargetAgentResolver",
            new SystemParamTargetAgentResolver(config, privateParameters, null));
        ReflectionTestUtils.setField(service, "sandboxProperties", properties);
        ReflectionTestUtils.setField(service, "sharedSandboxPolicy", new SharedSandboxPolicy(config));
        @SuppressWarnings("unchecked")
        ObjectProvider<PlatformRemoteGateway> provider = mock(ObjectProvider.class);
        when(provider.getObject()).thenReturn(gateway);
        ReflectionTestUtils.setField(service, "platformGatewayProvider", provider);
        when(gateway.isRemote()).thenReturn(true);
        when(gateway.params(any(Object[].class))).thenCallRealMethod();
        when(gateway.route(any())).thenCallRealMethod();
        when(gateway.service(eq("launch"), anyMap())).thenReturn(launched);
        when(gateway.convert(any(), eq(SandboxLaunchData.class))).thenAnswer(call -> call.getArgument(0));
        when(factory.resolveRouting(null, USER)).thenReturn(new SandboxLaunchRouting("openclaw-fast", -1L));
    }

    @Test
    void globalDshSelectionUsesTheSameTargetRoutingAsChat() {
        when(config.getDcSystemConfigValueByCode("ENABLE_DSH")).thenReturn("1");

        assertThat(service.launchUserExecutionSandbox(USER)).isSameAs(launched);

        assertThat(sentRouting()).containsEntry("sandboxType", "byclaw-dsh")
            .containsEntry("effectiveResourceId", -1L).containsEntry("profileKey", null);
        verify(factory, never()).resolveRouting(null, USER);
    }

    @Test
    void personalDisablePreservesTheUsersSelectedProfile() {
        when(config.getDcSystemConfigValueByCode("ENABLE_DSH")).thenReturn("1");
        when(privateParameters.getValue(USER, "ENABLE_DSH")).thenReturn("0");

        service.launchUserExecutionSandbox(USER);

        assertThat(sentRouting()).containsEntry("sandboxType", "openclaw").containsEntry("profileKey", "fast");
    }

    @Test
    void ordinaryUserKeepsAnExistingCustomExecutionSelection() {
        when(factory.resolveRouting(null, USER)).thenReturn(new SandboxLaunchRouting("selected-runtime", -1L));

        service.launchUserExecutionSandbox(USER);

        assertThat(sentRouting()).containsEntry("sandboxType", "selected-runtime");
    }

    @Test
    void residentHostExecutesInItsConfiguredDefaultToolSandbox() {
        SharedDshHostContexts host = residentHost();

        service.launchUserExecutionSandbox(USER);

        assertThat(sentRouting()).containsEntry("sandboxType", "configured-tools");
        verify(host, never()).ensure(any());
    }

    @Test
    void residentHostUsesTheSamePerUserToolMappingAsTheHostEnvironment() {
        SharedDshHostContexts host = residentHost();
        when(config.getDcSystemConfigValueByCode(SharedDshHostContexts.TOOL_SANDBOX_PARAM))
            .thenReturn("someone-else=other-tools;user-a=user-tools");

        service.launchUserExecutionSandbox(USER);

        assertThat(sentRouting()).containsEntry("sandboxType", "user-tools");
        verify(host, never()).ensure(any());
    }

    @Test
    void managedSharedUsersSelectToolsBeforeAllocatingAnyHostContext() {
        SharedSandboxGateway shared = managedShared();
        when(config.getDcSystemConfigValueByCode(SharedDshHostContexts.TOOL_SANDBOX_PARAM))
            .thenReturn("user-a=managed-user-tools");

        service.launchUserExecutionSandbox(USER);

        assertThat(sentRouting()).containsEntry("sandboxType", "managed-user-tools");
        verify(shared, never()).tryAcquire(USER, "byclaw-dsh");
    }

    @Test
    void rejectsAToolMappingBackToTheResidentHost() {
        SharedDshHostContexts host = residentHost();
        when(config.getDcSystemConfigValueByCode(SharedDshHostContexts.TOOL_SANDBOX_PARAM))
            .thenReturn("user-a=byclaw-dsh");

        assertThatThrownBy(() -> service.launchUserExecutionSandbox(USER)).isInstanceOf(IllegalStateException.class);

        verify(host, never()).ensure(any());
        verify(gateway, never()).service(eq("launch"), anyMap());
    }

    @Test
    void rejectsAToolMappingBackToAManagedSharedHost() {
        SharedSandboxGateway shared = managedShared();
        when(config.getDcSystemConfigValueByCode(SharedDshHostContexts.TOOL_SANDBOX_PARAM))
            .thenReturn("user-a=byclaw-dsh");

        assertThatThrownBy(() -> service.launchUserExecutionSandbox(USER)).isInstanceOf(IllegalStateException.class);

        verify(shared, never()).tryAcquire(any(), any());
        verify(gateway, never()).service(eq("launch"), anyMap());
    }

    @Test
    void refusesSharedResultsEvenIfTheSelectedToolSpecIsAlsoMappedToSharedInfrastructure() {
        SharedSandboxGateway shared = managedShared();
        SandboxLaunchData sharedContext = new SandboxLaunchData();
        sharedContext.setSandboxId("shared-context");
        sharedContext.setIsShared(true);
        when(shared.tryAcquire(USER, "configured-tools")).thenReturn(sharedContext);

        assertThatThrownBy(() -> service.launchUserExecutionSandbox(USER)).isInstanceOf(IllegalStateException.class);

        verify(gateway, never()).service(eq("launch"), anyMap());
    }

    @Test
    void legacyRedisHostMarkerRoutesExecutionToTheUsersToolSandbox() {
        SsSandboxRecordMapper records = localRecordReuse();
        when(config.getDcSystemConfigValueByCode(SharedDshHostContexts.TOOL_SANDBOX_PARAM))
            .thenReturn("user-a=legacy-user-tools");
        try (var redis = mockStatic(RedisUtil.class)) {
            redis.when(() -> RedisUtil.getString(SandboxService.SHARED_DSH_HOST_KEY_PREFIX + USER))
                .thenReturn("resident-host");
            redis.when(() -> RedisUtil.lock(anyString(), anyString(), anyLong())).thenReturn(true);

            assertThat(service.launchUserExecutionSandbox(USER).getSandboxId()).isEqualTo("existing-legacy-user-tools");

            verify(records).selectActiveByUserAndResource(USER, "legacy-user-tools", -1L);
        }
    }

    @Test
    void platformExecutionDoesNotReadAnUnrelatedLegacyRedisHostMarker() {
        when(config.getDcSystemConfigValueByCode("ENABLE_DSH")).thenReturn("1");
        try (var redis = mockStatic(RedisUtil.class)) {
            redis.when(() -> RedisUtil.getString(SandboxService.SHARED_DSH_HOST_KEY_PREFIX + USER))
                .thenReturn("old-resident-host");

            service.launchUserExecutionSandbox(USER);

            assertThat(sentRouting()).containsEntry("sandboxType", "byclaw-dsh");
            redis.verify(() -> RedisUtil.getString(SandboxService.SHARED_DSH_HOST_KEY_PREFIX + USER), never());
        }
    }

    @Test
    void unavailableLegacyRedisMarkerRetainsExistingIndependentSandboxBehavior() {
        localRecordReuse();
        try (var redis = mockStatic(RedisUtil.class)) {
            redis.when(() -> RedisUtil.getString(SandboxService.SHARED_DSH_HOST_KEY_PREFIX + USER))
                .thenThrow(new IllegalStateException("marker unavailable"));
            redis.when(() -> RedisUtil.lock(anyString(), anyString(), anyLong())).thenReturn(true);

            assertThat(service.launchUserExecutionSandbox(USER).getSandboxId()).isEqualTo("existing-byclaw-dsh");
        }
    }

    @Test
    void legacyRedisHostMarkerAlsoRejectsAToolMappingBackToTheHost() {
        SsSandboxRecordMapper records = localRecordReuse();
        when(config.getDcSystemConfigValueByCode(SharedDshHostContexts.TOOL_SANDBOX_PARAM))
            .thenReturn("user-a=byclaw-dsh");
        try (var redis = mockStatic(RedisUtil.class)) {
            redis.when(() -> RedisUtil.getString(SandboxService.SHARED_DSH_HOST_KEY_PREFIX + USER))
                .thenReturn("resident-host");
            redis.when(() -> RedisUtil.lock(anyString(), anyString(), anyLong())).thenReturn(true);

            assertThatThrownBy(() -> service.launchUserExecutionSandbox(USER)).isInstanceOf(IllegalStateException.class);

            verify(records, never()).selectActiveByUserAndResource(any(), any(), any());
        }
    }

    private SsSandboxRecordMapper localRecordReuse() {
        when(gateway.isRemote()).thenReturn(false);
        when(config.getDcSystemConfigValueByCode("ENABLE_DSH")).thenReturn("1");
        SsSandboxRecordMapper records = mock(SsSandboxRecordMapper.class);
        ReflectionTestUtils.setField(service, "sandboxRecordMapper", records);
        ReflectionTestUtils.setField(service, "sandboxMetadataCache", mock(SandboxMetadataCache.class));
        when(records.selectActiveByUserAndResource(eq(USER), anyString(), eq(-1L))).thenAnswer(call -> {
            String type = call.getArgument(1);
            SsSandboxRecord record = new SsSandboxRecord();
            record.setId(1L);
            record.setUserCode(USER);
            record.setSandboxType(type);
            record.setResourceId(-1L);
            record.setSandboxId("existing-" + type);
            record.setStatus("RUNNING");
            record.setEndpoint("http://sandbox.example.test/chat");
            return record;
        });
        return records;
    }

    private SharedDshHostContexts residentHost() {
        when(config.getDcSystemConfigValueByCode("ENABLE_DSH")).thenReturn("1");
        SharedDshHostContexts host = mock(SharedDshHostContexts.class);
        when(host.routes(USER, "byclaw-dsh")).thenReturn(true);
        ReflectionTestUtils.setField(service, "sharedDshHostContexts", host);
        return host;
    }

    private SharedSandboxGateway managedShared() {
        when(config.getDcSystemConfigValueByCode("ENABLE_DSH")).thenReturn("1");
        when(config.getDcSystemConfigValueByCode(SharedSandboxPolicy.USERS)).thenReturn(USER);
        SharedSandboxGateway shared = mock(SharedSandboxGateway.class);
        when(shared.enabled()).thenReturn(true);
        ReflectionTestUtils.setField(service, "sharedSandboxGateway", shared);
        return shared;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> sentRouting() {
        ArgumentCaptor<Map<String, Object>> request = ArgumentCaptor.forClass(Map.class);
        verify(gateway).service(eq("launch"), request.capture());
        return (Map<String, Object>) request.getValue().get("routing");
    }
}
