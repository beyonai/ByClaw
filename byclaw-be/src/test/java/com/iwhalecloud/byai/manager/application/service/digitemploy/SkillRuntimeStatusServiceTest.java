package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson2.JSON;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.HashOperations;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class SkillRuntimeStatusServiceTest {
    private SsResourceService resources;
    private SsResExtSkillService extensions;
    private AuthApplicationService auth;
    private StringRedisTemplate redis;
    private ValueOperations<String, String> values;
    private HashOperations<String, Object, Object> hashes;
    private SkillRuntimeStatusService service;
    private SsResource employee;
    private SsResourceDTO skill;
    private SsResExtSkill extension;
    private static final String KEY = "byai:skill_runtime:1125:20";
    private static final String SNAPSHOT = "{\"resourceId\":\"20\"}";

    @BeforeEach @SuppressWarnings("unchecked") void setup() {
        resources = mock(SsResourceService.class); extensions = mock(SsResExtSkillService.class);
        auth = mock(AuthApplicationService.class); redis = mock(StringRedisTemplate.class);
        values = mock(ValueOperations.class); hashes = mock(HashOperations.class);
        when(redis.opsForValue()).thenReturn(values); when(redis.opsForHash()).thenReturn(hashes);
        LoginInfo login = new LoginInfo(); login.setUserId(1125L); login.setEnterpriseId(1L);
        CurrentUserHolder.setLoginInfo(login);
        employee = new SsResource(); employee.setResourceId(20L); employee.setResourceBizType("DIG_EMPLOYEE");
        skill = new SsResourceDTO(); skill.setResourceId(77L); skill.setResourceCode("8640");
        skill.setResourceName("westock-data"); skill.setResourceBizType("SKILL");
        extension = new SsResExtSkill(); extension.setSkillType("hub"); extension.setVersion("v1");
        when(resources.findById(20L)).thenReturn(employee); when(resources.findRelResource(20L)).thenReturn(List.of(skill));
        when(extensions.findById(77L)).thenReturn(extension);
        when(auth.hasResourceUsePermission(any(SsResource.class))).thenReturn(true);
        when(values.get("DIG_EMPLOYEE_20")).thenReturn(SNAPSHOT);
        when(hashes.entries(KEY)).thenReturn(Map.of());
        service = new SkillRuntimeStatusService(resources, extensions, auth, redis);
    }
    @AfterEach void cleanup() { CurrentUserHolder.setLoginInfo(null); }

    private String receipt(String instance, String state, String hash, long time) {
        return JSON.toJSONString(Map.of("schemaVersion", 1, "employeeId", "20", "runtimeId", instance,
            "snapshotHash", hash, "observedAt", time, "expiresAt", time + 60000,
            "skills", List.of(Map.of("skillCode", "8640", "state", state, "version", "v1", "errorCode", "DOWNLOAD_FAILED"))));
    }
    private String current(String instance, String state) {
        return receipt(instance, state, SkillRuntimeStatusService.digest(SNAPSHOT), System.currentTimeMillis());
    }

    @Test void associationWithoutReceiptWaitsForRuntime() {
        assertThat(service.query(20L).skills().get(0).state()).isEqualTo("WAITING_RUNTIME");
    }
    @Test void reportsReadyOnlyFromCurrentLiveInstanceAndMatchingPackageVersion() {
        when(hashes.entries(KEY)).thenReturn(Map.of("one", current("one", "READY")));
        assertThat(service.query(20L).skills().get(0).state()).isEqualTo("READY");
        extension.setVersion("v2");
        assertThat(service.query(20L).skills().get(0).state()).isEqualTo("PREPARING");
    }
    @Test void staleRevisionAndAnotherPendingInstanceCannotBeReportedReady() {
        when(hashes.entries(KEY)).thenReturn(Map.of("one", current("one", "READY"),
            "two", receipt("two", "READY", "old-hash", System.currentTimeMillis())));
        assertThat(service.query(20L).skills().get(0).state()).isEqualTo("PREPARING");
        when(hashes.entries(KEY)).thenReturn(Map.of("one", current("one", "READY"), "two", current("two", "FAILED")));
        assertThat(service.query(20L).skills().get(0).state()).isEqualTo("FAILED");
    }
    @Test void expiresOldReceiptsAndIgnoresMalformedOrMismatchedInstances() {
        when(hashes.entries(KEY)).thenReturn(Map.of("old", receipt("old", "READY", "hash", System.currentTimeMillis() - 61000),
            "broken", "not-json", "wrong", current("someone-else", "READY")));
        assertThat(service.query(20L).liveInstances()).isZero();
    }
    @Test void hidesRevokedAndRemovedResourcesDespiteOldReadyReceipt() {
        when(hashes.entries(KEY)).thenReturn(Map.of("one", current("one", "READY")));
        when(auth.hasResourceUsePermission(skill)).thenReturn(false);
        assertThat(service.query(20L).skills()).isEmpty();
        when(resources.findRelResource(20L)).thenReturn(List.of());
        assertThat(service.query(20L).skills()).isEmpty();
    }
    @Test void rejectsUnauthorizedEmployeeBeforeReadingOrRequestingRuntime() {
        when(auth.hasResourceUsePermission(employee)).thenReturn(false);
        assertThatThrownBy(() -> service.prepare(20L)).isInstanceOf(RuntimeException.class);
        verifyNoInteractions(values, hashes);
    }
    @Test void retryIsCurrentUserScopedAndDoesNotCreateAssociationsOrGrantPermissions() {
        service.prepare(20L);
        verify(values).setIfAbsent(eq("byai:skill_runtime:request:1125:20"), anyString(), eq(java.time.Duration.ofSeconds(30)));
        verify(resources, never()).save(any());
        verify(hashes).entries(KEY);
    }
}
