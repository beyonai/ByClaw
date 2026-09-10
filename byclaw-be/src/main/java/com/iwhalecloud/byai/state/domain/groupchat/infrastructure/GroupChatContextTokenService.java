package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.jwt.JwtService;

/** 为 Agent 上下文签发绑定群、发起者、目标和历史边界的短时令牌。 */
@Service
public class GroupChatContextTokenService {
    private final JwtService jwtService;

    public GroupChatContextTokenService(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    public String issue(Long groupSessionId, Long childSessionId, Long initiatorUserId, Long targetAgentId,
        Long boundaryMessageId) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("scene", "GROUP_CHAT_CONTEXT");
        claims.put("groupSessionId", groupSessionId);
        claims.put("childSessionId", childSessionId);
        claims.put("initiatorUserId", initiatorUserId);
        claims.put("targetAgentId", targetAgentId);
        claims.put("boundaryMessageId", boundaryMessageId);
        return jwtService.createJwt(claims, 5, TimeUnit.MINUTES);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> verify(String token) {
        Map<String, Object> claims = jwtService.verifyJwt(token, Map.class);
        if (claims == null || !"GROUP_CHAT_CONTEXT".equals(claims.get("scene"))) {
            throw new IllegalArgumentException("Invalid group chat context token");
        }
        return claims;
    }
}
