package com.iwhalecloud.byai.state.domain.groupchat.application;

import com.fasterxml.jackson.core.type.TypeReference;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/** 群聊凭据只在服务端确认原群与当前用户后加入 Gateway 出站参数。 */
@Service
@RequiredArgsConstructor
public class GroupChatGatewayCredentialService {
    private final ByaiSessionMemberMapper members;
    private final TenantNodeClient tenantNode;

    public void apply(ChatProcessContext context, Map<String, Object> gatewayParams) {
        // 不保留普通参数或其他装饰器夹带的密钥；每轮按当前有效成员关系重新读取。
        gatewayParams.remove("api_key");
        if (context.groupSessionId == null) return;
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null) throw new IllegalStateException("Group Gateway credentials require an authenticated user");
        String apiKey;
        if (context.tenantContext == null) {
            apiKey = members.findActiveUserApiKey(context.groupSessionId, userId);
        }
        else {
            if (!Objects.equals(userId, context.tenantContext.userId())) {
                throw new IllegalStateException("Group Gateway credential actor does not match the tenant context");
            }
            Map<String, String> response = tenantNode.request(context.tenantContext, "GET",
                "/internal/v1/group-chats/" + context.groupSessionId + "/member-api-key", null,
                new TypeReference<Map<String, String>>() { });
            apiKey = response == null ? null : response.get("api_key");
        }
        if (StringUtils.isNotBlank(apiKey)) gatewayParams.put("api_key", apiKey);
    }
}
