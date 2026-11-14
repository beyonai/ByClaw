package com.iwhalecloud.byai.state.domain.groupchat.humantask;

import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.tenant.*;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class HumanTaskServiceTest {
    private HumanTaskLocalService local;
    private TenantModeService modes;
    private TenantNodeClient node;
    private HumanTaskService service;
    private SsResourceService resources;
    @BeforeEach void setup() {
        local=mock(HumanTaskLocalService.class);modes=mock(TenantModeService.class);node=mock(TenantNodeClient.class);
        resources=mock(SsResourceService.class);
        service=new HumanTaskService(local,modes,node,mock(GroupChatEventPublisher.class),resources);
    }
    @Test void newCardBroadcastsAfterCommitAndReplayDoesNotCreateAnotherMessage() {
        LoginInfo login=new LoginInfo();login.setUserId(20L);login.setComAcctId(1L);CurrentUserHolder.setLoginInfo(login);
        var publisher=mock(GroupChatEventPublisher.class);
        var facade=new HumanTaskService(local,modes,node,publisher,resources);
        JSONObject fresh=JSON.parseObject("{\"batchId\":\"100\",\"groupSessionId\":\"30\",\"senderType\":\"AGENT\",\"senderId\":\"70\",\"senderName\":\"研究助理\",\"confirmedAt\":\"2026-11-13T00:00:00Z\",\"cardMessageId\":\"101\",\"_createdMessageId\":\"101\"}");
        when(local.call(anyLong(),anyLong(),eq("confirm"),any())).thenReturn(fresh);
        org.springframework.transaction.support.TransactionSynchronizationManager.initSynchronization();
        try {
            assertFalse(facade.call("confirm",new JSONObject()).containsKey("_createdMessageId"));
            verifyNoInteractions(publisher);
            for(var sync:org.springframework.transaction.support.TransactionSynchronizationManager.getSynchronizations()) sync.afterCommit();
        } finally { org.springframework.transaction.support.TransactionSynchronizationManager.clearSynchronization(); }
        var captured=org.mockito.ArgumentCaptor.forClass(JSONObject.class);
        verify(publisher,times(2)).publish(eq(30L),captured.capture(),isNull());
        var created=captured.getAllValues().stream().filter(e->"MESSAGE_CREATED".equals(e.getString("event"))).findFirst().orElseThrow();
        assertEquals("100",created.getJSONObject("metadata").getString("batchId"));
        assertEquals("101",created.getString("messageId"));
        assertEquals("70",created.getJSONObject("speaker").getString("agentId"));
        clearInvocations(publisher);
        facade.call("confirm",new JSONObject());
        verify(publisher).publish(eq(30L),argThat(e->"HUMAN_TASK_CHANGED".equals(e.getString("event"))),isNull());
    }
    @Test void remotePrivateCoordinationUsesPublishedServerIdentity() {
        var context = new TenantRequestContext(20L,10L,"MEMBER");
        TenantRequestContextHolder.set(context);
        when(node.request(eq(context),eq("POST"),eq("/internal/v1/group-human-tasks/task"),any(),any()))
            .thenReturn(java.util.Map.of("groupSessionId", "30"));
        when(node.request(eq(context),eq("GET"),eq("/internal/v1/group-chats/30"),isNull(),any()))
            .thenReturn(java.util.Map.of("coordinatorAgentId", "70"));
        SsResource coordinator = new SsResource();
        coordinator.setResourceStatus(2); coordinator.setResourceBizType("DIG_EMPLOYEE"); coordinator.setResourceName("协作助手");
        when(resources.findById(70L)).thenReturn(coordinator);
        var body = JSON.parseObject("{\"humanTaskId\":\"100\",\"agentIds\":[\"71\",\"72\"],\"entryType\":\"PRIVATE\",\"requestId\":\"open-1\",\"_resolvedCoordinator\":{\"coordinatorAgentId\":\"99\"}}");
        service.call("bind", body);
        verify(node).request(eq(context),eq("POST"),eq("/internal/v1/group-human-tasks/bind"),argThat(value -> {
            JSONObject actual = (JSONObject) value;
            return "70".equals(actual.getJSONObject("_resolvedCoordinator").getString("coordinatorAgentId"));
        }),any());
        coordinator.setResourceStatus(0);
        assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> service.call("bind", body));
    }

    @AfterEach void clean(){CurrentUserHolder.clearLoginInfo();TenantRequestContextHolder.clear();}
    @Test void personalScopeDoesNotUseCloudFallbackEnterprise() {
        LoginInfo login=new LoginInfo();login.setUserId(20L);login.setComAcctId(99L);CurrentUserHolder.setLoginInfo(login);
        service.task(2L);
        verify(local).call(eq(0L),eq(20L),eq("task"),any());verifyNoInteractions(node);
    }
    @Test void independentTenantFailureNeverFallsBackToPublicDatabase() {
        TenantRequestContext context=new TenantRequestContext(20L,10L,"MEMBER");TenantRequestContextHolder.set(context);
        when(node.request(eq(context),eq("POST"),eq("/internal/v1/group-human-tasks/task"),any(),any())).thenThrow(new IllegalStateException("unavailable"));
        assertThrows(IllegalStateException.class,()->service.task(2L));verifyNoInteractions(local);
    }
    @Test void sharedTenantUsesAuthenticatedBusinessIdentity() {
        TenantRequestContextHolder.set(new TenantRequestContext(20L,10L,"MEMBER"));when(modes.isSharedDataTenant(10L)).thenReturn(true);
        service.task(2L);verify(local).call(eq(10L),eq(20L),eq("task"),any());verifyNoInteractions(node);
    }
    /** Group reads use authenticated shared-tenant identity even when filter data names other users. */
    @Test
    void sharedTenantGroupListUsesTrustedActorAndTenant() {
        TenantRequestContextHolder.set(new TenantRequestContext(20L, 10L, "MEMBER"));
        when(modes.isSharedDataTenant(10L)).thenReturn(true);
        JSONObject body = JSON.parseObject("{\"groupSessionId\":\"30\",\"initiatorUserIds\":[\"21\",\"22\"]}");
        service.call("groupList", body);
        verify(local).call(eq(10L), eq(20L), eq("groupList"), eq(body));
        verifyNoInteractions(node);
    }

    /** Independent tenant group queries retain filters while routing only to their owning node. */
    @Test
    void independentTenantGroupListForwardsFiltersToOwningNode() {
        TenantRequestContext context = new TenantRequestContext(20L, 10L, "MEMBER");
        TenantRequestContextHolder.set(context);
        JSONObject body = JSON.parseObject("{\"groupSessionId\":\"30\",\"assigneeUserIds\":[\"21\",\"22\"],\"status\":\"PENDING\"}");
        service.call("groupList", body);
        verify(node).request(eq(context), eq("POST"), eq("/internal/v1/group-human-tasks/groupList"), eq(body), any());
        verifyNoInteractions(local);
    }

    @Test void missingLoginIsRejectedBeforeDatabaseAccess() {
        assertThrows(RuntimeException.class,()->service.task(2L));verifyNoInteractions(local,node);
    }
    @Test void independentTenantDirectCreationUsesTheOwningNodeAndAuthenticatedContext() {
        TenantRequestContext context=new TenantRequestContext(20L,10L,"MEMBER");TenantRequestContextHolder.set(context);
        JSONObject body=new JSONObject();body.put("groupSessionId","30");body.put("requestId","direct");
        when(node.request(eq(context),eq("POST"),eq("/internal/v1/group-human-tasks/createDirect"),any(),any()))
            .thenReturn(java.util.Map.of("batchId","100","groupSessionId","30","status","CONFIRMED","senderType","USER","senderId","20"));
        JSONObject result=service.call("createDirect",body);
        assertEquals("100",result.getString("batchId"));assertEquals("USER",result.getString("senderType"));
        verify(node).request(eq(context),eq("POST"),eq("/internal/v1/group-human-tasks/createDirect"),eq(body),any());
        verifyNoInteractions(local);
    }

    @Test void remoteProposalUsesVerifiedAgentResourceNameInsteadOfClientProvidedIdentity() {
        TenantRequestContext context = remoteSender();
        JSONObject body = proposalInput();
        service.call("createProposal", body);
        var request = org.mockito.ArgumentCaptor.forClass(JSONObject.class);
        verify(node).request(eq(context), eq("POST"), eq("/internal/v1/group-human-tasks/proposalSender"), request.capture(), any());
        assertEquals("60", request.getValue().getString("sourceTaskSessionId"));
        assertEquals("30", request.getValue().getString("groupSessionId"));
        assertEquals("40", request.getValue().getString("sourceMessageId"));
        assertFalse(request.getValue().containsKey("_resolvedSender"));
        verify(node).request(eq(context), eq("POST"), eq("/internal/v1/group-human-tasks/createProposal"), request.capture(), any());
        JSONObject resolved = request.getValue().getJSONObject("_resolvedSender");
        assertNotNull(resolved);
        assertEquals("70", resolved.getString("senderId")); assertEquals("研究助理", resolved.getString("senderName"));
        verify(resources).findById(70L); verify(resources, never()).findById(999L);
        assertEquals("客户端伪造", body.getJSONObject("_resolvedSender").getString("senderName"));
    }

    @Test void renamedResourceIsResolvedAgainForANewRemoteProposalRequest() {
        TenantRequestContext context = remoteSender();
        JSONObject body = proposalInput();
        service.call("createProposal", body);
        SsResource renamed = new SsResource(); renamed.setResourceName("项目协调员");
        when(resources.findById(70L)).thenReturn(renamed);
        body.put("requestId", "renamed"); service.call("createProposal", body);
        var requests = org.mockito.ArgumentCaptor.forClass(JSONObject.class);
        verify(node, times(2)).request(eq(context), eq("POST"), eq("/internal/v1/group-human-tasks/createProposal"), requests.capture(), any());
        assertEquals("研究助理", requests.getAllValues().get(0).getJSONObject("_resolvedSender").getString("senderName"));
        assertEquals("项目协调员", requests.getAllValues().get(1).getJSONObject("_resolvedSender").getString("senderName"));
    }

    @Test void remoteUserCreationStripsInternalSenderWithoutLookingUpAnEmployee() {
        TenantRequestContext context = new TenantRequestContext(20L, 10L, "MEMBER"); TenantRequestContextHolder.set(context);
        JSONObject body = proposalInput();
        service.call("createDirect", body);
        body.remove("sourceTaskSessionId"); service.call("createProposal", body);
        var request = org.mockito.ArgumentCaptor.forClass(JSONObject.class);
        verify(node).request(eq(context), eq("POST"), eq("/internal/v1/group-human-tasks/createDirect"), request.capture(), any());
        assertFalse(request.getValue().containsKey("_resolvedSender"));
        verify(node).request(eq(context), eq("POST"), eq("/internal/v1/group-human-tasks/createProposal"), request.capture(), any());
        assertFalse(request.getValue().containsKey("_resolvedSender"));
        verifyNoInteractions(resources, local);
        verify(node, never()).request(eq(context), eq("POST"), eq("/internal/v1/group-human-tasks/proposalSender"), any(), any());
    }

    @Test void sharedTenantAlsoStripsClientInternalSenderBeforeCallingLocalStorage() {
        TenantRequestContextHolder.set(new TenantRequestContext(20L, 10L, "MEMBER")); when(modes.isSharedDataTenant(10L)).thenReturn(true);
        service.call("createDirect", proposalInput());
        var request = org.mockito.ArgumentCaptor.forClass(JSONObject.class);
        verify(local).call(eq(10L), eq(20L), eq("createDirect"), request.capture());
        assertFalse(request.getValue().containsKey("_resolvedSender"));
        verifyNoInteractions(node, resources);
    }

    @Test void missingResourceNameDoesNotForwardClientNameAsTheFallback() {
        TenantRequestContext context = remoteSender();
        when(resources.findById(70L)).thenReturn(null);
        service.call("createProposal", proposalInput());
        var request = org.mockito.ArgumentCaptor.forClass(JSONObject.class);
        verify(node).request(eq(context), eq("POST"), eq("/internal/v1/group-human-tasks/createProposal"), request.capture(), any());
        assertFalse(request.getValue().containsKey("_resolvedSender"));
    }

    @Test void sourceLookupFailureCannotCreateAProposalOrQueryAClientSelectedResource() {
        TenantRequestContext context = remoteSender();
        when(node.request(eq(context), eq("POST"), eq("/internal/v1/group-human-tasks/proposalSender"), any(), any()))
            .thenThrow(new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT, "HUMAN_TASK_SOURCE_MISMATCH"));
        assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> service.call("createProposal", proposalInput()));
        verifyNoInteractions(resources, local);
        verify(node, never()).request(eq(context), eq("POST"), eq("/internal/v1/group-human-tasks/createProposal"), any(), any());
    }

    private TenantRequestContext remoteSender() {
        TenantRequestContext context = new TenantRequestContext(20L, 10L, "MEMBER"); TenantRequestContextHolder.set(context);
        when(node.request(eq(context), eq("POST"), eq("/internal/v1/group-human-tasks/proposalSender"), any(), any()))
            .thenReturn(java.util.Map.of("senderType", "AGENT", "senderId", "70", "groupSessionId", "30", "sourceMessageId", "40", "sourceTaskSessionId", "60"));
        SsResource employee = new SsResource(); employee.setResourceName("研究助理");
        when(resources.findById(70L)).thenReturn(employee);
        return context;
    }

    private JSONObject proposalInput() {
        return JSON.parseObject("""
            {"sourceTaskSessionId":"60","groupSessionId":"30","sourceMessageId":"40","requestId":"create",
             "senderId":"999","_resolvedSender":{"senderId":"999","senderName":"客户端伪造"},"items":[]}
            """);
    }
}
