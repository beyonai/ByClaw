package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.common.quota.SharedQuotaAdmission;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupWorkAssistantService;
import com.iwhalecloud.byai.state.domain.groupchat.application.WorkgroupTemplateService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Initial quota rejection happens before platform project/cloud and grant side effects. */
class TenantGroupCreationQuotaTest {
    @Test
    void checksDeduplicatedHumansAndAgentsBeforeProjectCreation() {
        var node = mock(TenantNodeClient.class);
        var projects = mock(ProjectApplicationService.class);
        var members = mock(TenantGroupMemberService.class);
        var grants = mock(AuthApplicationService.class);
        var quota = mock(SharedQuotaAdmission.class);
        var assistant = mock(GroupWorkAssistantService.class);
        when(assistant.resolveDefaultCoordinatorId()).thenReturn(50L);
        var service = new TenantGroupCreationService(node, mock(TenantGroupData.class), members, projects,
                mock(WorkgroupTemplateService.class), grants);
        ReflectionTestUtils.setField(service, "groupWorkAssistant", assistant);
        ReflectionTestUtils.setField(service, "quotaAdmission", quota);
        var request = new GroupChatCreateRequest(); request.setName("group");
        request.setUserIds(List.of(1L, 2L, 2L, 3L)); request.setAgentIds(List.of(50L, 101L, 102L, 103L));
        doThrow(new ResponseStatusException(HttpStatus.CONFLICT, "groupchat.agent.limit.reached"))
                .when(quota).checkInitialWorkgroup(42L, 3, 4);
        assertThrows(ResponseStatusException.class, () -> service.create(new TenantRequestContext(1L, 42L, "OWNER"), request));
        verifyNoInteractions(node, projects, members, grants);
    }
}
