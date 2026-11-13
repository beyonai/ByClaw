package com.iwhalecloud.byai.state.domain.groupchat.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.manager.domain.tenant.TenantModeService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatResponseMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMessageRejectedException;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/** 公开状态与私有绑定的授权回归；创建者 Codex，2026-11-13。 */
class GroupChatResponseQueryServiceTest {
    @Test
    void memberCanResolveStatusButOnlyInitiatorCanResolveBinding() {
        var mapper = mock(ByaiGroupChatResponseMapper.class);
        var authorization = mock(GroupChatAuthorizationService.class);
        var sessions = mock(SessionService.class);
        var modes = mock(TenantModeService.class);
        var service = new GroupChatResponseQueryService();
        ReflectionTestUtils.setField(service, "responseMapper", mapper);
        ReflectionTestUtils.setField(service, "authorizationService", authorization);
        ReflectionTestUtils.setField(service, "sessionService", sessions);
        ReflectionTestUtils.setField(service, "tenantModeService", modes);
        var group = new ByaiSession();
        group.setEnterpriseId(10L);
        when(sessions.findById(30L)).thenReturn(group);
        when(modes.isSharedDataTenant(10L)).thenReturn(true);
        when(modes.isSharedDataTenant(11L)).thenReturn(true);
        when(mapper.selectResponses(eq(30L), anyString(), anyInt(), any())).thenReturn(List.of(Map.of(
            "responseId", "turn:60", "groupSessionId", 30L, "sourceMessageId", 40L,
            "targetAgentId", 42L, "initiatorUserId", 20L, "status", "RUNNING", "traceId", "private", "candidateSessionId", 50L)));
        var tenant = new TenantRequestContext(21L, 10L, "MEMBER");
        var result = service.resolveFor(30L, List.of("turn:60"), 21L, tenant);
        assertEquals(false, result.getJSONArray("items").getJSONObject(0).getBoolean("canReadContent"));
        assertEquals(null, result.getJSONArray("items").getJSONObject(0).get("stream"));
        var snapshots = mock(com.iwhalecloud.byai.state.domain.chat.service.RunningChatSnapshotService.class);
        ReflectionTestUtils.setField(service, "snapshotService", snapshots);
        var snapshot = new com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse();
        snapshot.setRunning(true);
        snapshot.setCreatorId(20L);
        snapshot.setSessionId(50L);
        snapshot.setTraceId("private");
        snapshot.setModelAnswerMessageId(70L);
        snapshot.setSnapshotStreamId("3-0");
        snapshot.setMessageStruct("[{\"contentType\":\"1002\"}]");
        snapshot.setInferLog("[{\"contentType\":\"tool\"}]");
        when(snapshots.get(50L, "private", null)).thenReturn(snapshot);
        var own = service.resolveFor(30L, List.of("turn:60"), 20L, new TenantRequestContext(20L, 10L, "MEMBER"));
        assertEquals("private", own.getJSONArray("items").getJSONObject(0).getJSONObject("stream").getString("traceId"));
        assertEquals("50", own.getJSONArray("items").getJSONObject(0).getJSONObject("stream").getString("sessionId"));
        var stream = own.getJSONArray("items").getJSONObject(0).getJSONObject("stream");
        assertEquals(snapshot.getMessageStruct(), stream.getString("messageStruct"));
        assertEquals(snapshot.getInferLog(), stream.getString("inferLog"));
        assertEquals(false, stream.containsKey("text"));
        assertThrows(GroupChatMessageRejectedException.class,
            () -> service.resolveFor(30L, List.of("turn:60"), 21L, new TenantRequestContext(21L, 11L, "MEMBER")));
        assertThrows(GroupChatMessageRejectedException.class,
            () -> service.resolveFor(30L, List.of("turn:60"), 20L, tenant));
    }
}
