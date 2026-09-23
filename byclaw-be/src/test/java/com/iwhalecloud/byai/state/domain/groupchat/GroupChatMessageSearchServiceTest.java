package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Date;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMessageSearchService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMessageSearchRequest;

class GroupChatMessageSearchServiceTest {
    private final ByaiMessageMapper mapper = mock(ByaiMessageMapper.class);
    private final GroupChatAuthorizationService authorization = mock(GroupChatAuthorizationService.class);
    private final GroupChatContextService context = mock(GroupChatContextService.class);
    private final GroupChatMessageSearchService service = new GroupChatMessageSearchService(mapper, authorization, context);

    @BeforeEach
    void setUp() {
        LoginInfo login = new LoginInfo();
        login.setUserId(30L);
        CurrentUserHolder.setLoginInfo(login);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void escapesLiteralKeywordAndUsesStructuredMentionScope() {
        GroupChatMessageSearchRequest request = new GroupChatMessageSearchRequest();
        request.setKeyword("  50%_\\done  ");
        request.setScope("MENTIONED_ME");
        request.setSenderType("AGENT");
        request.setLimit(20);
        when(mapper.searchVisibleGroupMessages(eq(10L), eq("50\\%\\_\\\\done"), eq("MENTIONED_ME"),
            eq("AGENT"), eq(30L), isNull(), isNull(), isNull(), eq(21))).thenReturn(List.of());

        assertThat(service.search(10L, request).isHasMore()).isFalse();

        verify(authorization).requireCurrentUserMember(10L);
        verify(mapper).searchVisibleGroupMessages(10L, "50\\%\\_\\\\done", "MENTIONED_ME", "AGENT", 30L,
            null, null, null, 21);
    }

    @Test
    void returnsStableCursorAndCapsPageSize() {
        GroupChatMessageSearchRequest request = new GroupChatMessageSearchRequest();
        request.setLimit(1000);
        request.setStartTime(100L);
        request.setEndTime(200L);
        List<ByaiMessage> rows = java.util.stream.LongStream.rangeClosed(50, 100)
            .mapToObj(id -> {
                ByaiMessage message = new ByaiMessage();
                message.setMessageId(id);
                return message;
            }).toList();
        when(mapper.searchVisibleGroupMessages(eq(10L), isNull(), eq("ALL"), eq("ALL"), eq(30L),
            any(Date.class), any(Date.class), isNull(), eq(51))).thenReturn(rows);
        when(context.toMessages(any())).thenReturn(List.of());

        var response = service.search(10L, request);

        assertThat(response.isHasMore()).isTrue();
        assertThat(response.getNextBeforeMessageId()).isEqualTo("99");
    }

    @Test
    void rejectsTargetOutsideVisibleMessages() {
        when(mapper.selectVisibleGroupMessage(10L, 99L)).thenReturn(null);

        assertThatThrownBy(() -> service.around(10L, 99L))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("Group message not found");
        verify(authorization).requireCurrentUserMember(10L);
    }
}
