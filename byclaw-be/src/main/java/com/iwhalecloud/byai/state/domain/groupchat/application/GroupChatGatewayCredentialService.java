package com.iwhalecloud.byai.state.domain.groupchat.application;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/** 群聊凭据只在服务端确认原群与当前用户后加入 Gateway 出站参数。 */
@Service
@RequiredArgsConstructor
public class GroupChatGatewayCredentialService {
    private static final Logger LOG = LoggerFactory.getLogger(GroupChatGatewayCredentialService.class);
    private final ByaiSessionMemberMapper members;
    private final TenantNodeClient tenantNode;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public void apply(ChatProcessContext context, Map<String, Object> gatewayParams) {
        // 不保留普通参数或其他装饰器夹带的密钥；每轮按当前有效成员关系重新读取。
        gatewayParams.remove("api_key");
        if (context.groupSessionId == null) return;
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null) throw new IllegalStateException("Group Gateway credentials require an authenticated user");
        Long memberId;
        if (context.tenantContext == null) {
            memberId = members.findActiveUserMemberId(context.groupSessionId, userId);
        }
        else {
            if (!Objects.equals(userId, context.tenantContext.userId())) {
                throw new IllegalStateException("Group Gateway credential actor does not match the tenant context");
            }
            // 租户成员身份从所属 Node 获取，不能借用平台表或客户端提供的成员主键。
            Map<String, String> identity = tenantNode.request(context.tenantContext, "GET",
                "/internal/v1/group-chats/" + context.groupSessionId + "/member-api-key?identityOnly=true", null,
                new TypeReference<Map<String, String>>() { });
            String id = identity == null ? null : identity.get("byaiSessionMemberId");
            memberId = StringUtils.isBlank(id) ? null : Long.valueOf(id);
        }
        String apiKey = cachedApiKey(memberId);
        if (StringUtils.isBlank(apiKey)) {
            if (context.tenantContext == null) {
                apiKey = members.findActiveUserApiKey(context.groupSessionId, userId);
            }
            else {
                Map<String, String> response = tenantNode.request(context.tenantContext, "GET",
                    "/internal/v1/group-chats/" + context.groupSessionId + "/member-api-key", null,
                    new TypeReference<Map<String, String>>() { });
                apiKey = response == null ? null : response.get("api_key");
            }
        }
        if (StringUtils.isNotBlank(apiKey)) gatewayParams.put("api_key", apiKey);
    }

    /** 按 HACU 的共享映射契约读取凭据；单键 GET 复用配置好的单机或集群连接。 */
    private String cachedApiKey(Long memberId) {
        if (memberId == null || memberId <= 0) return null;
        try {
            String cached = redis.opsForValue().get("hacu:tokensaver:binding:v1:API_KEY:" + memberId);
            if (StringUtils.isBlank(cached)) return null;
            JsonNode binding = objectMapper.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .readTree(cached);
            if (binding == null || !binding.isObject()
                || !"API_KEY".equals(binding.path("resourceType").asText())
                || !memberId.toString().equals(binding.path("resourceId").asText())) return null;
            // HACU 将 TokenSaver 返回的 key 保存为 tokenSaverCode；Gateway 出站字段仍为 api_key。
            JsonNode apiKey = binding.path("tokenSaverCode");
            return apiKey.isTextual() && StringUtils.isNotBlank(apiKey.textValue()) ? apiKey.textValue() : null;
        }
        catch (Exception failure) {
            // JSON 解析异常可能包含密钥原文，日志只记录成员标识和异常类型。
            LOG.warn("Group credential cache unavailable; memberId={}, failureType={}", memberId,
                failure.getClass().getSimpleName());
            return null;
        }
    }
}
