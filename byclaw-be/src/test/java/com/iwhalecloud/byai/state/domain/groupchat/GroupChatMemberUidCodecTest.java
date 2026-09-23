package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMemberUidCodec;

class GroupChatMemberUidCodecTest {
    private final GroupChatMemberUidCodec codec = new GroupChatMemberUidCodec();

    @Test
    void roundTripsSupportedMemberTypes() {
        assertThat(codec.decode(codec.encode(AgentMetaEnum.HUMAN, 12L)).orElseThrow().resourceId()).isEqualTo(12L);
        assertThat(codec.decode(codec.encode(AgentMetaEnum.DIG_EMPLOYEE, 34L)).orElseThrow().resourceType())
            .isEqualTo(AgentMetaEnum.DIG_EMPLOYEE);
    }

    @Test
    void rejectsMalformedAndUnsupportedUids() {
        assertThat(codec.decode("AGENT_12")).isEmpty();
        assertThat(codec.decode("HUMAN_0")).isEmpty();
        assertThat(codec.decode("DIG_EMPLOYEE_-1")).isEmpty();
        assertThat(codec.decode("HUMAN_12_extra")).isEmpty();
        assertThatThrownBy(() -> codec.encode(AgentMetaEnum.SKILL, 12L))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
