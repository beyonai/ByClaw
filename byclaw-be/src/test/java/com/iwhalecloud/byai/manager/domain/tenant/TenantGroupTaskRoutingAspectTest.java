package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskDeliveryService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskDeliveryResponse;
import java.lang.reflect.Method;
import java.util.Map;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class TenantGroupTaskRoutingAspectTest {
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final ByaiGroupChatTaskMapper legacyTasks = mock(ByaiGroupChatTaskMapper.class);
    private final ByaiGroupChatMentionMapper legacyMembership = mock(ByaiGroupChatMentionMapper.class);
    private final GroupChatTaskDeliveryService delivery = mock(GroupChatTaskDeliveryService.class);
    private final TenantGroupTaskRoutingAspect aspect = new TenantGroupTaskRoutingAspect(node, legacyTasks,
        legacyMembership, delivery);
    private final TenantRequestContext tenant = new TenantRequestContext(57L, 11222473L, "MEMBER");

    @AfterEach
    void clear() {
        TenantRequestContextHolder.clear();
    }

    @Test
    void tenantPendingReadsNodeInsteadOfPlatformTaskTable() throws Throwable {
        TenantRequestContextHolder.set(tenant);
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/group-chat/tasks/33/pending-publication"),
            eq(null), any())).thenReturn(Map.of("taskId", "33"));

        ResponseUtil<?> response = (ResponseUtil<?>) aspect.route(call("pending", 33L));

        assertThat(response.getData()).isEqualTo(Map.of("taskId", "33"));
    }

    @Test
    void tenantDeliveryAuthorizesWithNodeBeforeReadingSignal() throws Throwable {
        TenantRequestContextHolder.set(tenant);
        when(delivery.currentAuthorized(33L)).thenReturn(new GroupChatTaskDeliveryResponse("33", false));

        ResponseUtil<?> response = (ResponseUtil<?>) aspect.route(call("deliveryStatus", 33L));

        verify(node).request(eq(tenant), eq("GET"), eq("/internal/v1/group-chat/tasks/33"),
            eq(null), any());
        assertThat(response.getData()).isEqualTo(new GroupChatTaskDeliveryResponse("33", false));
    }

    @Test
    void legacyTaskIdsStillAuthorizeAndReadThroughTheTenantNode() throws Throwable {
        TenantRequestContextHolder.set(tenant);
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setGroupSessionId(11222539L);
        when(legacyTasks.selectById(42L)).thenReturn(task);
        when(legacyMembership.isLegacyGroupMember(11222539L, 57L, 11222473L)).thenReturn(true);
        ProceedingJoinPoint call = call("pending", 42L);
        Map<String, Object> pending = Map.of("taskId", "42");
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/group-chat/tasks/42/pending-publication"),
            eq(null), any())).thenReturn(pending);

        ResponseUtil<?> response = (ResponseUtil<?>) aspect.route(call);
        assertThat(response.getData()).isEqualTo(pending);
        verify(call, never()).proceed();
        verifyNoInteractions(legacyTasks, legacyMembership);
    }

    private ProceedingJoinPoint call(String method, Long taskId) throws Exception {
        ProceedingJoinPoint call = mock(ProceedingJoinPoint.class);
        MethodSignature signature = mock(MethodSignature.class);
        Method source = MethodNames.class.getDeclaredMethod(method, Long.class);
        when(signature.getMethod()).thenReturn(source);
        when(call.getSignature()).thenReturn(signature);
        when(call.getArgs()).thenReturn(new Object[] { taskId });
        return call;
    }

    private static class MethodNames {
        void pending(Long taskId) { }
        void deliveryStatus(Long taskId) { }
    }
}
