package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatGatewayCredentialService;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class GroupChatGatewayCredentialServiceTest {
    private final ByaiSessionMemberMapper members = mock(ByaiSessionMemberMapper.class);
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final GroupChatGatewayCredentialService service = new GroupChatGatewayCredentialService(members, node);

    @BeforeEach
    void login() {
        LoginInfo user = new LoginInfo();
        user.setUserId(20L);
        CurrentUserHolder.setLoginInfo(user);
    }

    @AfterEach
    void clear() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void memberCredentialsAreExcludedFromBothPublicJsonSerializers() throws Exception {
        var member = new com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember();
        member.setMemObjId(20L);
        member.setApiKey("private-member-key");
        assertThat(com.alibaba.fastjson.JSON.toJSONString(member)).doesNotContain("private-member-key");
        assertThat(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(member))
            .doesNotContain("private-member-key");
        assertThat(member.getApiKey()).isEqualTo("private-member-key");
    }

    @Test
    void usesCurrentUserAndOriginalGroupForBothDispatchAndContinuation() {
        when(members.findActiveUserApiKey(30L, 20L)).thenReturn("active-member-key");
        for (long childSessionId : new long[] {50L, 60L}) {
            ChatProcessContext context = context(childSessionId);
            context.groupSessionId = 30L;
            // A caller-controlled initiator hint must not change the credential owner.
            context.assistantChatDto.setExtParams(Map.of("initiatorUserId", 99L));
            Map<String, Object> params = new HashMap<>(Map.of("api_key", "untrusted-key"));
            service.apply(context, params);
            assertThat(params).containsEntry("api_key", "active-member-key");
            assertThat(context.assistantChatDto.getExtParams()).doesNotContainKey("api_key");
        }
        verifyNoInteractions(node);
    }

    @Test
    void ordinarySameSessionReferenceDoesNotAuthorizeACredentialRead() {
        Map<String, Object> params = new HashMap<>(Map.of("groupChat", Map.of("conversationKey", "30"), "api_key", "untrusted"));
        service.apply(context(50L), params);
        assertThat(params).doesNotContainKey("api_key");
        verifyNoInteractions(members, node);
    }

    @Test
    void absentOrBlankMembershipKeyDoesNotPassAStaleKey() {
        ChatProcessContext context = context(50L);
        context.groupSessionId = 30L;
        when(members.findActiveUserApiKey(30L, 20L)).thenReturn(null, "  ");
        for (int attempt = 0; attempt < 2; attempt++) {
            Map<String, Object> params = new HashMap<>(Map.of("api_key", "stale"));
            service.apply(context, params);
            assertThat(params).doesNotContainKey("api_key");
        }
    }

    @Test
    void tenantCredentialComesFromTheTenantNodeInsteadOfThePlatformTable() {
        ChatProcessContext context = context(50L);
        context.groupSessionId = 30L;
        context.tenantContext = new TenantRequestContext(20L, 10L, "MEMBER");
        when(node.request(eq(context.tenantContext), eq("GET"), eq("/internal/v1/group-chats/30/member-api-key"),
            eq(null), any())).thenReturn(Map.of("api_key", "tenant-key"));
        Map<String, Object> params = new HashMap<>();
        service.apply(context, params);
        assertThat(params).containsEntry("api_key", "tenant-key");
        verifyNoInteractions(members);
    }

    @Test
    void missingOrDifferentAuthenticatedUserCannotReadATenantCredential() {
        ChatProcessContext context = context(50L);
        context.groupSessionId = 30L;
        context.tenantContext = new TenantRequestContext(99L, 10L, "MEMBER");
        assertThatThrownBy(() -> service.apply(context, new HashMap<>())).isInstanceOf(IllegalStateException.class);
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> service.apply(context, new HashMap<>())).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(members, node);
    }

    private ChatProcessContext context(long childSessionId) {
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        context.sessionId = childSessionId;
        return context;
    }
}
