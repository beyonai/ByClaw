package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.Page;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageId;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.SessionQuery;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.SessionView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.SessionUpdate;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectSessionQo;
import com.iwhalecloud.byai.manager.qo.session.ByaiSessionQo;
import com.iwhalecloud.byai.manager.interfaces.controller.devloop.ProjectController;
import com.iwhalecloud.byai.state.interfaces.controller.manage.AssistantManController;
import com.iwhalecloud.byai.state.domain.message.model.SessionOpeartorDto;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class TenantChatRoutingAspectTest {

    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final TenantChatRoutingAspect aspect = new TenantChatRoutingAspect(node);

    @AfterEach
    void clear() {
        TenantRequestContextHolder.clear();
    }

    @Test
    void personalSpaceRunsTheOriginalChatHandler() throws Throwable {
        ProceedingJoinPoint call = mock(ProceedingJoinPoint.class);
        Object original = ResponseUtil.successResponse("personal");
        when(call.proceed()).thenReturn(original);
        assertThat(aspect.route(call)).isSameAs(original);
        verify(call).proceed();
    }

    @Test
    void tenantSessionListUsesNodeAndPreservesResponseEnvelope() throws Throwable {
        TenantRequestContext context = new TenantRequestContext(8L, 123L, "OWNER");
        TenantRequestContextHolder.set(context);
        ByaiSessionQo query = new ByaiSessionQo();
        ProceedingJoinPoint call = call("qryConversations", query);
        when(node.request(eq(context), eq("POST"), eq("/internal/v1/sessions/query"), any(), any()))
            .thenReturn(new Page<>(java.util.List.of(), 21L, 1, 10, 0));
        ResponseUtil<?> result = (ResponseUtil<?>) aspect.route(call);
        assertThat(result.getCode()).isZero();
        assertThat(result.getData()).isNotNull();
        assertThat(((Page<?>) result.getData()).totalPages()).isEqualTo(3);
        verify(node).request(eq(context), eq("POST"), eq("/internal/v1/sessions/query"), any(), any());
    }

    @Test
    void tenantChatCanLoadItsExactSessionAfterRefresh() throws Throwable {
        TenantRequestContext context = new TenantRequestContext(8L, 123L, "OWNER");
        TenantRequestContextHolder.set(context);
        ByaiSessionQo query = new ByaiSessionQo();
        query.setSessionId(456L);
        SessionView session = new SessionView("456", "你好", "h_as", null, null, null,
            "123", "8", "-1");
        when(node.request(eq(context), eq("GET"), eq("/internal/v1/sessions/456"), eq(null), any()))
            .thenReturn(session);

        ResponseUtil<?> result = (ResponseUtil<?>) aspect.route(call("qryConversations", query));

        assertThat(result.getCode()).isZero();
        assertThat(((Page<?>) result.getData()).list()).isEqualTo(java.util.List.of(session));
    }

    @Test
    void projectSessionListUsesTenantNodeWithProjectFilter() throws Throwable {
        TenantRequestContext context = new TenantRequestContext(8L, 123L, "OWNER");
        TenantRequestContextHolder.set(context);
        ProjectSessionQo query = new ProjectSessionQo();
        query.setProjectId(-1L);
        query.setPageNum(1);
        query.setPageSize(5);
        ProceedingJoinPoint call = call(ProjectController.class, "listSessionsByProject", query);
        when(node.request(eq(context), eq("POST"), eq("/internal/v1/sessions/query"), any(), any()))
            .thenReturn(new Page<>(java.util.List.of(), 0L, 1, 5, 0));
        ResponseUtil<?> result = (ResponseUtil<?>) aspect.route(call);
        assertThat(result.getCode()).isZero();
        verify(node).request(eq(context), eq("POST"), eq("/internal/v1/sessions/query"),
            eq(new SessionQuery(1, 5, "", java.util.List.of("h_as", "h_h", "hs_as"), "-1")), any());
    }

    @Test
    void tenantMessageDeleteResolvesOwningSessionAndRecallsViaNode() throws Throwable {
        TenantRequestContextHolder.set(new TenantRequestContext(8L, 123L, "OWNER"));
        SessionOpeartorDto request = new SessionOpeartorDto();
        request.setMessageId("789");
        ProceedingJoinPoint call = call("deleteMessage", request);
        MessageView message = mock(MessageView.class);
        when(message.messageId()).thenReturn("789");
        when(message.sessionId()).thenReturn("456");
        when(node.request(any(), eq("POST"), eq("/internal/v1/assiman/getMessageByIds"), any(), any()))
            .thenReturn(java.util.List.of(message));
        ResponseUtil<?> result = (ResponseUtil<?>) aspect.route(call);
        assertThat(result.getCode()).isZero();
        verify(node).command(any(), eq("POST"), eq("/internal/v1/sessions/456/messages/789/recall"),
            eq("456"), eq("RECALL_MESSAGE"), eq(new MessageId("789")));
    }

    @Test
    void tenantSessionUpdateUsesTheExistingControllerMethodAndNodeCommand() throws Throwable {
        TenantRequestContext context = new TenantRequestContext(8L, 123L, "OWNER");
        TenantRequestContextHolder.set(context);
        SessionOpeartorDto request = new SessionOpeartorDto();
        request.setSessionId(456L);
        request.setSessionName("renamed");
        ProceedingJoinPoint call = call("updateConversation", request);
        ResponseUtil<?> result = (ResponseUtil<?>) aspect.route(call);
        assertThat(result.getCode()).isZero();
        verify(node).command(eq(context), eq("PATCH"), eq("/internal/v1/sessions/456"), eq("456"),
            eq("UPDATE_SESSION"), eq(new SessionUpdate("renamed", null)));
    }

    private ProceedingJoinPoint call(String method, Object arg) throws NoSuchMethodException {
        return call(AssistantManController.class, method, arg);
    }

    private ProceedingJoinPoint call(Class<?> controller, String method, Object arg) throws NoSuchMethodException {
        ProceedingJoinPoint call = mock(ProceedingJoinPoint.class);
        MethodSignature signature = mock(MethodSignature.class);
        when(call.getSignature()).thenReturn(signature);
        when(signature.getMethod()).thenReturn(controller.getMethod(method,
            method.equals("listSessionsByProject") ? ProjectSessionQo.class :
            method.equals("qryConversations") ? ByaiSessionQo.class :
                method.equals("updateConversation") ? SessionOpeartorDto.class :
                method.equals("deleteMessage") ? com.iwhalecloud.byai.state.domain.message.model.SessionOpeartorDto.class
                    : Object.class));
        when(call.getArgs()).thenReturn(new Object[] {arg});
        return call;
    }
}
