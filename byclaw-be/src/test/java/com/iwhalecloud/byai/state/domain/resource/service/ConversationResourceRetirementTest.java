package com.iwhalecloud.byai.state.domain.resource.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.constants.resource.RetiredConversationResources;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeIdDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.state.domain.resource.qo.ResourceDetailQo;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

class ConversationResourceRetirementTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {
    @ParameterizedTest
    @ValueSource(strings = {"OBJECT", "view", " ONTOLOGY_BASE ", "scene"})
    void detailsResolveTheActualTypeBeforeRejectingAndKeepPermissionChecks(String type) {
        var resource = resource(41L, type);
        resource.setViewAuthControlled(true);
        var resources = mock(SsResourceService.class);
        when(resources.findByIdOrCode(null, "legacy-code")).thenReturn(resource);
        var auth = mock(AuthApplicationService.class);
        var service = new ResourceApplicationService();
        ReflectionTestUtils.setField(service, "ssResourceService", resources);
        ReflectionTestUtils.setField(service, "authApplicationService", auth);
        var request = new ResourceDetailQo();
        request.setResourceCode("legacy-code");
        assertThatThrownBy(() -> service.queryResourceDetail(request)).isInstanceOf(IllegalArgumentException.class)
            .hasMessageNotContaining(RetiredConversationResources.REASON);
        when(auth.hasResourceViewPermission(resource)).thenReturn(true);
        assertThatThrownBy(() -> service.queryResourceDetail(request)).hasMessage(RetiredConversationResources.REASON);
        verify(auth, never()).queryResourceOperationPermissionsBatch(any());
    }

    @Test
    void snapshotProjectionRemovesOnlyRetiredMetadataAndKeepsManualText() {
        String source = """
            {"resourceId":"1","relIds":[11,"12",13],"systemPrompt":"My OBJECT discussion is user-authored",
             "relResourceList":[{"resourceId":11,"resourceBizType":"OBJECT","resourceName":"hidden"},
              {"resourceId":"12","resourceType":"view"},{"resourceId":13,"resourceBizType":"TOOL","resourceName":"normal"}],
             "controlledResources":[{"resourceId":11,"resourceBizType":"OBJECT"}],
             "relResourceInfoList":[{"relId":"11","activeResourceIds":["private"]},{"relId":"13"}],
             "targetContent":"old unfiltered snapshot"}
            """;
        var result = JSON.parseObject(RetiredConversationResources.sanitizeRuntimeJson(source));
        assertThat(result.getJSONArray("relIds")).containsExactly(13);
        assertThat(result.getJSONArray("relResourceList")).hasSize(1);
        assertThat(result.getJSONArray("relResourceInfoList")).hasSize(1);
        assertThat(result.getJSONArray("controlledResources")).isEmpty();
        assertThat(result).doesNotContainKey("targetContent");
        assertThat(result.getString("systemPrompt")).isEqualTo("My OBJECT discussion is user-authored");
        assertThat(source).contains("hidden");
    }

    @Test
    void editorProjectionDoesNotMutateInternalDetails() {
        var details = new DigitalEmployeeDetailsDTO();
        var retired = new SsResourceDTO(); retired.setResourceId(11L); retired.setResourceBizType("SCENE");
        var normal = new SsResourceDTO(); normal.setResourceId(12L); normal.setResourceBizType("KG_DOC");
        details.setRelResourceList(List.of(retired, normal)); details.setRelIds(List.of(11L, 12L));
        details.setTargetContent("old snapshot");
        var request = new EmployeeIdDTO(); request.setResourceId(1L);
        var service = spy(new DigitalEmployeeApplicationService());
        doReturn(details).when(service).findDetailsById(request);
        var visible = service.findVisibleDetailsById(request);
        assertThat(visible.getRelIds()).containsExactly(12L);
        assertThat(visible.getRelResourceList()).extracting(SsResource::getResourceId).containsExactly(12L);
        assertThat(visible.getTargetContent()).isNull();
        assertThat(details.getRelIds()).containsExactly(11L, 12L);
        assertThat(details.getTargetContent()).isEqualTo("old snapshot");
    }

    @ParameterizedTest
    @ValueSource(strings = {"OBJECT", "VIEW", "ONTOLOGY_BASE", "SCENE"})
    void savingHiddenHistoricalRelationsPreservesThemAndRejectsNewAttachments(String type) {
        var service = new DigitalEmployeeApplicationService();
        var resources = mock(SsResourceService.class);
        var relations = mock(SsResourceRelDetailService.class);
        ReflectionTestUtils.setField(service, "ssResourceService", resources);
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", relations);
        when(resources.findByIdList(any())).thenReturn(List.of(resource(11L, type)));
        var employee = resource(1L, "DIG_EMPLOYEE");
        var existing = new SsResourceRelDetail(); existing.setRelResourceId(11L);
        ReflectionTestUtils.invokeMethod(service, "compareSsResourceRelDetail", employee, List.of(), List.of(existing), List.of());
        ReflectionTestUtils.invokeMethod(service, "compareSsResourceRelDetail", employee, List.of(11L), List.of(existing), List.of());
        verifyNoInteractions(relations);
        assertThatThrownBy(() -> ReflectionTestUtils.invokeMethod(service, "compareSsResourceRelDetail",
            employee, List.of(11L), List.of(), List.of())).hasMessage(RetiredConversationResources.REASON);
        verifyNoInteractions(relations);
    }

    private static SsResource resource(long id, String type) {
        var resource = new SsResource(); resource.setResourceId(id); resource.setResourceBizType(type); return resource;
    }
}
