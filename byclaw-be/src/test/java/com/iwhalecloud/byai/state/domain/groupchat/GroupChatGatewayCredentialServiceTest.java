package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

class GroupChatGatewayCredentialServiceTest {
    private final ByaiSessionMemberMapper members = mock(ByaiSessionMemberMapper.class);
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> values = mock(ValueOperations.class);
    private final GroupChatGatewayCredentialService service = new GroupChatGatewayCredentialService(
        members, node, redis, new ObjectMapper());

    @BeforeEach
    void login() {
        LoginInfo user = new LoginInfo();
        user.setUserId(20L);
        CurrentUserHolder.setLoginInfo(user);
        when(redis.opsForValue()).thenReturn(values);
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

    /** Redis 命中时不读取成员表的旧密钥，派发和子会话续聊使用相同归属群。 */
    @Test
    void prefersTheRedisKeyForTheAuthenticatedActiveMembership() {
        when(members.findActiveUserMemberId(30L, 20L)).thenReturn(80L);
        when(values.get("hacu:tokensaver:binding:v1:API_KEY:80")).thenReturn("""
            {"id":"9007199254740993","resourceId":"80","resourceType":"API_KEY","tokenSaverId":null,
             "tokenSaverCode":"redis-member-key","tokenSaverName":"group-member","tokenSaverExt":null}
            """);
        for (long childSessionId : new long[] {50L, 60L}) {
            ChatProcessContext context = context(childSessionId);
            context.groupSessionId = 30L;
            context.assistantChatDto.setExtParams(Map.of("byaiSessionMemberId", 99L, "initiatorUserId", 99L));
            Map<String, Object> params = new HashMap<>(Map.of("api_key", "untrusted-key"));
            service.apply(context, params);
            assertThat(params).containsEntry("api_key", "redis-member-key");
        }
        verify(members, never()).findActiveUserApiKey(any(), any());
        verifyNoInteractions(node);
    }

    /** 缺失、空白正文、错误归属和损坏缓存均使用原成员表凭据。 */
    @Test
    void fallsBackToTheMembershipTableWhenTheCacheHasNoUsableKey() {
        when(members.findActiveUserMemberId(30L, 20L)).thenReturn(80L);
        when(members.findActiveUserApiKey(30L, 20L)).thenReturn("database-member-key");
        for (String cached : new String[] {null, "", "not-json", "null", "[]",
            "{\"resourceId\":\"80\",\"resourceType\":\"API_KEY\",\"tokenSaverCode\":null,\"tokenSaverExt\":null}",
            "{\"resourceId\":\"80\",\"resourceType\":\"API_KEY\",\"api_key\":\"unused-field\"}",
            "{\"resourceId\":\"80\",\"resourceType\":\"API_KEY\",\"tokenSaverCode\":\"  \"}",
            "{\"resourceId\":\"99\",\"resourceType\":\"API_KEY\",\"tokenSaverCode\":\"other-member-key\"}",
            "{\"resourceId\":\"80\",\"resourceType\":\"MEMBER\",\"tokenSaverCode\":\"wrong-type-key\"}",
            "{\"resourceId\":\"80\",\"resourceType\":\"API_KEY\",\"tokenSaverCode\":123}"}) {
            when(values.get("hacu:tokensaver:binding:v1:API_KEY:80")).thenReturn(cached);
            ChatProcessContext context = context(50L);
            context.groupSessionId = 30L;
            Map<String, Object> params = new HashMap<>();
            service.apply(context, params);
            assertThat(params).containsEntry("api_key", "database-member-key");
        }
    }

    /** Redis 暂时不可用时继续读取原成员表，而不是使用上轮或客户端密钥。 */
    @Test
    void fallsBackToTheMembershipTableWhenRedisFails() {
        when(members.findActiveUserMemberId(30L, 20L)).thenReturn(80L);
        when(values.get("hacu:tokensaver:binding:v1:API_KEY:80"))
            .thenThrow(new org.springframework.data.redis.RedisConnectionFailureException("unavailable"));
        when(members.findActiveUserApiKey(30L, 20L)).thenReturn("database-member-key");
        ChatProcessContext context = context(50L);
        context.groupSessionId = 30L;
        Map<String, Object> params = new HashMap<>(Map.of("api_key", "stale-key"));
        service.apply(context, params);
        assertThat(params).containsEntry("api_key", "database-member-key");
    }

    /** 退群后不能因 Redis 仍有旧成员缓存而恢复该成员凭据。 */
    @Test
    void neverReadsRedisWithoutAnActiveMembershipId() {
        when(members.findActiveUserMemberId(30L, 20L)).thenReturn(null);
        ChatProcessContext context = context(50L);
        context.groupSessionId = 30L;
        Map<String, Object> params = new HashMap<>(Map.of("api_key", "stale-key"));
        service.apply(context, params);
        assertThat(params).doesNotContainKey("api_key");
        verifyNoInteractions(values);
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
        when(node.request(eq(context.tenantContext), eq("GET"),
            eq("/internal/v1/group-chats/30/member-api-key?identityOnly=true"), eq(null), any()))
            .thenReturn(Map.of("byaiSessionMemberId", "81"));
        when(node.request(eq(context.tenantContext), eq("GET"), eq("/internal/v1/group-chats/30/member-api-key"),
            eq(null), any())).thenReturn(Map.of("api_key", "tenant-key"));
        Map<String, Object> params = new HashMap<>();
        service.apply(context, params);
        assertThat(params).containsEntry("api_key", "tenant-key");
        verifyNoInteractions(members);
    }

    /** 租户成员主键取 Node 内部校验结果；缓存命中不再请求数据库密钥。 */
    @Test
    void prefersRedisForATenantMembershipVerifiedByItsNode() {
        ChatProcessContext context = context(50L);
        context.groupSessionId = 30L;
        context.tenantContext = new TenantRequestContext(20L, 10L, "MEMBER");
        when(node.request(eq(context.tenantContext), eq("GET"),
            eq("/internal/v1/group-chats/30/member-api-key?identityOnly=true"), eq(null), any()))
            .thenReturn(Map.of("byaiSessionMemberId", "81", "api_key", ""));
        when(values.get("hacu:tokensaver:binding:v1:API_KEY:81")).thenReturn("""
            {"id":"9007199254740994","resourceId":"81","resourceType":"API_KEY","tokenSaverId":null,
             "tokenSaverCode":"tenant-redis-key","tokenSaverName":"tenant-member","tokenSaverExt":null}
            """);
        Map<String, Object> params = new HashMap<>();
        service.apply(context, params);
        assertThat(params).containsEntry("api_key", "tenant-redis-key");
        verify(node, never()).request(any(), any(), eq("/internal/v1/group-chats/30/member-api-key"), any(), any());
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
