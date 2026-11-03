package com.iwhalecloud.byai.state.domain.resource.service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.resource.EnterpriseResourceSyncContext;
import com.iwhalecloud.byai.manager.domain.resource.service.*;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Runs the real tool import and metadata construction, mocking only persistence, grants and publication I/O. */
class ToolJsonSyncCreatorTest extends I18nTestSupport {
    @AfterEach void logout() { CurrentUserHolder.setLoginInfo(null); }

    @ParameterizedTest
    @CsvSource({"TOOLKIT,enterprise", "MCP,enterprise", "AGENT,enterprise"})
    void creatorFollowsSyncPayloadOnCreateAndUpdateButNotOrdinaryPageUpdates(String type, String owner) {
        LoginInfo caller = new LoginInfo(); caller.setUserId(9L); caller.setEnterpriseId(1L);
        CurrentUserHolder.setLoginInfo(caller);
        var stored = new AtomicReference<SsResource>();
        SsResourceService resources = mock(SsResourceService.class);
        when(resources.findByImportIdentity("WHALE_AGENT", type, "22")).thenAnswer(call -> stored.get());
        when(resources.createResource(any(SsResource.class))).thenAnswer(call -> {
            SsResource resource = call.getArgument(0); resource.setResourceId(100L);
            if (resource.getCreateBy() == null) resource.setCreateBy(9L);
            stored.set(resource); return resource;
        });
        when(resources.updateResourceEntity(any())).thenAnswer(call -> {
            stored.set(call.getArgument(0)); return stored.get();
        });
        AuthApplicationService auth = mock(AuthApplicationService.class);
        when(auth.hasResourceManagePermission(any())).thenReturn(true);
        ToolManService service = new ToolManService();
        ReflectionTestUtils.setField(service, "ssResourceService", resources);
        ReflectionTestUtils.setField(service, "authApplicationService", auth);
        ReflectionTestUtils.setField(service, "resourceRuntimeInfoResolver", new ResourceRuntimeInfoResolver());
        ReflectionTestUtils.setField(service, "resourceTargetJsonBuilder", new ResourceTargetJsonBuilder());
        ReflectionTestUtils.setField(service, "ssResExtToolKitService", mock(SsResExtToolKitService.class));
        ReflectionTestUtils.setField(service, "ssResExtMcpService", mock(SsResExtMcpService.class));
        ReflectionTestUtils.setField(service, "ssResExtAgentService", mock(SsResExtAgentService.class));
        ReflectionTestUtils.setField(service, "resourceArtifactStorageService", mock(ResourceArtifactStorageService.class));
        ReflectionTestUtils.setField(service, "ssResourceArtifactService", mock(SsResourceArtifactService.class));
        ReflectionTestUtils.setField(service, "resourceDiscoveryRegistrationService", mock(ResourceDiscoveryRegistrationService.class));
        JSONObject root = new JSONObject();
        root.put("systemCode", "WHALE_AGENT"); root.put("resourceBizType", type); root.put("resourceCode", "22");
        root.put("resourceName", "Creator test"); root.put("ownerType", owner);
        root.put("domainName", "test"); root.put("domainURL", "https://example.invalid");
        root.put("createBy", "1168");
        sync(service, root, type, owner);
        assertThat(stored.get().getCreateBy()).isEqualTo(1168L);
        root.put("createBy", 2268L);
        sync(service, root, type, owner);
        assertThat(stored.get().getCreateBy()).isEqualTo(2268L);
        assertThat(stored.get().getUpdateBy()).isEqualTo(9L);
        root.remove("createBy");
        sync(service, root, type, owner);
        assertThat(stored.get().getCreateBy()).isEqualTo(2268L);
        root.put("createBy", 9L);
        service.importToolJsonNewFromMultipart(file(root), 0L, owner);
        assertThat(stored.get().getCreateBy()).isEqualTo(2268L);
        when(auth.hasResourceManagePermission(any())).thenReturn(false);
        assertThatThrownBy(() -> sync(service, root, type, owner)).isInstanceOf(IllegalArgumentException.class);
        assertThat(stored.get().getCreateBy()).isEqualTo(2268L);
    }

    private void sync(ToolManService service, JSONObject root, String type, String owner) {
        EnterpriseResourceSyncContext.execute(false, "WHALE_AGENT", type, "22",
            () -> service.importToolJsonNewFromMultipart(file(root), 0L, owner));
    }

    private MockMultipartFile file(JSONObject root) {
        return new MockMultipartFile("file", "tool.json", "application/json",
            root.toJSONString().getBytes(StandardCharsets.UTF_8));
    }
}
