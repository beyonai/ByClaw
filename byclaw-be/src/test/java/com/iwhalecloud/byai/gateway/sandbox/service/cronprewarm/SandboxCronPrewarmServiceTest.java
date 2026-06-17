package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.util.List;
import java.util.function.Supplier;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;

class SandboxCronPrewarmServiceTest {

    private final SandboxCronPrewarmProperties properties = new SandboxCronPrewarmProperties();

    private final SandboxCronPrewarmUserProvider userProvider = mock(SandboxCronPrewarmUserProvider.class);

    private final OpenClawStateSnapshotReader snapshotReader = mock(OpenClawStateSnapshotReader.class);

    private final OpenClawCronDueJobReader dueJobReader = mock(OpenClawCronDueJobReader.class);

    private final SandboxCronPrewarmTargetResolver targetResolver = mock(SandboxCronPrewarmTargetResolver.class);

    private final SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);

    private final SandboxService sandboxService = mock(SandboxService.class);

    private final SandboxUserContextRunner userContextRunner = mock(SandboxUserContextRunner.class);

    private final SandboxCronPrewarmService service = new SandboxCronPrewarmService(properties, userProvider,
        snapshotReader, dueJobReader, targetResolver, sandboxRecordMapper, sandboxService, userContextRunner);

    @Test
    void advancesCursorOnlyForActuallyScannedUsersWhenLaunchLimitIsReached() throws Exception {
        properties.setMaxLaunchesPerRun(1);
        SandboxCronPrewarmUserCandidate first = new SandboxCronPrewarmUserCandidate(1L, "alice");
        SandboxCronPrewarmUserCandidate second = new SandboxCronPrewarmUserCandidate(2L, "bob");
        OpenClawStateSnapshot snapshot = mock(OpenClawStateSnapshot.class);
        OpenClawCronDueJob job = new OpenClawCronDueJob("job-1", 1000L, null, null, null, null);
        SandboxCronPrewarmTarget target = new SandboxCronPrewarmTarget("alice",
            SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE, SandboxLaunchRouting.DEFAULT_RESOURCE_ID);

        when(userProvider.listUsers()).thenReturn(List.of(first, second));
        when(snapshot.isMissingDatabase()).thenReturn(false);
        when(snapshot.getDatabaseFile()).thenReturn(Path.of("openclaw.sqlite"));
        when(snapshotReader.snapshot("alice")).thenReturn(snapshot);
        when(dueJobReader.readDueJobs(any(Path.class), anyLong(), anyLong(), anyInt()))
            .thenReturn(OpenClawCronDueJobs.ready(List.of(job)));
        when(targetResolver.resolve("alice", job)).thenReturn(target);
        when(userContextRunner.callAsUser(eq("alice"), any())).thenAnswer(invocation -> {
            Supplier<?> supplier = invocation.getArgument(1);
            return supplier.get();
        });

        SandboxCronPrewarmReport report = service.prewarmDueCronSandboxes();

        assertThat(report.getLaunched()).isEqualTo(1);
        verify(userProvider).markScanned(first);
        verify(userProvider, never()).markScanned(second);
        verify(snapshotReader, never()).snapshot("bob");
    }
}
