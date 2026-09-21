package com.iwhalecloud.byai.state.domain.resource.service;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeRuntimeRefreshService;
import com.iwhalecloud.byai.manager.domain.resource.service.*;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.MockedStatic;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** 验证真实服务入口的状态转换、权限拒绝和运行产物处理，不执行外部存储操作。 */
class ResourceLifecycleTest {
    private final ToolManService service = new ToolManService();
    private final SsResourceService resources = mock(SsResourceService.class);
    private final AuthApplicationService auth = mock(AuthApplicationService.class);
    private final ResourceArtifactStorageService artifacts = mock(ResourceArtifactStorageService.class);
    private final ResourceDiscoveryRegistrationService discovery = mock(ResourceDiscoveryRegistrationService.class);
    private final SsResExtToolKitService toolkits = mock(SsResExtToolKitService.class);
    private final DatasetApplicationService datasets = mock(DatasetApplicationService.class);
    private final SsResourceRelDetailService relations = mock(SsResourceRelDetailService.class);
    private final DigitalEmployeeRuntimeRefreshService refresh = mock(DigitalEmployeeRuntimeRefreshService.class);
    private final SsResource resource = new SsResource();
    private final ResourceOperationPermissionsVo permissions = new ResourceOperationPermissionsVo();
    private MockedStatic<I18nUtil> messages;
    private MockedStatic<RedisUtil> redis;

    @BeforeEach
    void setUp() {
        messages = mockStatic(I18nUtil.class);
        messages.when(() -> I18nUtil.get(anyString())).thenAnswer(invocation -> invocation.getArgument(0));
        redis = mockStatic(RedisUtil.class);
        ReflectionTestUtils.setField(service, "ssResourceService", resources);
        ReflectionTestUtils.setField(service, "authApplicationService", auth);
        ReflectionTestUtils.setField(service, "resourceArtifactStorageService", artifacts);
        ReflectionTestUtils.setField(service, "resourceDiscoveryRegistrationService", discovery);
        ReflectionTestUtils.setField(service, "datasetApplicationService", datasets);
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", relations);
        ReflectionTestUtils.setField(service, "digitalEmployeeRuntimeRefreshService", refresh);
        ReflectionTestUtils.setField(service, "ssResExtSkillService", mock(SsResExtSkillService.class));
        ReflectionTestUtils.setField(service, "ssResExtToolKitService", toolkits);
        ReflectionTestUtils.setField(service, "ssResourceArtifactService", mock(SsResourceArtifactService.class));
        ReflectionTestUtils.setField(service, "ssResExtDocService", mock(SsResExtDocService.class));
        ReflectionTestUtils.setField(service, "ssResExtAgentService", mock(SsResExtAgentService.class));
        ReflectionTestUtils.setField(service, "ssResExtMcpService", mock(SsResExtMcpService.class));
        ReflectionTestUtils.setField(service, "byClawSkillResourceApplicationService", mock(ByClawSkillResourceApplicationService.class));
        ReflectionTestUtils.setField(service, "datasetSystem", "");
        resource.setResourceId(10L);
        resource.setResourceBizType("TOOLKIT");
        resource.setResourceCode("tool-10");
        resource.setOwnerType("enterprise");
        resource.setResourceStatus(2);
        when(resources.findById(10L)).thenReturn(resource);
        when(resources.findByIdForUpdate(10L)).thenReturn(resource);
        when(auth.hasResourceManagePermission(resource)).thenReturn(true);
        permissions.setCanOnShelf(true);
        permissions.setCanOffShelf(true);
        permissions.setCanDelete(true);
        when(auth.queryResourceOperationPermissions(10L)).thenReturn(permissions);
        when(relations.list(any())).thenReturn(List.of());
    }

    @AfterEach
    void tearDown() {
        redis.close();
        messages.close();
    }

    @ParameterizedTest
    @ValueSource(strings = {"KG_DOC", "KG_QA", "KG_TERM", "SKILL", "TOOLKIT", "MCP", "AGENT"})
    void unpublishingPreservesSourceDataAndInvalidatesUse(String type) {
        resource.setResourceBizType(type);
        service.unShelfResource(10L);
        assertThat(resource.getResourceStatus()).isEqualTo(3);
        verify(resources).updateResourceEntity(resource);
        verify(resources, never()).removeById(anyLong());
        verifyNoInteractions(datasets);
        verify(artifacts).deleteResourceJsonByBizType(type, 10L);
        verify(auth).invalidateResourceAuthorizationCachesAfterCommit(10L, type);
    }

    @ParameterizedTest
    @CsvSource({"TOOLKIT,0", "TOOLKIT,3", "SKILL,3", "KG_DOC,3"})
    void publishingAllowsDraftOrUnpublishedData(String type, int status) {
        resource.setResourceBizType(type);
        resource.setResourceStatus(status);
        service.shelfResource(10L);
        assertThat(resource.getResourceStatus()).isEqualTo(2);
        verify(resources).updateResourceEntity(resource);
        verifyNoInteractions(datasets);
        verify(artifacts, never()).deleteResourceJsonByBizType(anyString(), anyLong());
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL", "TOOLKIT", "KG_DOC"})
    void deregisteringRetainsAnUnrestorableRecord(String type) {
        resource.setResourceBizType(type);
        resource.setResourceStatus(3);
        service.deregisterResource(10L);
        assertThat(resource.getResourceStatus()).isEqualTo(-1);
        verify(resources, never()).removeById(anyLong());
        if ("KG_DOC".equals(type)) verify(datasets).deleteDataset(10L);
        else verifyNoInteractions(datasets);
        assertThatThrownBy(() -> service.restoreManagedResource(10L, true))
            .hasMessage("resource.lifecycle.status.invalid");
    }

    @Test
    void publishingRebuildsTheStandardJson() {
        resource.setResourceStatus(3);
        com.iwhalecloud.byai.manager.entity.resource.SsResExtToolKit ext =
            new com.iwhalecloud.byai.manager.entity.resource.SsResExtToolKit();
        ext.setResourceId(10L);
        ext.setTargetContent("{}");
        when(toolkits.findById(10L)).thenReturn(ext);
        service.shelfResource(10L);
        verify(artifacts).syncResourceJsonByBizType(contains("resourceId"), eq("TOOLKIT"), eq(10L));
        verify(toolkits).update(ext);
    }

    @Test
    void publishedEnterpriseDataMustBeUnpublishedBeforeDeregistration() {
        assertThatThrownBy(() -> service.deregisterResource(10L)).hasMessage("resource.lifecycle.status.invalid");
        verify(resources, never()).updateResourceEntity(any());
        verifyNoInteractions(artifacts, datasets);
    }

    @Test
    void personalDataCanBeDeregisteredButCannotBeUnpublished() {
        resource.setOwnerType("personal");
        assertThatThrownBy(() -> service.unShelfResource(10L)).hasMessage("resource.lifecycle.status.invalid");
        service.deregisterResource(10L);
        assertThat(resource.getResourceStatus()).isEqualTo(-1);
    }

    @Test
    void permissionDenialCannotBeBypassedByCallingTheEndpointDirectly() {
        permissions.setCanOffShelf(false);
        assertThatThrownBy(() -> service.unShelfResource(10L)).hasMessage("user.permission.nopermission");
        verify(resources, never()).updateResourceEntity(any());
        verifyNoInteractions(artifacts);
    }

    @Test
    void refreshingRelatedEmployeesIsScheduledAfterStateChanges() {
        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceId(20L);
        relation.setRelResourceId(10L);
        when(relations.list(any())).thenReturn(List.of(relation));
        SsResource employee = new SsResource();
        employee.setResourceId(20L);
        employee.setResourceBizType("DIG_EMPLOYEE");
        when(resources.findByIdList(List.of(20L))).thenReturn(List.of(employee));
        service.unShelfResource(10L);
        verify(refresh).scheduleDigitalEmployeeUpdateRefreshAfterCommit(20L, null);
    }

    @Test
    void externalKnowledgeRemainsReadOnly() {
        resource.setResourceBizType("KG_DOC");
        ReflectionTestUtils.setField(service, "datasetSystem", "external");
        assertThatThrownBy(() -> service.unShelfResource(10L))
            .hasMessage("commercial.not.support.knowledge.operation");
        verify(resources, never()).updateResourceEntity(any());
    }
}
