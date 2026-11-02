package com.iwhalecloud.byai.common.hook;

import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.MemberJoinedHook;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class MemberJoinedHookTest {
    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"null", "0", "-1", " ", "invalid"})
    void neverPublishesMissingOrInvalidMemberRecordId(String memberId) {
        var publisher = mock(HookPublisher.class);
        var hooks = new MemberJoinedHook(publisher);
        assertThatThrownBy(() -> hooks.memberJoined("30", 10L, "20", "40", memberId))
            .isInstanceOf(IllegalStateException.class).hasMessage("groupchat.member.id.unconfirmed");
        verifyNoInteractions(publisher);
    }
}
