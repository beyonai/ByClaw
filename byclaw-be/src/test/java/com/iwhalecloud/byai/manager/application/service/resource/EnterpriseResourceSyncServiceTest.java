package com.iwhalecloud.byai.manager.application.service.resource;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.resource.EnterpriseResourceSyncRequest;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncJobMapper;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncScopeMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class EnterpriseResourceSyncServiceTest extends I18nTestSupport {
    private EnterpriseResourceSyncService service;
    private PrivilegeGrantMapper grants;
    private PrivilegeGrantService writes;
    private SsResource resource;
    private ResourceSyncScopeMapper subjects;

    @BeforeEach void setup() {
        service = new EnterpriseResourceSyncService();
        grants = mock(PrivilegeGrantMapper.class); writes = mock(PrivilegeGrantService.class);
        subjects = mock(ResourceSyncScopeMapper.class);
        var resources = mock(SsResourceService.class);
        resource = new SsResource(); resource.setResourceId(10L); resource.setResourceBizType("SKILL");
        resource.setOwnerType("enterprise"); resource.setComAcctId(1L); resource.setCreateBy(9L);
        resource.setThirdSyncRevision(2L);
        when(resources.findByIdForUpdate(10L)).thenReturn(resource);
        var auth = mock(AuthApplicationService.class); when(auth.isCurrentUserGlobalResourceManager()).thenReturn(true);
        ReflectionTestUtils.setField(service, "resources", resources);
        ReflectionTestUtils.setField(service, "grants", grants);
        ReflectionTestUtils.setField(service, "grantService", writes);
        ReflectionTestUtils.setField(service, "scopeMapper", subjects);
        ReflectionTestUtils.setField(service, "users", mock(UsersMapper.class));
        ReflectionTestUtils.setField(service, "jobs", mock(ResourceSyncJobMapper.class));
        ReflectionTestUtils.setField(service, "auth", auth);
        var sequence = mock(SequenceService.class); when(sequence.nextVal()).thenReturn(100L);
        ReflectionTestUtils.setField(service, "sequence", sequence);
        LoginInfo login = new LoginInfo(); login.setUserId(9L); login.setEnterpriseId(1L);
        CurrentUserHolder.setLoginInfo(login);
        TransactionSynchronizationManager.initSynchronization();
    }
    @AfterEach void cleanup() {
        TransactionSynchronizationManager.clearSynchronization(); CurrentUserHolder.setLoginInfo(null);
    }

    @Test void explicitFalsePreservesAllUseGrantsAndQueuesCleanupOnly() {
        var request = new EnterpriseResourceSyncRequest(null, false,
            new EnterpriseResourceSyncRequest.Scope(List.of(), List.of(), List.of()));
        var response = new HashMap<String, Object>();
        service.completeImport(10L, request, false, response);
        verifyNoInteractions(grants, writes);
        assertThat(resource.getThirdSyncRevision()).isEqualTo(3L);
        assertThat(response.get("association")).isEqualTo(java.util.Map.of("status", "PENDING", "jobId", "100"));
        assertThat(resource.getUseAuthControlled()).isNull();
    }

    @Test void replacementRevokesEveryOldFormalGrantIncludingDuplicatesFutureAndExpiredRows() {
        PrivilegeGrant future = grant(1L); future.setEffDate(new Date(Long.MAX_VALUE));
        PrivilegeGrant expired = grant(2L); expired.setExpDate(new Date(1));
        when(grants.selectList(any())).thenReturn(List.of(future, expired));
        var response = new HashMap<String, Object>();
        service.completeImport(10L, new EnterpriseResourceSyncRequest(null, true,
            new EnterpriseResourceSyncRequest.Scope(List.of(), List.of(), List.of())), false, response);
        verify(writes).remove(future); verify(writes).remove(expired);
        verify(writes, never()).save(any());
        assertThat(resource.getUseAuthControlled()).isTrue();
    }

    @Test void explicitEmptyViewScopeStaysControlledAndNeverBecomesPublic() {
        service.completeImport(10L, new EnterpriseResourceSyncRequest(false, null, null), false, new HashMap<>());
        assertThat(resource.getViewAuthControlled()).isTrue();
        verify(writes, never()).save(any());
    }

    @Test void crossTenantResourcesAndDigitalPostsFailBeforeClearingAnything() {
        resource.setComAcctId(2L);
        assertThatThrownBy(() -> service.validateExisting(resource)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.validate(new EnterpriseResourceSyncRequest(true, null,
            new EnterpriseResourceSyncRequest.Scope(List.of(), List.of(), List.of(8L)))))
            .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(grants, writes);
    }

    @Test void explicitFalseCarriesPendingRefreshesWithoutInheritingAutomaticAdditions() {
        var jobs = mock(ResourceSyncJobMapper.class);
        ReflectionTestUtils.setField(service, "jobs", jobs);
        var previous = new com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob();
        previous.setStatus("RUNNING"); previous.setAssociationMode("RECONCILE");
        previous.setAuthScope("{\"userIds\":[\"7\"],\"orgIds\":[],\"postIds\":[]}");
        previous.setAuthRefreshUserIds("[7]");
        previous.setResultSummary("{\"pendingEmployeeIds\":[\"20\"]}");
        when(jobs.selectList(any())).thenReturn(List.of(previous));
        service.completeImport(10L, new EnterpriseResourceSyncRequest(null, false, null), false, new HashMap<>());
        var saved = org.mockito.ArgumentCaptor.forClass(com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob.class);
        verify(jobs).insert(saved.capture());
        assertThat(saved.getValue().getAssociationMode()).isEqualTo("NONE");
        assertThat(saved.getValue().getAuthScope()).isNull();
        assertThat(saved.getValue().getResultSummary()).contains("20");
        assertThat(saved.getValue().getAuthRefreshUserIds()).contains("7");
        verifyNoInteractions(grants, writes);
    }

    private PrivilegeGrant grant(Long id) {
        PrivilegeGrant grant = new PrivilegeGrant(); grant.setPrivilegeGrantId(id);
        grant.setGrantObjId(10L); grant.setGrantObjType("SKILL"); grant.setGrantType("FORCE_USE");
        grant.setGrantToObjType("USER"); grant.setGrantToObjId(9L); grant.setStatusCd("A");
        return grant;
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource(value = {
        "zh-CN|授权组织不存在: 8|授权岗位不存在或属于数字岗位: 9",
        "en-US|Authorized organization does not exist: 8|Authorized position does not exist or is a digital position: 9"
    }, delimiter = '|')
    void invalidSubjectsAreLocalizedBeforeAuthorizationChanges(String language, String organization, String post) {
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.forLanguageTag(language));
        assertThatThrownBy(() -> service.validate(new EnterpriseResourceSyncRequest(true, null,
            new EnterpriseResourceSyncRequest.Scope(List.of(), List.of(8L), List.of()))))
            .isInstanceOf(IllegalArgumentException.class).hasMessage(organization);
        assertThatThrownBy(() -> service.validate(new EnterpriseResourceSyncRequest(true, null,
            new EnterpriseResourceSyncRequest.Scope(List.of(), List.of(), List.of(9L)))))
            .isInstanceOf(IllegalArgumentException.class).hasMessage(post);
        verifyNoInteractions(grants, writes);
    }

    @Test
    void subjectIdsRemainExactWithoutLocaleNumberFormatting() {
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.US);
        long id = 9007199254740993L;
        assertThatThrownBy(() -> service.validate(new EnterpriseResourceSyncRequest(true, null,
            new EnterpriseResourceSyncRequest.Scope(List.of(), List.of(id), List.of()))))
            .hasMessage("Authorized organization does not exist: 9007199254740993");
        assertThatThrownBy(() -> service.validate(new EnterpriseResourceSyncRequest(true, null,
            new EnterpriseResourceSyncRequest.Scope(List.of(), List.of(), List.of(id)))))
            .hasMessage("Authorized position does not exist or is a digital position: 9007199254740993");
        verifyNoInteractions(grants, writes);
    }

}
