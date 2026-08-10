package com.iwhalecloud.byai.manager.domain.devloop.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.CliResult;

@ExtendWith(MockitoExtension.class)
class DwsAuthServiceProcessIsolationTest {

    private static final String AUTHORIZATION_ID = "auth-1";

    @TempDir
    Path tempDir;

    @Mock
    private LoginApplicationService loginApplicationService;

    @Mock
    private UserBucketNamingService userBucketNamingService;

    @Test
    void applyUserDwsEnvUsesConnectorAuthorizationHomeLayout() throws Exception {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("user001");
        when(loginApplicationService.getLoginInfo(11L)).thenReturn(loginInfo);
        when(userBucketNamingService.buildUserBucketName("user001")).thenReturn("byclaw-user001");
        DwsAuthService service = new DwsAuthService();
        ReflectionTestUtils.setField(service, "fileStorageRoot", tempDir.toString());
        ReflectionTestUtils.setField(service, "loginApplicationService", loginApplicationService);
        ReflectionTestUtils.setField(service, "userBucketNamingService", userBucketNamingService);

        Map<String, String> environment = new java.util.HashMap<>();

        assertThat(service.applyUserDwsEnv(environment, 11L)).isTrue();

        Path home = tempDir.toAbsolutePath().resolve("byclaw-user001/by/.connector-auth/.dws");
        assertThat(environment).containsEntry("HOME", home.toString())
            .containsEntry("DWS_CONFIG_DIR", home.resolve("config").toString());
        assertThat(Files.isDirectory(home)).isTrue();
        assertThat(Files.isDirectory(home.resolve("config"))).isTrue();
    }

    @Test
    void revokeCredentialUsesTheExplicitUsersIsolatedWorkspace() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("user001");
        when(loginApplicationService.getLoginInfo(11L)).thenReturn(loginInfo);
        when(userBucketNamingService.buildUserBucketName("user001")).thenReturn("byclaw-user001");
        ConnectorCliRunner cliRunner = mock(ConnectorCliRunner.class);
        when(cliRunner.run(eq(java.util.List.of("dws", "auth", "reset", "-y")), any(), eq(null), any()))
            .thenReturn(new CliResult(0, ""));
        DwsAuthService service = new DwsAuthService();
        ReflectionTestUtils.setField(service, "fileStorageRoot", tempDir.toString());
        ReflectionTestUtils.setField(service, "loginApplicationService", loginApplicationService);
        ReflectionTestUtils.setField(service, "userBucketNamingService", userBucketNamingService);
        ReflectionTestUtils.setField(service, "connectorCliRunner", cliRunner);

        service.revokeCredential(11L, java.util.List.of("dws", "auth", "reset", "-y"));

        Path home = tempDir.toAbsolutePath().resolve("byclaw-user001/by/.connector-auth/.dws");
        verify(cliRunner).run(
            eq(java.util.List.of("dws", "auth", "reset", "-y")),
            eq(Map.of(
                "HOME", home.toString(),
                "DWS_CONFIG_DIR", home.resolve("config").toString(),
                "DWS_DISABLE_KEYCHAIN", "1")),
            eq(null),
            eq(java.time.Duration.ofSeconds(30)));
    }

    @Test
    void deviceFlowSuppressesCliBrowserLaunch() throws Exception {
        FakeProcess process = FakeProcess.deviceFlow("CODE-1");
        AtomicReference<java.util.List<String>> command = new AtomicReference<>();
        DwsAuthService.DwsProcessLauncher launcher = builder -> {
            command.set(builder.command());
            return process;
        };
        DwsAuthService service = isolatedService(launcher, true);

        assertThat(startDeviceAuth(service, 11L, AUTHORIZATION_ID).get("success")).isEqualTo(true);
        assertThat(command.get()).containsExactly(
            "dws", "auth", "login", "--device", "--no-browser", "--recommend", "-y");

        service.cancelDeviceAuth(AUTHORIZATION_ID, 11L);
    }

    @Test
    void successiveDuplicateStartsLaunchOnlyOnceAndPreserveFirstProcess() throws Exception {
        FakeProcess first = FakeProcess.deviceFlow("CODE-1");
        FakeProcess unexpectedSecond = FakeProcess.deviceFlow("CODE-2");
        QueueLauncher launcher = new QueueLauncher(first, unexpectedSecond);
        DwsAuthService service = isolatedService(launcher, true);

        Map<String, Object> firstResult = startDeviceAuth(service, 11L, AUTHORIZATION_ID);
        Map<String, Object> secondResult = startDeviceAuth(service, 11L, AUTHORIZATION_ID);

        assertThat(firstResult.get("success")).isEqualTo(true);
        assertThat(secondResult.get("success")).isEqualTo(false);
        assertThat(secondResult.get("message").toString()).doesNotContain("CODE-1");
        assertThat(launcher.launchCount()).isEqualTo(1);
        assertThat(first.isAlive()).isTrue();
        assertThat(first.destroyCount()).isZero();
        assertThat(unexpectedSecond.isAlive()).isTrue();

        service.cancelDeviceAuth(AUTHORIZATION_ID, 11L);
        unexpectedSecond.complete(1);
    }

    @Test
    void concurrentDuplicateStartsLaunchOnlyOnce() throws Exception {
        FakeProcess first = FakeProcess.deviceFlow("CODE-1");
        FakeProcess unexpectedSecond = FakeProcess.deviceFlow("CODE-2");
        CountDownLatch firstLaunchEntered = new CountDownLatch(1);
        CountDownLatch releaseFirstLaunch = new CountDownLatch(1);
        AtomicInteger launchCount = new AtomicInteger();
        DwsAuthService.DwsProcessLauncher launcher = builder -> {
            int attempt = launchCount.incrementAndGet();
            if (attempt == 1) {
                firstLaunchEntered.countDown();
                try {
                    if (!releaseFirstLaunch.await(2, TimeUnit.SECONDS)) {
                        throw new IOException("test launcher timed out");
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IOException("test launcher interrupted", e);
                }
                return first;
            }
            return unexpectedSecond;
        };
        DwsAuthService service = isolatedService(launcher, true);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch secondTaskStarted = new CountDownLatch(1);

        Future<Map<String, Object>> firstStart = executor.submit(
            () -> startDeviceAuth(service, 11L, AUTHORIZATION_ID));
        assertThat(firstLaunchEntered.await(1, TimeUnit.SECONDS)).isTrue();
        Future<Map<String, Object>> secondStart = executor.submit(() -> {
            secondTaskStarted.countDown();
            return startDeviceAuth(service, 11L, AUTHORIZATION_ID);
        });
        assertThat(secondTaskStarted.await(1, TimeUnit.SECONDS)).isTrue();

        try {
            assertThatThrownBy(() -> secondStart.get(150, TimeUnit.MILLISECONDS))
                .isInstanceOf(TimeoutException.class);
            releaseFirstLaunch.countDown();

            assertThat(firstStart.get(2, TimeUnit.SECONDS).get("success")).isEqualTo(true);
            assertThat(secondStart.get(2, TimeUnit.SECONDS).get("success")).isEqualTo(false);
            assertThat(launchCount).hasValue(1);
            assertThat(first.isAlive()).isTrue();
            assertThat(first.destroyCount()).isZero();
        } finally {
            releaseFirstLaunch.countDown();
            service.cancelDeviceAuth(AUTHORIZATION_ID, 11L);
            unexpectedSecond.complete(1);
            executor.shutdownNow();
        }
    }

    @Test
    void sameAuthorizationIdDifferentOwnerCannotReplaceFirstProcess() throws Exception {
        FakeProcess first = FakeProcess.deviceFlow("CODE-1");
        FakeProcess unexpectedSecond = FakeProcess.deviceFlow("CODE-2");
        QueueLauncher launcher = new QueueLauncher(first, unexpectedSecond);
        DwsAuthService service = isolatedService(launcher, true);

        assertThat(startDeviceAuth(service, 11L, AUTHORIZATION_ID).get("success")).isEqualTo(true);
        Map<String, Object> secondResult = startDeviceAuth(service, 22L, AUTHORIZATION_ID);

        assertThat(secondResult.get("success")).isEqualTo(false);
        assertThat(launcher.launchCount()).isEqualTo(1);
        assertThat(first.isAlive()).isTrue();
        assertThat(first.destroyCount()).isZero();

        service.cancelDeviceAuth(AUTHORIZATION_ID, 11L);
        unexpectedSecond.complete(1);
    }

    @Test
    void differentAuthorizationIdsAndUsersLaunchIndependently() throws Exception {
        FakeProcess first = FakeProcess.deviceFlow("CODE-1");
        FakeProcess second = FakeProcess.deviceFlow("CODE-2");
        QueueLauncher launcher = new QueueLauncher(first, second);
        DwsAuthService service = isolatedService(launcher, true);

        Map<String, Object> firstResult = startDeviceAuth(service, 11L, "auth-1");
        Map<String, Object> secondResult = startDeviceAuth(service, 22L, "auth-2");

        assertThat(firstResult.get("success")).isEqualTo(true);
        assertThat(secondResult.get("success")).isEqualTo(true);
        assertThat(launcher.launchCount()).isEqualTo(2);
        assertThat(service.deviceFlowRegistrations).containsOnlyKeys("auth-1", "auth-2");

        service.cancelDeviceAuth("auth-1", 11L);
        service.cancelDeviceAuth("auth-2", 22L);
    }

    @Test
    void deadRegistrationIsRemovedBeforeStartingReplacement() throws Exception {
        FakeProcess stale = FakeProcess.deviceFlow("STALE");
        stale.complete(1);
        FakeProcess replacement = FakeProcess.deviceFlow("FRESH");
        QueueLauncher launcher = new QueueLauncher(replacement);
        DwsAuthService service = isolatedService(launcher, true);
        service.deviceFlowRegistrations.put(
            AUTHORIZATION_ID, new DwsAuthService.DeviceFlowRegistration(11L, stale));

        Map<String, Object> result = startDeviceAuth(service, 22L, AUTHORIZATION_ID);

        assertThat(result.get("success")).isEqualTo(true);
        assertThat(launcher.launchCount()).isEqualTo(1);
        assertThat(service.deviceFlowRegistrations.get(AUTHORIZATION_ID).userId()).isEqualTo(22L);

        service.cancelDeviceAuth(AUTHORIZATION_ID, 22L);
    }

    @Test
    void failedEnvironmentIsolationNeverCallsLauncher() throws Exception {
        FakeProcess process = FakeProcess.deviceFlow("CODE-1");
        QueueLauncher launcher = new QueueLauncher(process);
        DwsAuthService service = isolatedService(launcher, false);

        Map<String, Object> result = startDeviceAuth(service, 11L, AUTHORIZATION_ID);

        assertThat(result.get("success")).isEqualTo(false);
        assertThat(launcher.launchCount()).isZero();
        assertThat(service.deviceFlowRegistrations).isEmpty();
        process.complete(1);
    }

    @Test
    void exactCancellationDestroysOnlyRequestedAuthorization() throws Exception {
        FakeProcess requested = FakeProcess.deviceFlow("CODE-1");
        FakeProcess sibling = FakeProcess.deviceFlow("CODE-2");
        DwsAuthService service = isolatedService(new QueueLauncher(requested, sibling), true);
        startDeviceAuth(service, 11L, "auth-1");
        startDeviceAuth(service, 11L, "auth-2");

        boolean cancelled = service.cancelDeviceAuth("auth-1", 11L);

        assertThat(cancelled).isTrue();
        assertThat(requested.destroyCount()).isEqualTo(1);
        assertThat(sibling.destroyCount()).isZero();
        assertThat(service.deviceFlowRegistrations).containsOnlyKeys("auth-2");

        service.cancelDeviceAuth("auth-2", 11L);
    }

    @Test
    void exactCancellationRejectsWrongUser() throws Exception {
        FakeProcess process = FakeProcess.deviceFlow("CODE-1");
        DwsAuthService service = isolatedService(new QueueLauncher(process), true);
        startDeviceAuth(service, 11L, AUTHORIZATION_ID);

        boolean cancelled = service.cancelDeviceAuth(AUTHORIZATION_ID, 22L);

        assertThat(cancelled).isFalse();
        assertThat(process.destroyCount()).isZero();
        assertThat(service.deviceFlowRegistrations).containsOnlyKeys(AUTHORIZATION_ID);

        service.cancelDeviceAuth(AUTHORIZATION_ID, 11L);
    }

    @Test
    void legacyCancellationTargetsOnlyStableLegacyAuthorizationId() throws Exception {
        FakeProcess legacy = FakeProcess.deviceFlow("LEGACY");
        FakeProcess explicit = FakeProcess.deviceFlow("EXPLICIT");
        DwsAuthService service = isolatedService(new QueueLauncher(legacy, explicit), true);
        startDeviceAuth(service, 11L, "legacy-dws-user-11");
        startDeviceAuth(service, 11L, "new-auth-11");

        boolean cancelled = service.cancelDeviceAuth(11L);

        assertThat(cancelled).isTrue();
        assertThat(legacy.destroyCount()).isEqualTo(1);
        assertThat(explicit.destroyCount()).isZero();
        assertThat(service.deviceFlowRegistrations).containsOnlyKeys("new-auth-11");

        service.cancelDeviceAuth("new-auth-11", 11L);
    }

    @Test
    void waiterCompareRemovePreservesReplacementRegistration() throws Exception {
        FakeProcess original = FakeProcess.deviceFlow("ORIGINAL");
        FakeProcess replacement = FakeProcess.deviceFlow("REPLACEMENT");
        DwsAuthService service = isolatedService(new QueueLauncher(original), true);
        startDeviceAuth(service, 11L, AUTHORIZATION_ID);
        DwsAuthService.DeviceFlowRegistration replacementRegistration =
            new DwsAuthService.DeviceFlowRegistration(22L, replacement);
        service.deviceFlowRegistrations.put(AUTHORIZATION_ID, replacementRegistration);

        original.complete(1);

        assertThat(original.awaitWaiterReturn()).isTrue();
        assertThat(service.deviceFlowRegistrations.get(AUTHORIZATION_ID)).isSameAs(replacementRegistration);

        service.cancelDeviceAuth(AUTHORIZATION_ID, 22L);
    }

    @Test
    void successfulParseDrainsRemainingOutputAndClosesReader() throws Exception {
        FakeProcess process = FakeProcess.deviceFlow("CODE-1");
        DwsAuthService service = isolatedService(new QueueLauncher(process), true);

        assertThat(startDeviceAuth(service, 11L, AUTHORIZATION_ID).get("success")).isEqualTo(true);
        process.writeOutput("continued output that must be drained\n");
        process.closeOutput();

        assertThat(process.awaitInputClosed()).isTrue();
        service.cancelDeviceAuth(AUTHORIZATION_ID, 11L);
    }

    @Test
    void parseFailureDestroysProcessAndClosesReader() throws Exception {
        FakeProcess process = FakeProcess.rawOutput("not a device-flow response\n");
        process.closeOutput();
        DwsAuthService service = isolatedService(new QueueLauncher(process), true);

        Map<String, Object> result = startDeviceAuth(service, 11L, AUTHORIZATION_ID);

        assertThat(result.get("success")).isEqualTo(false);
        assertThat(process.destroyCount()).isEqualTo(1);
        assertThat(process.awaitInputClosed()).isTrue();
        assertThat(service.deviceFlowRegistrations).isEmpty();
    }

    private DwsAuthService isolatedService(DwsAuthService.DwsProcessLauncher launcher, boolean applyEnvironment) {
        return new TestDwsAuthService(launcher, applyEnvironment);
    }

    private Map<String, Object> startDeviceAuth(DwsAuthService service, Long userId, String authorizationId) {
        return service.startDeviceAuth(
            userId,
            authorizationId,
            java.util.List.of("dws", "auth", "login", "--device", "--no-browser", "--recommend", "-y")
        );
    }

    private static final class TestDwsAuthService extends DwsAuthService {

        private final boolean applyEnvironment;

        private TestDwsAuthService(DwsProcessLauncher launcher, boolean applyEnvironment) {
            super(launcher);
            this.applyEnvironment = applyEnvironment;
        }

        @Override
        public boolean applyUserDwsEnv(Map<String, String> env, Long userId) {
            return applyEnvironment;
        }
    }

    private static final class QueueLauncher implements DwsAuthService.DwsProcessLauncher {

        private final ConcurrentLinkedDeque<FakeProcess> processes = new ConcurrentLinkedDeque<>();
        private final AtomicInteger launchCount = new AtomicInteger();

        private QueueLauncher(FakeProcess... processes) {
            for (FakeProcess process : processes) {
                this.processes.add(process);
            }
        }

        @Override
        public Process start(ProcessBuilder builder) throws IOException {
            launchCount.incrementAndGet();
            FakeProcess process = processes.poll();
            if (process == null) {
                throw new IOException("No fake process configured");
            }
            return process;
        }

        private int launchCount() {
            return launchCount.get();
        }
    }

    private static final class FakeProcess extends Process {

        private final TrackingInputStream input;
        private final PipedOutputStream output;
        private final CountDownLatch completion = new CountDownLatch(1);
        private final CountDownLatch waiterReturned = new CountDownLatch(1);
        private final AtomicBoolean alive = new AtomicBoolean(true);
        private final AtomicInteger destroyCount = new AtomicInteger();
        private volatile int exitCode;

        private FakeProcess(String initialOutput) throws IOException {
            PipedInputStream pipeInput = new PipedInputStream(8192);
            this.output = new PipedOutputStream(pipeInput);
            this.input = new TrackingInputStream(pipeInput);
            writeOutput(initialOutput);
        }

        private static FakeProcess deviceFlow(String code) throws IOException {
            return new FakeProcess(
                "authorization code: " + code + "\n"
                    + "https://login.dingtalk.com/oauth2/device/verify.htm?user_code=" + code + "\n");
        }

        private static FakeProcess rawOutput(String output) throws IOException {
            return new FakeProcess(output);
        }

        private void writeOutput(String value) throws IOException {
            output.write(value.getBytes(StandardCharsets.UTF_8));
            output.flush();
        }

        private void closeOutput() throws IOException {
            output.close();
        }

        private void complete(int code) throws IOException {
            exitCode = code;
            if (alive.compareAndSet(true, false)) {
                closeOutput();
                completion.countDown();
            }
        }

        private int destroyCount() {
            return destroyCount.get();
        }

        private boolean awaitInputClosed() throws InterruptedException {
            return input.closed.await(2, TimeUnit.SECONDS);
        }

        private boolean awaitWaiterReturn() throws InterruptedException {
            return waiterReturned.await(2, TimeUnit.SECONDS);
        }

        @Override
        public OutputStream getOutputStream() {
            return OutputStream.nullOutputStream();
        }

        @Override
        public InputStream getInputStream() {
            return input;
        }

        @Override
        public InputStream getErrorStream() {
            return InputStream.nullInputStream();
        }

        @Override
        public int waitFor() throws InterruptedException {
            completion.await();
            waiterReturned.countDown();
            return exitCode;
        }

        @Override
        public boolean waitFor(long timeout, TimeUnit unit) throws InterruptedException {
            boolean finished = completion.await(timeout, unit);
            if (finished) {
                waiterReturned.countDown();
            }
            return finished;
        }

        @Override
        public int exitValue() {
            if (alive.get()) {
                throw new IllegalThreadStateException("process still running");
            }
            return exitCode;
        }

        @Override
        public void destroy() {
            destroyForcibly();
        }

        @Override
        public Process destroyForcibly() {
            destroyCount.incrementAndGet();
            try {
                complete(143);
            } catch (IOException ignored) {
                // Test process teardown has no recovery path.
            }
            return this;
        }

        @Override
        public boolean isAlive() {
            return alive.get();
        }
    }

    private static final class TrackingInputStream extends FilterInputStream {

        private final CountDownLatch closed = new CountDownLatch(1);

        private TrackingInputStream(InputStream delegate) {
            super(delegate);
        }

        @Override
        public void close() throws IOException {
            try {
                super.close();
            } finally {
                closed.countDown();
            }
        }
    }
}
