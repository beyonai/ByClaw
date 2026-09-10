package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatContextTokenService;

class GroupChatContextTokenServiceTest {

    @Test
    void issueBindsParentGroupChildSessionAndHistoryBoundary() {
        JwtService jwtService = mock(JwtService.class);
        when(jwtService.createJwt(any(), eq(5L), eq(TimeUnit.MINUTES))).thenReturn("signed-context-token");
        GroupChatContextTokenService tokenService = new GroupChatContextTokenService(jwtService);

        assertThat(tokenService.issue(10L, 60L, 30L, 40L, 20L)).isEqualTo("signed-context-token");

        ArgumentCaptor<Object> claimsCaptor = ArgumentCaptor.forClass(Object.class);
        verify(jwtService).createJwt(claimsCaptor.capture(), eq(5L), eq(TimeUnit.MINUTES));
        @SuppressWarnings("unchecked")
        Map<String, Object> claims = (Map<String, Object>) claimsCaptor.getValue();
        assertThat(claims)
            .containsEntry("scene", "GROUP_CHAT_CONTEXT")
            .containsEntry("groupSessionId", 10L)
            .containsEntry("childSessionId", 60L)
            .containsEntry("initiatorUserId", 30L)
            .containsEntry("targetAgentId", 40L)
            .containsEntry("boundaryMessageId", 20L);
    }
}
