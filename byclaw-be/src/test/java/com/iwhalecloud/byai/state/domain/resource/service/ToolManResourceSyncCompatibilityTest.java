package com.iwhalecloud.byai.state.domain.resource.service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.i18n.I18nTestScope;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.resource.EnterpriseResourceSyncContext;
import com.iwhalecloud.byai.manager.application.service.resource.EnterpriseResourceSyncService;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.position.service.PositionService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.station.service.StationService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doCallRealMethod;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ToolManResourceSyncCompatibilityTest {
    private ToolManService service;
    private EnterpriseResourceSyncService sync;
    private AuthApplicationService auth;
    private SsResourceService resources;
    private SsResource resource;
    private Boolean manageDuringImport;

    @BeforeEach
    void setUp() {
        LoginInfo login = new LoginInfo();
        login.setUserId(9L);
        login.setUserCode("platform-manager");
        login.setEnterpriseId(1L);
        CurrentUserHolder.setLoginInfo(login);

        resource = new SsResource();
        resource.setResourceId(10L);
        resource.setCreateBy(8L);
        resource.setComAcctId(1L);
        resource.setOwnerType("enterprise");
        resource.setResourceStatus(2);
        resource.setSystemCode("BYAI");
        resource.setResourceCode("sync-test");
        resource.setUseAuthControlled(true);

        // Keep the real per-resource permission decision; only the global role lookup and import I/O are stubbed.
        auth = spy(new AuthApplicationService());
        doReturn(true).when(auth).isCurrentUserGlobalResourceManager();
        ReflectionTestUtils.setField(auth, "privilegeGrantService", mock(PrivilegeGrantService.class));
        ReflectionTestUtils.setField(auth, "organizationService", mock(OrganizationService.class));
        ReflectionTestUtils.setField(auth, "positionService", mock(PositionService.class));
        ReflectionTestUtils.setField(auth, "stationService", mock(StationService.class));

        sync = spy(new EnterpriseResourceSyncService());
        ReflectionTestUtils.setField(sync, "auth", auth);
        doNothing().when(sync).completeImport(anyLong(), any(), anyBoolean(), anyMap());
        resources = mock(SsResourceService.class);
        when(resources.findByImportIdentity(any(), any(), any())).thenReturn(resource);
        service = spy(new ToolManService());
        ReflectionTestUtils.setField(service, "enterpriseResourceSyncService", sync);
        ReflectionTestUtils.setField(service, "ssResourceService", resources);
        ReflectionTestUtils.setField(service, "authApplicationService", auth);
        doAnswer(invocation -> importResult()).when(service).importToolJsonNewFromMultipart(any(), any(), any());

        DatasetApplicationService datasets = mock(DatasetApplicationService.class);
        ReflectionTestUtils.setField(service, "datasetApplicationService", datasets);
        when(datasets.importDatasetJson(any(), any(), any())).thenAnswer(invocation -> {
            importResult();
            return resource.getResourceId();
        });
        ByClawSkillResourceApplicationService skills = mock(ByClawSkillResourceApplicationService.class);
        ReflectionTestUtils.setField(service, "byClawSkillResourceApplicationService", skills);
        when(skills.syncEnterpriseSkill(any(), any())).thenAnswer(invocation -> importResult());
    }

    @AfterEach
    void tearDown() {
        try {
            assertThat(EnterpriseResourceSyncContext.canUpdate(resource)).isFalse();
        } finally {
            CurrentUserHolder.setLoginInfo(null);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"TOOLKIT", "MCP", "AGENT", "KG_DOC", "KG_DB", "KG_QA", "KG_TERM"})
    void legacyCallsDoNotGiveGlobalManagersAnImplicitResourceManagePermission(String type) {
        resource.setResourceBizType(type);
        assertThat(auth.hasResourceManagePermission(resource)).isFalse();

        service.addToolFromThird(request(type, "{}"));

        assertThat(manageDuringImport).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"TOOLKIT", "MCP", "AGENT"})
    void realLegacyToolImportRejectsUpdatesWithoutResourceManagementPermission(String type) {
        resource.setResourceBizType(type);
        doCallRealMethod().when(service).importToolJsonNewFromMultipart(any(), any(), any());
        JSONObject json = JSONObject.parseObject(request(type, "{}"));
        json.put("resourceName", "Legacy tool");
        json.put("domainName", "Test domain");
        json.put("domainURL", "https://example.invalid");

        try (var messages = new I18nTestScope(Locale.US)) {
            assertThatThrownBy(() -> service.addToolFromThird(json.toJSONString()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("You do not have permission");
        }

        verify(auth).hasResourceManagePermission(resource);
        verify(sync, never()).completeImport(anyLong(), any(), anyBoolean(), anyMap());
    }

    @ParameterizedTest
    @ValueSource(strings = {"TOOLKIT", "KG_DOC"})
    void legacyCallsKeepCreatorManagementPermission(String type) {
        resource.setResourceBizType(type);
        resource.setCreateBy(9L);

        service.addToolFromThird(request(type, "{}"));

        assertThat(manageDuringImport).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"viewAuth\":false}", "{\"autoAuthorize\":false}",
        "{\"viewAuth\":true,\"authScope\":{}}", "{\"autoAuthorize\":true,\"authScope\":{}}"})
    void explicitAuthorizationFlagsKeepTrustedSynchronizationEvenWhenFalse(String fields) {
        resource.setResourceBizType("TOOLKIT");
        resource.setComAcctId(2L);
        assertThat(auth.hasResourceManagePermission(resource)).isFalse();

        service.addToolFromThird(request("TOOLKIT", fields));

        assertThat(manageDuringImport).isTrue();
        assertThat(auth.hasResourceManagePermission(resource)).isFalse();
    }

    @Test
    void skillSynchronizationRemainsTrustedWithoutAuthorizationFlags() {
        resource.setResourceBizType("SKILL");
        resource.setComAcctId(2L);

        service.addToolFromThird(request("SKILL", "{}"));

        assertThat(manageDuringImport).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"viewAuth\":false}", "{\"autoAuthorize\":false}"})
    void explicitFalseFlagsStillRequireAResourceAdministrator(String fields) {
        doReturn(false).when(auth).isCurrentUserGlobalResourceManager();

        assertThatThrownBy(() -> service.addToolFromThird(request("TOOLKIT", fields)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("资源管理员");

        verify(resources, never()).lockSkillImport(any());
        verify(sync, never()).completeImport(anyLong(), any(), anyBoolean(), anyMap());
    }

    @Test
    void skillSynchronizationStillRequiresAResourceAdministrator() {
        doReturn(false).when(auth).isCurrentUserGlobalResourceManager();

        assertThatThrownBy(() -> service.addToolFromThird(request("SKILL", "{}")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("资源管理员");

        verify(resources, never()).lockSkillImport(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"TOOLKIT", "MCP", "AGENT", "KG_DOC", "KG_DB", "KG_QA", "KG_TERM"})
    void contentOnlyImportsRequestRuntimeRefreshWithoutChangingAuthorization(String type) {
        resource.setResourceBizType(type);
        resource.setCreateBy(9L);
        for (String fields : java.util.List.of("{}", "{\"autoAuthorize\":false}")) {
            Map<String, Object> result = service.addToolFromThird(request(type, fields));
            verify(sync).completeImport(eq(10L), any(), eq(true), same(result));
        }
    }

    private String request(String type, String fields) {
        JSONObject json = JSONObject.parseObject(fields);
        json.put("resourceBizType", type);
        json.put("systemCode", "BYAI");
        json.put("resourceCode", "sync-test");
        return json.toJSONString();
    }

    private Map<String, Object> importResult() {
        manageDuringImport = auth.hasResourceManagePermission(resource);
        return new HashMap<>(Map.of("resourceId", "10"));
    }
}
