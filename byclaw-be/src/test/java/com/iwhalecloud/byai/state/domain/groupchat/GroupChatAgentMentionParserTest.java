package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatAgentMention;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMemberUidCodec;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatAgentMentionParser;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;

class GroupChatAgentMentionParserTest {
    private SessionMemberService memberService;
    private UserService userService;
    private SsResourceService resourceService;
    private GroupChatAgentMentionParser parser;

    @BeforeEach
    void setUp() {
        memberService = mock(SessionMemberService.class);
        userService = mock(UserService.class);
        resourceService = mock(SsResourceService.class);
        parser = new GroupChatAgentMentionParser(memberService, userService, resourceService,
            new GroupChatMemberUidCodec());
        when(memberService.findSessionMembers(1L, null, null)).thenReturn(List.of(
            member(MemObjType.USER.name(), 10L), member(MemObjType.AGENT.name(), 20L),
            member(MemObjType.AGENT.name(), 30L)));
        Users user = new Users();
        user.setUserName("真实用户");
        when(userService.findById(10L)).thenReturn(user);
        SsResource agent = mock(SsResource.class);
        when(agent.getResourceName()).thenReturn("真实智能体");
        when(resourceService.findById(30L)).thenReturn(agent);
    }

    @Test
    void normalizesMultipleMentionsDeduplicatesAndUsesAuthoritativeNames() {
        GroupChatAgentMention result = parser.parse(1L, 20L,
            "请 [@伪造名](uid?=HUMAN_10) 和 [@智能体](uid?=DIG_EMPLOYEE_30)，再次 [@他](uid?=DIG_EMPLOYEE_30)");

        assertThat(result.normalizedContent()).isEqualTo("请 {{HUMAN_10}} 和 {{DIG_EMPLOYEE_30}}，再次 {{DIG_EMPLOYEE_30}}");
        assertThat(result.resourceList()).extracting("resourceName").containsExactly("真实用户", "真实智能体");
    }

    @Test
    void leavesMalformedNonMemberAndSelfMentionsAsOrdinaryText() {
        String content = "[@旧协议](uid?HUMAN_10) [@外部](uid?=HUMAN_99) [@自己](uid?=DIG_EMPLOYEE_20)";
        GroupChatAgentMention result = parser.parse(1L, 20L, content);

        assertThat(result.normalizedContent()).isEqualTo(content);
        assertThat(result.resourceList()).isEmpty();
    }

    @Test
    void ignoresInvalidRosterRowsWithoutRejectingValidMentions() {
        when(memberService.findSessionMembers(1L, null, null)).thenReturn(List.of(
            member(MemObjType.USER.name(), 0L), member(MemObjType.USER.name(), 10L)));

        GroupChatAgentMention result = parser.parse(1L, 20L, "[@用户](uid?=HUMAN_10)");

        assertThat(result.normalizedContent()).isEqualTo("{{HUMAN_10}}");
        assertThat(result.resourceList()).hasSize(1);
    }

    private ByaiSessionMember member(String type, Long id) {
        ByaiSessionMember member = new ByaiSessionMember();
        member.setMemObjType(type);
        member.setMemObjId(id);
        return member;
    }
}
