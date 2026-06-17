package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;

class SandboxCronPrewarmUserProviderTest {

    private final UserService userService = mock(UserService.class);

    private final SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);

    private final SandboxCronPrewarmCursorStore cursorStore = mock(SandboxCronPrewarmCursorStore.class);

    @Test
    void listUsersQueriesCandidatesAfterCursorAndAdvancesCursorAfterScan() {
        SandboxCronPrewarmProperties properties = new SandboxCronPrewarmProperties();
        properties.setMaxUsersPerRun(50);
        SandboxCronPrewarmUserProvider provider = new SandboxCronPrewarmUserProvider(properties, userService,
            sandboxRecordMapper, cursorStore);
        when(cursorStore.getCursor(anyString())).thenReturn(10L);
        when(userService.listCronPrewarmCandidateUsers(eq(UserState.ACTIVE), any(Date.class), eq(10L),
            eq(SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE), eq(SandboxLaunchRouting.DEFAULT_RESOURCE_ID), eq(50)))
                .thenReturn(List.of(user(11L, "alice"), user(12L, "bob")));

        Instant lowerBound = Instant.now().minus(90, ChronoUnit.DAYS).minusSeconds(1);
        List<SandboxCronPrewarmUserCandidate> users = provider.listUsers();
        Instant upperBound = Instant.now().minus(90, ChronoUnit.DAYS).plusSeconds(1);

        assertThat(users).extracting(SandboxCronPrewarmUserCandidate::getUserCode)
            .containsExactly("alice", "bob");

        ArgumentCaptor<Date> sinceCaptor = ArgumentCaptor.forClass(Date.class);
        verify(userService).listCronPrewarmCandidateUsers(eq(UserState.ACTIVE), sinceCaptor.capture(), eq(10L),
            eq(SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE), eq(SandboxLaunchRouting.DEFAULT_RESOURCE_ID), eq(50));
        assertThat(sinceCaptor.getValue().toInstant()).isBetween(lowerBound, upperBound);

        provider.markScanned(users.get(1));

        verify(cursorStore).saveCursor(anyString(), eq(12L));
    }

    @Test
    void listUsersWrapsToBeginningWhenCursorQueryDoesNotFillLimit() {
        SandboxCronPrewarmProperties properties = new SandboxCronPrewarmProperties();
        properties.setMaxUsersPerRun(3);
        SandboxCronPrewarmUserProvider provider = new SandboxCronPrewarmUserProvider(properties, userService,
            sandboxRecordMapper, cursorStore);
        when(cursorStore.getCursor(anyString())).thenReturn(100L);
        when(userService.listCronPrewarmCandidateUsers(eq(UserState.ACTIVE), any(Date.class), eq(100L),
            eq(SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE), eq(SandboxLaunchRouting.DEFAULT_RESOURCE_ID), eq(3)))
                .thenReturn(List.of(user(101L, "alice")));
        when(userService.listCronPrewarmCandidateUsers(eq(UserState.ACTIVE), any(Date.class), eq(0L),
            eq(SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE), eq(SandboxLaunchRouting.DEFAULT_RESOURCE_ID), eq(2)))
                .thenReturn(List.of(user(1L, "bob"), user(2L, "carol")));

        List<SandboxCronPrewarmUserCandidate> users = provider.listUsers();

        assertThat(users).extracting(SandboxCronPrewarmUserCandidate::getUserCode)
            .containsExactly("alice", "bob", "carol");
    }

    @Test
    void listUserCodesFiltersConfiguredUsersWithRunningSandbox() {
        SandboxCronPrewarmProperties properties = new SandboxCronPrewarmProperties();
        properties.setUserCodes("alice,bob,carol");
        SandboxCronPrewarmUserProvider provider = new SandboxCronPrewarmUserProvider(properties, userService,
            sandboxRecordMapper, cursorStore);
        when(sandboxRecordMapper.selectRunningByUserAndResource(eq("bob"),
            eq(SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE), eq(SandboxLaunchRouting.DEFAULT_RESOURCE_ID)))
                .thenReturn(new SsSandboxRecord());

        List<String> userCodes = provider.listUserCodes();

        assertThat(userCodes).containsExactly("alice", "carol");
        verify(sandboxRecordMapper).selectRunningByUserAndResource("bob",
            SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE, SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
    }

    private Users user(Long userId, String userCode) {
        Users user = new Users();
        user.setUserId(userId);
        user.setUserCode(userCode);
        return user;
    }
}
