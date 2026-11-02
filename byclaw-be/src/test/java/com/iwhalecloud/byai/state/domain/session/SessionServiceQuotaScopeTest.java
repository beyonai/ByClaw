package com.iwhalecloud.byai.state.domain.session;

import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.session.dto.SessionMembersDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Generic chat input must not impersonate the group creation or immutable ownership boundary. */
class SessionServiceQuotaScopeTest {
    @Test void rejectsClientSuppliedBusinessOwnershipBeforePersistingSession() {
        var sessions = new SessionService();
        var mapper = mock(ByaiSessionMapper.class);
        ReflectionTestUtils.setField(sessions, "byaiSessionMapper", mapper);
        var request = new SessionMembersDto(); request.setSessionType("h_as");
        var marker = new ByaiSessionExt(); marker.setExtParamCode(GroupChatApplicationService.BUSINESS_ENTERPRISE_EXT);
        marker.setExtParamValue("NONE"); request.setSessionExts(List.of(marker));
        assertThrows(IllegalArgumentException.class, () -> sessions.createSessionMembers(request));
        verifyNoInteractions(mapper);
    }

    @Test void genericSessionCannotInsertMembersIntoADifferentExistingGroup() {
        var sessions = new SessionService();
        var mapper = mock(ByaiSessionMapper.class);
        ReflectionTestUtils.setField(sessions, "byaiSessionMapper", mapper);
        var request = new SessionMembersDto(); request.setSessionId(10L); request.setSessionType("h_as");
        var injected = new com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember();
        injected.setSessionId(99L); injected.setMemObjType("AGENT"); injected.setMemObjId(100L);
        request.setMembers(List.of(injected));
        assertThrows(IllegalArgumentException.class, () -> sessions.createSessionMembers(request));
        verifyNoInteractions(mapper);
    }

    @Test void genericChatFallbackCannotCreateAGroupOutsideQuotaAdmission() {
        var sessions = new SessionService();
        var mapper = mock(ByaiSessionMapper.class);
        ReflectionTestUtils.setField(sessions, "byaiSessionMapper", mapper);
        var request = new SessionMembersDto(); request.setSessionType("hs_as");
        assertThrows(IllegalArgumentException.class, () -> sessions.createSessionMembers(request));
        verifyNoInteractions(mapper);
    }
}
