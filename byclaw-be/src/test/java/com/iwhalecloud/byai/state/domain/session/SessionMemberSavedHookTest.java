package com.iwhalecloud.byai.state.domain.session;

import com.iwhalecloud.byai.common.hook.HookPublisher;
import com.iwhalecloud.byai.common.quota.SharedQuotaAdmission;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.MemberJoinedHook;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class SessionMemberSavedHookTest {
    private final SessionMemberService service = new SessionMemberService();
    private final ByaiSessionMemberMapper mapper = mock(ByaiSessionMemberMapper.class);
    private final SharedQuotaAdmission quota = mock(SharedQuotaAdmission.class);
    private final HookPublisher publisher = mock(HookPublisher.class);

    @BeforeEach void setup() {
        ReflectionTestUtils.setField(service, "byaiSessionMemberMapper", mapper);
        ReflectionTestUtils.setField(service, "quotaAdmission", quota);
        ReflectionTestUtils.setField(service, "memberJoinedHook", new MemberJoinedHook(publisher));
        when(quota.admitPersistedGroupMember(any(), any(), any())).thenReturn(true);
        when(mapper.insert(any(ByaiSessionMember.class))).thenAnswer(call -> {
            verifyNoInteractions(publisher);
            return 1;
        });
    }

    @Test void genericSavePublishesTheExactInsertedRowWithoutInvitationContext() {
        var member = row(9007199254740995L, "USER");
        assertThat(service.save(member)).isEqualTo(1);
        verify(publisher).publish(eq("workgroup.member.joined"), eq(1), argThat(data ->
            "9007199254740995".equals(data.get("byaiSessionMemberId"))
                && "20".equals(data.get("userId")) && "30".equals(data.get("groupId"))
                && !data.containsKey("projectId")
                && "10".equals(data.get("enterpriseId")) && "40".equals(data.get("invitedBy"))));
    }

    @Test void batchIncludingInitialOwnerPublishesOnceForEachSavedHuman() {
        when(mapper.insert(any(ByaiSessionMember.class))).thenReturn(1);
        var owner = row(101L, "USER"); owner.setUserRole("OWNER");
        assertThat(service.batchSave(List.of(owner, row(102L, "USER"), row(103L, "AGENT")))).isEqualTo(3);
        verify(publisher, times(2)).publish(eq("workgroup.member.joined"), eq(1), anyMap());
        verify(publisher).publish(anyString(), anyInt(), argThat(data -> "101".equals(data.get("byaiSessionMemberId"))));
        verify(publisher).publish(anyString(), anyInt(), argThat(data -> "102".equals(data.get("byaiSessionMemberId"))));
    }

    @Test void skippedOrFailedInsertsAndAgentsNeverPublish() {
        when(quota.admitPersistedGroupMember(any(), any(), any())).thenReturn(false);
        assertThat(service.save(row(101L, "USER"))).isZero();
        verifyNoInteractions(mapper, publisher);
        when(quota.admitPersistedGroupMember(any(), any(), any())).thenReturn(true);
        when(mapper.insert(any(ByaiSessionMember.class))).thenReturn(0);
        assertThat(service.save(row(102L, "USER"))).isZero();
        when(mapper.insert(any(ByaiSessionMember.class))).thenThrow(new IllegalStateException("write failed"));
        assertThatThrownBy(() -> service.save(row(103L, "USER"))).hasMessage("write failed");
        doReturn(1).when(mapper).insert(any(ByaiSessionMember.class));
        assertThat(service.save(row(104L, "AGENT"))).isEqualTo(1);
        verifyNoInteractions(publisher);
    }

    private ByaiSessionMember row(long id, String type) {
        var member = new ByaiSessionMember();
        member.setByaiSessionMemberId(id); member.setSessionId(30L);
        member.setComAcctId(10L); member.setMemObjType(type);
        member.setMemObjId(20L); member.setCreatorId(40L);
        return member;
    }
}
