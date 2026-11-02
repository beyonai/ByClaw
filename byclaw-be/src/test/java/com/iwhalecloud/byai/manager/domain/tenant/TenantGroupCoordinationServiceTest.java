package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
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
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.ChatTurnPreparationException;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMemberUidCodec;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispatchPromptBuilder;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionContextFileService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionContextFileService.ContextFile;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionContextFileService.GroupMember;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;

class TenantGroupCoordinationServiceTest extends I18nTestSupport {
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final GroupWorkAssistantService assistants = mock(GroupWorkAssistantService.class);
    private final SsResourceService resources = mock(SsResourceService.class);
    private final AuthApplicationService grants = mock(AuthApplicationService.class);
    private final TenantGroupCoordinationService service = new TenantGroupCoordinationService(node, assistants, resources, grants,
        new GroupChatMemberUidCodec());
    private final TenantRequestContext tenant = new TenantRequestContext(20L, 10L, "MEMBER");

    private final UserService users = mock(UserService.class);
    private final GroupChatSessionContextFileService files = mock(GroupChatSessionContextFileService.class);

    @BeforeEach
    void history() {
        var memberRouting = mock(com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMemberRoutingService.class);
        when(memberRouting.withRoutes(any(), any())).thenAnswer(call -> call.getArgument(0));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "memberRouting", memberRouting);
        service.configureHistory(files, new GroupChatDispatchPromptBuilder(), users);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "messageDisplayService",
            new TenantGroupMessageDisplayService(users));
        Users user = new Users(); user.setUserId(20L); user.setUserCode("user-20");
        when(users.findById(20L)).thenReturn(user);
        MessageView input = new MessageView(); input.setMessageId("60"); input.setSessionId("50"); input.setUsage(1); input.setCreatorId("20");
        input.setMetadata("{\"groupPublicContext\":{\"groupSessionId\":\"30\",\"beforeMessageId\":\"8000000010000000201\"}}");
        when(node.request(eq(tenant), eq("POST"), eq("/internal/v1/assiman/getMessageByIds"), any(), any())).thenReturn(List.of(input));
        when(node.request(eq(tenant), eq("POST"), eq("/internal/v1/group-chats/30/context"), any(), any()))
            .thenReturn(Map.of("conversationKey", "30", "snapshot", Map.of("beforeMessageId", "8000000010000000201"), "messages", List.of()));
        when(files.prepareGroupSnapshot(eq("user-20"), any(), any(), any(), any())).thenAnswer(call ->
            new ContextFile("GROUP_PUBLIC", "/by/context/group-history.json", call.getArgument(1, GroupChatContextRequest.class).getBeforeMessageId(), call.getArgument(4)));
        when(files.prepareGroupMemberSnapshot(eq("user-20"), any(), any(), any(), any(), any()))
            .thenReturn(new ContextFile("GROUP_MEMBERS", "/by/context/group-members.json", "8000000010000000201"));
    }

    @AfterEach
    void clear() { TenantRequestContextHolder.clear(); }

    @Test
    void agentSnapshotCompletesCurrentUserNamesBeforeConvertingTheNodeResponse() {
        stored(scope("COORDINATED"), "90");
        when(resources.findById(90L)).thenReturn(coordinator());
        Users sender = new Users();
        sender.setUserId(9007199254740993L);
        sender.setUserName("当前用户名");
        when(users.findByIds(org.mockito.ArgumentMatchers.anyCollection())).thenReturn(List.of(sender));
        when(node.request(eq(tenant), eq("POST"), eq("/internal/v1/group-chats/30/context"), any(), any()))
            .thenReturn(Map.of("conversationKey", "30", "messages", List.of(Map.of(
                "messageId", "8000000010000000200", "creatorId", "9007199254740993", "creatorName", "9007199254740993",
                "usage", 1, "speaker", Map.of("type", "user", "userCode", "9007199254740993")))));

        service.decorate(executionContext(request(90L)), "继续任务", new HashMap<>());

        ArgumentCaptor<GroupChatContextResponse> snapshot = ArgumentCaptor.forClass(GroupChatContextResponse.class);
        verify(files).prepareGroupSnapshot(eq("user-20"), any(), any(), any(), snapshot.capture());
        assertThat(snapshot.getValue().getMessages().get(0).getSpeaker().getDisplayName()).isEqualTo("当前用户名");
        verify(users).findByIds(org.mockito.ArgumentMatchers.anyCollection());
    }

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
        assertThat(result.toString()).contains("/by/context/group-history.json", "请先读取", "group-members.json");
        assertThat(result.toString()).contains("/by/.sessions/50/.byclaw/task-delivery.json");
        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(node).request(eq(tenant), eq("POST"), eq("/internal/v1/group-chats/30/context"), body.capture(), any());
        assertThat(body.getValue()).containsEntry("beforeMessageId", "8000000010000000201").containsEntry("agentContext", true);
        assertThat(gateway.get("groupCoordinator")).isEqualTo(Map.of("id", "90", "name", "群组工作助手"));
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(longs = {42L, 90L})
    void singleMentionClassifiesBeforeApplyingTheTaskContract(long target) {
        stored(scope("DIRECT"), Long.toString(target));
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/50"), eq(null), any()))
            .thenReturn(Map.of("state", "GROUP_TASK_CANDIDATE", "groupCoordination", scope("DIRECT"),
                "targetAgentId", Long.toString(target), "groupDispatch", candidate(target)));
        when(resources.findById(90L)).thenReturn(coordinator());
        AssistantChatDto request = request(target);
        request.setExtParams(Map.of("tenantGroupCandidate", false, "groupDispatch", Map.of("dispatchId", "999")));

        String result = service.decorate(executionContext(request), "hello", new HashMap<>()).toString();

        assertThat(result).contains("[群聊协议]", "group_request_assistance", "只有判定为 TASK 时才适用", "group-members.json")
            .doesNotContain("平台确定为 GROUP_TASK", "处理自己的任务", "\"dispatchId\":\"999\"");
        assertThat(request.getExtParams()).containsEntry("tenantGroupCandidate", true)
            .containsEntry("groupDispatch", candidate(target));
    }

    @Test
    void candidateCannotSwitchAwayFromTheMentionedEmployee() {
        stored(scope("DIRECT"), "42");
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/50"), eq(null), any()))
            .thenReturn(Map.of("state", "GROUP_TASK_CANDIDATE", "groupCoordination", scope("DIRECT"),
                "targetAgentId", "42", "groupDispatch", candidate(42)));
        assertThatThrownBy(() -> service.validateRequest(request(43L))).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void promotedTaskDoesNotReclassifyAndStillAllowsManualGroupSwitching() {
        stored(scope("DIRECT"), "42");
        Map<String, Object> dispatch = new HashMap<>(candidate(42));
        dispatch.put("disposition", "TASK");
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/50"), eq(null), any()))
            .thenReturn(Map.of("state", "GROUP_TASK", "groupCoordination", scope("DIRECT"),
                "targetAgentId", "42", "groupDispatch", dispatch));
        when(resources.findById(90L)).thenReturn(coordinator());
        AssistantChatDto request = request(43L);
        request.setExtParams(Map.of("tenantGroupCandidate", true));

        ChatProcessContext context = executionContext(request);
        String result = service.decorate(context, "继续", new HashMap<>()).toString();
        assertThat(context.getGroupSessionId()).isEqualTo(30L);

        assertThat(request.getExtParams()).doesNotContainKey("tenantGroupCandidate");
        assertThat(result).contains("task-delivery.json").doesNotContain("群聊判定协议");
    }

    @Test
    void clientCannotTurnAnEstablishedTaskIntoACandidate() {
        stored(scope("COORDINATED"), "90");
        when(resources.findById(90L)).thenReturn(coordinator());
        AssistantChatDto request = request(90L);
        request.setExtParams(Map.of("tenantGroupCandidate", true, "groupDispatch", candidate(90)));
        String result = service.decorate(executionContext(request), "hello", new HashMap<>()).toString();
        assertThat(request.getExtParams()).doesNotContainKeys("tenantGroupCandidate", "groupDispatch");
        assertThat(result).contains("平台确定为 GROUP_TASK").doesNotContain("群聊判定协议");
    }

    private Map<String, Object> candidate(long target) {
        return Map.of("schemaVersion", "1", "dispatchId", "70", "candidateSessionId", "50", "groupSessionId", "30",
            "sourceMessageId", "8000000010000000201", "initiatorUserId", "20", "targetAgentId", Long.toString(target),
            "status", "RUNNING", "disposition", "UNKNOWN");
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
        assertThat(context.getGroupSessionId()).isEqualTo(30L);
        assertThat(result.toString()).contains("GROUP_TASK", "不要重新判断", "请先读取", "group-members.json");
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

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"COORDINATED,90", "DIRECT,42"})
    @SuppressWarnings("unchecked")
    void memberFileUsesAuthorizedNodeRosterAndReusesTheScopeValidationRead(String mode, long target) {
        stored(scope(mode), Long.toString(target));
        when(resources.findById(90L)).thenReturn(coordinator());
        AssistantChatDto request = request(target);
        Map<String, Object> gateway = new HashMap<>();

        String result = service.decorate(executionContext(request), "制作视频", gateway).toString();

        assertThat(result).containsOnlyOnce("/by/context/group-members.json")
            .doesNotContain("群内昵称", "文案员工", "检索员工", "未选员工", "HUMAN_20");
        ArgumentCaptor<List<GroupMember>> roster = ArgumentCaptor.forClass(List.class);
        ArgumentCaptor<GroupChatContextRequest> context = ArgumentCaptor.forClass(GroupChatContextRequest.class);
        ArgumentCaptor<GroupChatContextResponse> snapshot = ArgumentCaptor.forClass(GroupChatContextResponse.class);
        verify(files).prepareGroupMemberSnapshot(eq("user-20"), context.capture(), eq("trace-60"), eq(60L),
            snapshot.capture(), roster.capture());
        assertThat(context.getValue().getTargetAgentId()).isEqualTo(target);
        assertThat(snapshot.getValue().getConversationKey()).isEqualTo("30");
        assertThat(snapshot.getValue().getSnapshot().getBeforeMessageId()).isEqualTo("8000000010000000201");
        if ("COORDINATED".equals(mode)) {
            assertThat(roster.getValue()).containsExactly(new GroupMember("群内昵称", "HUMAN_20"),
                new GroupMember("文案员工", "DIG_EMPLOYEE_42"), new GroupMember("检索员工", "DIG_EMPLOYEE_43"));
        }
        else {
            assertThat(roster.getValue()).containsExactly(new GroupMember("群内昵称", "HUMAN_20"),
                new GroupMember("群内助手", "DIG_EMPLOYEE_90"));
        }
        verify(node, times(1)).request(eq(tenant), eq("GET"), eq("/internal/v1/group-chats/30"), eq(null), any());
        assertThat(gateway).doesNotContainKey("members");
        assertThat(request.getExtParams()).doesNotContainKey("members");
    }

    @Test
    @SuppressWarnings("unchecked")
    void unscopedCandidateAlsoGetsAFileWithNodeMembersExceptItself() {
        stored(scope("DIRECT"), "42");
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/50"), eq(null), any()))
            .thenReturn(Map.of("state", "GROUP_TASK_CANDIDATE", "groupDispatch", candidate(42)));

        ChatProcessContext context = executionContext(request(42L));
        String result = service.decorate(context, "hello", new HashMap<>()).toString();
        assertThat(context.getGroupSessionId()).isEqualTo(30L);

        assertThat(result).contains("group-members.json", "[群聊协议]", "group_request_assistance")
            .doesNotContain("群内昵称", "文案员工", "检索员工", "未选员工", "HUMAN_20");
        ArgumentCaptor<List<GroupMember>> roster = ArgumentCaptor.forClass(List.class);
        verify(files).prepareGroupMemberSnapshot(eq("user-20"), any(), eq("trace-60"), eq(60L), any(), roster.capture());
        assertThat(roster.getValue()).containsExactly(new GroupMember("群内昵称", "HUMAN_20"),
            new GroupMember("群内助手", "DIG_EMPLOYEE_90"), new GroupMember("检索员工", "DIG_EMPLOYEE_43"),
            new GroupMember("未选员工", "DIG_EMPLOYEE_77"));
        verify(node, times(1)).request(eq(tenant), eq("GET"), eq("/internal/v1/group-chats/30"), eq(null), any());
    }

    @Test
    void unscopedCandidateRejectsAnEmployeeWhoHasLeftTheGroup() {
        stored(scope("DIRECT"), "42");
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/50"), eq(null), any()))
            .thenReturn(Map.of("state", "GROUP_TASK_CANDIDATE", "groupDispatch", candidate(42)));
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/group-chats/30"), eq(null), any()))
            .thenReturn(Map.of("members", List.of(Map.of("memObjType", "USER", "memObjId", "20", "memName", "群内昵称"))));

        assertThatThrownBy(() -> service.decorate(executionContext(request(42L)), "hello", new HashMap<>()))
            .isInstanceOf(ResponseStatusException.class);
        verify(files, never()).prepareGroupMemberSnapshot(any(), any(), any(), any(), any(), any());
    }

    @Test
    @SuppressWarnings("unchecked")
    void inheritedCoordinationChildOnlyReferencesItsCoordinatorAndHumanMembers() {
        stored(scope("COORDINATED"), "42");
        Map<String, Object> parentScope = new HashMap<>(scope("COORDINATED"));
        parentScope.put("taskSessionId", "40");
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/50"), eq(null), any()))
            .thenReturn(Map.of("groupCoordination", parentScope, "targetAgentId", "42", "groupCoordinationChild", true));
        when(resources.findById(90L)).thenReturn(coordinator());

        String result = service.decorate(executionContext(request(42L)), "继续协作", new HashMap<>()).toString();

        assertThat(result).containsOnlyOnce("/by/context/group-members.json");
        ArgumentCaptor<List<GroupMember>> roster = ArgumentCaptor.forClass(List.class);
        verify(files).prepareGroupMemberSnapshot(eq("user-20"), any(), any(), any(), any(), roster.capture());
        assertThat(roster.getValue()).containsExactly(new GroupMember("群内昵称", "HUMAN_20"),
            new GroupMember("群内助手", "DIG_EMPLOYEE_90"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void switchedTaskEmployeeGetsItsOwnMemberContextIdentity() {
        stored(scope("DIRECT"), "42");
        when(resources.findById(90L)).thenReturn(coordinator());

        service.decorate(executionContext(request(43L)), "继续任务", new HashMap<>());

        ArgumentCaptor<GroupChatContextRequest> context = ArgumentCaptor.forClass(GroupChatContextRequest.class);
        ArgumentCaptor<List<GroupMember>> roster = ArgumentCaptor.forClass(List.class);
        verify(files).prepareGroupMemberSnapshot(eq("user-20"), context.capture(), eq("trace-60"), eq(60L), any(), roster.capture());
        assertThat(context.getValue().getTargetAgentId()).isEqualTo(43L);
        assertThat(roster.getValue()).containsExactly(new GroupMember("群内昵称", "HUMAN_20"),
            new GroupMember("群内助手", "DIG_EMPLOYEE_90"));
    }

    @Test
    void memberUploadFailureStopsTenantDecoration() {
        stored(scope("DIRECT"), "42");
        when(resources.findById(90L)).thenReturn(coordinator());
        when(files.prepareGroupMemberSnapshot(eq("user-20"), any(), any(), any(), any(), any()))
            .thenThrow(new ChatTurnPreparationException("成员上下文准备失败，请重试", new IllegalStateException("storage")));

        assertThatThrownBy(() -> service.decorate(executionContext(request(42L)), "制作视频", new HashMap<>()))
            .isInstanceOf(ChatTurnPreparationException.class).hasMessage("成员上下文准备失败，请重试");
    }

    @Test
    void tenantAttachmentPayloadKeepsOriginalFilesAndBody() {
        stored(scope("DIRECT"), "42");
        when(resources.findById(90L)).thenReturn(coordinator());
        JSONArray content = JSON.parseArray("[{\"role\":\"user\",\"content\":{\"text\":\"分析附件\",\"files\":[{\"name\":\"report.txt\"}]}}]");

        JSONArray decorated = (JSONArray) service.decorate(executionContext(request(42L)), content, new HashMap<>());

        assertThat(decorated.getJSONObject(0).getJSONObject("content").getString("text"))
            .containsOnlyOnce("/by/context/group-members.json").doesNotContain("HUMAN_20", "文案员工");
        assertThat(content.getJSONObject(0).getJSONObject("content").getString("text")).isEqualTo("分析附件");
        assertThat(decorated.getJSONObject(0).getJSONObject("content").getJSONArray("files"))
            .isEqualTo(content.getJSONObject(0).getJSONObject("content").getJSONArray("files"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void missingNodeNamesFallBackToPlatformIdentityWithoutChangingMemberUid() {
        stored(scope("DIRECT"), "42");
        when(resources.findById(90L)).thenReturn(coordinator());
        Users user = new Users(); user.setUserId(20L); user.setUserCode("user-20"); user.setUserName("平台用户");
        when(users.findById(20L)).thenReturn(user);
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/group-chats/30"), eq(null), any()))
            .thenReturn(Map.of("members", List.of(
                Map.of("memObjType", "USER", "memObjId", "20", "memName", ""),
                Map.of("memObjType", "AGENT", "memObjId", "90"),
                Map.of("memObjType", "AGENT", "memObjId", "42"),
                Map.of("memObjType", "AGENT", "memObjId", "43"))));

        service.decorate(executionContext(request(42L)), "hello", new HashMap<>());

        ArgumentCaptor<List<GroupMember>> roster = ArgumentCaptor.forClass(List.class);
        verify(files).prepareGroupMemberSnapshot(eq("user-20"), any(), any(), any(), any(), roster.capture());
        assertThat(roster.getValue()).containsExactly(new GroupMember("平台用户", "HUMAN_20"),
            new GroupMember("群组工作助手", "DIG_EMPLOYEE_90"));
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
                Map.of("memObjType", "USER", "memObjId", "20", "memName", "群内昵称"),
                Map.of("memObjType", "AGENT", "memObjId", "90", "memName", "群内助手"),
                Map.of("memObjType", "AGENT", "memObjId", "42", "memName", "文案员工"),
                Map.of("memObjType", "AGENT", "memObjId", "43", "memName", "检索员工"),
                Map.of("memObjType", "AGENT", "memObjId", "77", "memName", "未选员工"))));
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
