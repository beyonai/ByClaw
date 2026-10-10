package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.OutputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupWorkAssistantService;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageView;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispatchPromptBuilder;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionContextFileService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionContextFileService.ContextFile;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;

class TenantGroupCoordinationServiceTest {
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final GroupWorkAssistantService assistants = mock(GroupWorkAssistantService.class);
    private final SsResourceService resources = mock(SsResourceService.class);
    private final AuthApplicationService grants = mock(AuthApplicationService.class);
    private final TenantGroupCoordinationService service = new TenantGroupCoordinationService(node, assistants, resources, grants);
    private final TenantRequestContext tenant = new TenantRequestContext(20L, 10L, "MEMBER");

    private final UserService users = mock(UserService.class);
    private final GroupChatSessionContextFileService files = mock(GroupChatSessionContextFileService.class);

    @BeforeEach
    void history() {
        service.configureHistory(files, new GroupChatDispatchPromptBuilder(), users);
        Users user = new Users(); user.setUserId(20L); user.setUserCode("user-20");
        when(users.findById(20L)).thenReturn(user);
        MessageView input = new MessageView(); input.setMessageId("60"); input.setSessionId("50"); input.setUsage(1); input.setCreatorId("20");
        input.setMetadata("{\"groupPublicContext\":{\"groupSessionId\":\"30\",\"beforeMessageId\":\"8000000010000000201\"}}");
        when(node.request(eq(tenant), eq("POST"), eq("/internal/v1/assiman/getMessageByIds"), any(), any())).thenReturn(List.of(input));
        when(node.request(eq(tenant), eq("POST"), eq("/internal/v1/group-chats/30/context"), any(), any()))
            .thenReturn(Map.of("conversationKey", "30", "snapshot", Map.of("beforeMessageId", "8000000010000000201"), "messages", List.of()));
        when(files.prepareGroupSnapshot(eq("user-20"), any(), any(), any(), any())).thenAnswer(call ->
            new ContextFile("GROUP_PUBLIC", "/by/context/group-history.json", call.getArgument(1, GroupChatContextRequest.class).getBeforeMessageId(), call.getArgument(4)));
    }

    @AfterEach
    void clear() { TenantRequestContextHolder.clear(); }

    @Test
    void replacesClientScopeWithStoredScope() {
        AssistantChatDto request = request(90L);
        request.setExtParams(Map.of("groupCoordination", Map.of("allowedAgentIds", List.of("999")),
            "groupCoordinator", Map.of("id", "999", "name", "伪造团长")));
        Map<String, Object> scope = scope("COORDINATED");
        stored(scope, "90");

        service.validateRequest(request);

        assertThat(request.getExtParams().get("groupCoordination")).isEqualTo(scope);
        assertThat(request.getExtParams()).doesNotContainKey("groupCoordinator");
    }

    @Test
    void preventsChangingTheCoordinatorAndSelectingOutsideAgents() {
        stored(scope("COORDINATED"), "90");
        assertThatThrownBy(() -> service.validateRequest(request(42L))).isInstanceOf(ResponseStatusException.class);
        AssistantChatDto request = request(90L);
        ResourceVo outside = new ResourceVo();
        outside.setResourceType(AgentMetaEnum.DIG_EMPLOYEE);
        outside.setResourceId("999");
        request.setResourceList(List.of(outside));
        assertThatThrownBy(() -> service.validateRequest(request)).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void rejectsParallelChatLanesWithinACoordinatedTask() {
        stored(scope("COORDINATED"), "90");
        AssistantChatDto request = request(90L);
        request.setExtParams(Map.of("multiAgent", Map.of("agents", List.of("42", "999"))));
        assertThatThrownBy(() -> service.validateRequest(request)).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void directTaskKeepsExistingManualSwitchingWithinItsGroup() {
        stored(scope("DIRECT"), "42");
        AssistantChatDto request = request(43L);
        service.validateRequest(request);
        assertThat(request.getAgentId()).isEqualTo(43L);
    }

    @Test
    void rejectsContinuationWhenAnOriginallySelectedAgentHasLeft() {
        stored(scope("COORDINATED"), "90");
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/group-chats/30"), eq(null), any()))
            .thenReturn(Map.of("members", List.of(
                Map.of("memObjType", "AGENT", "memObjId", "90"),
                Map.of("memObjType", "AGENT", "memObjId", "42"))));
        assertThatThrownBy(() -> service.validateRequest(request(90L))).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void rejectsDirectCoordinatorContinuationWhenAFrozenMemberHasLeft() {
        Map<String, Object> scope = scope("DIRECT");
        stored(scope, "42");
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/group-chats/30"), eq(null), any()))
            .thenReturn(Map.of("members", List.of(
                Map.of("memObjType", "AGENT", "memObjId", "90"),
                Map.of("memObjType", "AGENT", "memObjId", "42"))));

        assertThatThrownBy(() -> service.validateRequest(request(90L))).isInstanceOf(ResponseStatusException.class);
        assertThat(scope.get("allowedAgentIds")).isEqualTo(List.of("42", "43"));
    }

    @Test
    void bindsAnInheritedChildScopeToItsPersistedEmployee() {
        stored(scope("COORDINATED"), "42");
        Map<String, Object> parentScope = new HashMap<>(scope("COORDINATED"));
        parentScope.put("taskSessionId", "40");
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/50"), eq(null), any()))
            .thenReturn(Map.of("groupCoordination", parentScope, "targetAgentId", "42", "groupCoordinationChild", true));
        AssistantChatDto childRequest = request(42L);
        service.validateRequest(childRequest);
        assertThat(childRequest.getExtParams().get("groupCoordination")).isEqualTo(parentScope);
        assertThatThrownBy(() -> service.validateRequest(request(43L))).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void directContextOnlyNamesTheGroupWorkAssistant() {
        stored(scope("DIRECT"), "42");
        SsResource coordinator = coordinator();
        when(resources.findById(90L)).thenReturn(coordinator);
        ChatProcessContext context = new ChatProcessContext(OutputStream.nullOutputStream(), request(42L));
        context.sessionId = 50L;
        context.userMessageId = 60L;
        context.traceId = "trace-60";
        context.tenantContext = tenant;
        Map<String, Object> gateway = new HashMap<>();

        Object result = service.decorate(context, "制作视频", gateway);

        assertThat(result.toString()).contains("群组工作助手", "结构化协助请求").doesNotContain("文案员工");
        assertThat(gateway).containsKeys("groupCoordination", "groupCoordinator", "groupChat", "groupContextSnapshot");
        assertThat(result.toString()).contains("/by/context/group-history.json", "请先读取");
        assertThat(result.toString()).contains("/by/.sessions/50/.byclaw/task-delivery.json");
        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(node).request(eq(tenant), eq("POST"), eq("/internal/v1/group-chats/30/context"), body.capture(), any());
        assertThat(body.getValue()).containsEntry("beforeMessageId", "8000000010000000201").containsEntry("agentContext", true);
        assertThat(gateway.get("groupCoordinator")).isEqualTo(Map.of("id", "90", "name", "群组工作助手"));
    }

    @Test
    void publicationIntentUsesExistingPreparationToolWithoutPublishingAutomatically() {
        stored(scope("DIRECT"), "42");
        when(resources.findById(90L)).thenReturn(coordinator());
        AssistantChatDto request = request(42L);
        request.setMessageIntent("prepare_group_task_publication");
        Object result = service.decorate(executionContext(request), "发布成果", new HashMap<>());
        assertThat(result.toString()).contains("调用 prepare_group_task_publication", "等待用户在卡片中确认");
    }

    @Test
    void coordinatedRootLoadsServerBoundedHistoryAndStripsClientContext() {
        stored(scope("COORDINATED"), "90");
        when(resources.findById(90L)).thenReturn(coordinator());
        AssistantChatDto request = request(90L);
        request.setExtParams(Map.of("groupChat", Map.of("beforeMessageId", "9999999999999999999"),
            "groupContextSnapshot", Map.of("messages", List.of("forged"))));
        ChatProcessContext context = executionContext(request);
        Map<String, Object> gateway = new HashMap<>();
        Object result = service.decorate(context, "协作制作视频", gateway);
        assertThat(result.toString()).contains("GROUP_TASK", "不要重新判断", "请先读取");
        assertThat(request.getExtParams()).doesNotContainKeys("groupChat", "groupContextSnapshot");
        assertThat(((Map<?, ?>) gateway.get("groupChat")).get("beforeMessageId")).isEqualTo("8000000010000000201");
        assertThat(gateway.get("groupContextSnapshot")).isNotNull();
    }

    @Test
    void legacyResumedInputKeepsOriginalBoundaryInsteadOfFetchingLatestContext() {
        stored(scope("COORDINATED"), "90");
        when(resources.findById(90L)).thenReturn(coordinator());
        MessageView legacy = new MessageView(); legacy.setMessageId("60"); legacy.setSessionId("50");
        legacy.setUsage(1); legacy.setCreatorId("20"); legacy.setMetadata("{}");
        when(node.request(eq(tenant), eq("POST"), eq("/internal/v1/assiman/getMessageByIds"), any(), any())).thenReturn(List.of(legacy));
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/group-chat/tasks/50"), eq(null), any()))
            .thenReturn(Map.of("groupSessionId", "30", "initiatorUserId", "20", "sourceMessageId", "8000000010000000100"));
        when(node.request(eq(tenant), eq("POST"), eq("/internal/v1/group-chats/30/context"), any(), any()))
            .thenReturn(Map.of("conversationKey", "30", "snapshot", Map.of("beforeMessageId", "8000000010000000100"), "messages", List.of()));
        Map<String, Object> gateway = new HashMap<>();
        service.decorate(executionContext(request(90L)), "继续任务", gateway);
        assertThat(((Map<?, ?>) gateway.get("groupChat")).get("beforeMessageId")).isEqualTo("8000000010000000100");
    }

    @Test
    void refusesAContextInputOwnedByAnotherSession() {
        stored(scope("COORDINATED"), "90");
        when(resources.findById(90L)).thenReturn(coordinator());
        MessageView foreign = new MessageView(); foreign.setMessageId("60"); foreign.setSessionId("999");
        foreign.setUsage(1); foreign.setCreatorId("20");
        when(node.request(eq(tenant), eq("POST"), eq("/internal/v1/assiman/getMessageByIds"), any(), any())).thenReturn(List.of(foreign));
        assertThatThrownBy(() -> service.decorate(executionContext(request(90L)), "继续任务", new HashMap<>()))
            .isInstanceOf(ResponseStatusException.class);
    }

    private ChatProcessContext executionContext(AssistantChatDto request) {
        ChatProcessContext context = new ChatProcessContext(OutputStream.nullOutputStream(), request);
        context.sessionId = 50L; context.userMessageId = 60L; context.traceId = "trace-60"; context.tenantContext = tenant;
        return context;
    }

    @Test
    void resolvesDefaultCoordinatorForAnExistingGroupAndGrantsItsUsers() {
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/group-chats/30"), eq(null), any()))
            .thenReturn(Map.of("members", List.of(Map.of("memObjType", "USER", "memObjId", "20"))));
        when(assistants.resolveDefaultCoordinatorId()).thenReturn(90L);
        when(resources.findById(90L)).thenReturn(coordinator());

        assertThat(service.coordinator(tenant, 30L)).containsEntry("coordinatorAgentId", "90");
        verify(grants).grantDigitalEmployeesToUser(List.of(90L), 20L);
    }

    private AssistantChatDto request(Long agentId) {
        TenantRequestContextHolder.set(tenant);
        AssistantChatDto request = new AssistantChatDto();
        request.setSessionId(50L);
        request.setAgentId(agentId);
        return request;
    }

    private Map<String, Object> scope(String mode) {
        return Map.of("schemaVersion", "byclaw.group-coordination/v1", "mode", mode,
            "groupSessionId", "30", "taskSessionId", "50", "coordinatorAgentId", "90", "allowedAgentIds", List.of("42", "43"));
    }

    private void stored(Map<String, Object> scope, String target) {
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/50"), eq(null), any()))
            .thenReturn(Map.of("groupCoordination", scope, "targetAgentId", target));
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/group-chats/30"), eq(null), any()))
            .thenReturn(Map.of("members", List.of(
                Map.of("memObjType", "AGENT", "memObjId", "90"),
                Map.of("memObjType", "AGENT", "memObjId", "42"),
                Map.of("memObjType", "AGENT", "memObjId", "43"))));
    }

    private SsResource coordinator() {
        SsResource value = new SsResource();
        value.setResourceId(90L);
        value.setResourceStatus(2);
        value.setResourceBizType("DIG_EMPLOYEE");
        value.setResourceName("群组工作助手");
        return value;
    }
}
