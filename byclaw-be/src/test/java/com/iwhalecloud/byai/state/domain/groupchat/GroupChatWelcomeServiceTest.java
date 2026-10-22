package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Date;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatWelcomeService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.infrastructure.filter.WebMvcConfiguration;

/** 欢迎资格只授予当前登录成员，已读状态不参与判断。 */
class GroupChatWelcomeServiceTest {
    private final GroupChatAuthorizationService authorization = mock(GroupChatAuthorizationService.class);
    private final ByaiSessionMemberMapper members = mock(ByaiSessionMemberMapper.class);
    private final GroupChatWelcomeService service = new GroupChatWelcomeService(authorization, members);

    @Test
    void grantsOnlyTheWinnerAndPreservesLargeMemberIds() {
        ByaiSessionMember member = member();
        // 入群时初始化的已读游标不代表已看过引导。
        member.setLastReadMessageId(99L);
        member.setLastReadTime(new Date(1000));
        when(authorization.requireCurrentUserMember(30L)).thenReturn(member);
        when(members.claimWelcome(eq(member.getByaiSessionMemberId()), eq(30L), eq(20L), any(Date.class)))
            .thenReturn(1, 0);

        var first = service.claim(30L);
        var nextBrowser = service.claim(30L);

        assertThat(first.isGranted()).isTrue();
        assertThat(first.getSessionId()).isEqualTo("30");
        assertThat(first.getMemberId()).isEqualTo("9007199254740993");
        assertThat(first.getHandledAt()).isPositive();
        assertThat(nextBrowser.isGranted()).isFalse();
        assertThat(nextBrowser.getHandledAt()).isNull();
        assertThat(member.getLastReadMessageId()).isEqualTo(99L);
        assertThat(member.getLastReadTime()).isEqualTo(new Date(1000));
    }

    @Test
    void returnsTheTimestampPersistedByTheWinningRequestEvenInAnEmptyGroup() {
        ByaiSessionMember member = member();
        when(authorization.requireCurrentUserMember(30L)).thenReturn(member);
        when(members.claimWelcome(eq(member.getByaiSessionMemberId()), eq(30L), eq(20L), any(Date.class)))
            .thenReturn(1);

        var response = service.claim(30L);

        ArgumentCaptor<Date> saved = ArgumentCaptor.forClass(Date.class);
        verify(members).claimWelcome(eq(member.getByaiSessionMemberId()), eq(30L), eq(20L), saved.capture());
        assertThat(response.getHandledAt()).isEqualTo(saved.getValue().getTime());
        assertThat(member.getLastReadMessageId()).isNull();
    }

    @Test
    void publicSerializationKeepsTheExistingLongAsStringContract() throws Exception {
        ByaiSessionMember member = member();
        when(authorization.requireCurrentUserMember(30L)).thenReturn(member);
        when(members.claimWelcome(eq(member.getByaiSessionMemberId()), eq(30L), eq(20L), any(Date.class)))
            .thenReturn(1);
        var response = service.claim(30L);
        var mapper = new WebMvcConfiguration().jacksonObjectMapper(new Jackson2ObjectMapperBuilder());

        var json = mapper.readTree(mapper.writeValueAsString(response));

        assertThat(json.get("sessionId").asText()).isEqualTo("30");
        assertThat(json.get("memberId").asText()).isEqualTo("9007199254740993");
        assertThat(json.get("granted").asBoolean()).isTrue();
        assertThat(json.get("handledAt").isTextual()).isTrue();
        assertThat(json.get("handledAt").asText()).isEqualTo(response.getHandledAt().toString());
    }

    @Test
    void rejectsUnauthorizedGroupsBeforeUpdatingMembership() {
        when(authorization.requireCurrentUserMember(30L)).thenThrow(new IllegalStateException("denied"));

        assertThatThrownBy(() -> service.claim(30L)).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(members);
    }

    private ByaiSessionMember member() {
        ByaiSessionMember member = new ByaiSessionMember();
        member.setByaiSessionMemberId(9007199254740993L);
        member.setSessionId(30L);
        member.setMemObjType("USER");
        member.setMemObjId(20L);
        return member;
    }
}
