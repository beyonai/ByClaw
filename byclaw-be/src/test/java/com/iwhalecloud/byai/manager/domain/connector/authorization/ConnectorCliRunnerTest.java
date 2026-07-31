package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;

import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ConnectorCliRunnerTest {

    private static final Duration TEST_TIMEOUT = Duration.ofSeconds(5);
    private static final String STUBBORN_PROCESS_SCRIPT =
        "/bin/sh -c 'trap \"\" TERM; while :; do sleep 1; done' & child=$!; "
            + "printf '%s %s\\n' \"$$\" \"$child\" > \"$TASK4_PID_FILE\"; "
            + "trap 'exit 0' TERM; while :; do sleep 1; done";

    @TempDir
    Path tempDir;

    private final ConnectorCliRunner runner = new ConnectorCliRunner();

    @Test
    void runMergesStdoutAndStderrAndAddsProvidedEnvironment() {
        ConnectorCliRunner.CliResult result = runner.run(
            List.of("/bin/sh", "-c", "printf '%s\\n' \"$TASK4_VALUE\"; echo stderr-line >&2; echo stdout-line"),
            Map.of("TASK4_VALUE", "environment-line"),
            null,
            TEST_TIMEOUT);

        assertThat(result.exitCode()).isZero();
        assertThat(result.output()).contains("environment-line", "stderr-line", "stdout-line");
    }

    @Test
    void runWritesUtf8StdinAndClosesChildInput() {
        String stdin = "你好, connector\n";

        ConnectorCliRunner.CliResult result = runner.run(
            List.of("/bin/sh", "-c", "cat"), Map.of(), stdin, TEST_TIMEOUT);

        assertThat(result.exitCode()).isZero();
        assertThat(result.output()).isEqualTo(stdin);
    }

    @Test
    void runTimeoutKillsStubbornCapturedChildAndRoot() throws Exception {
        Path pidFile = tempDir.resolve("timeout-tree.pid");
        try {
            ConnectorCliRunner.CliResult result = runner.run(
                List.of("/bin/sh", "-c", STUBBORN_PROCESS_SCRIPT),
                Map.of("TASK4_PID_FILE", pidFile.toString()),
                null,
                Duration.ofMillis(400));

            List<Long> pids = readPids(pidFile, 2);
            assertThat(result.exitCode()).isEqualTo(124);
            assertThat(await(() -> pids.stream().noneMatch(this::isAlive), TEST_TIMEOUT)).isTrue();
        } finally {
            forceCleanup(pidFile);
        }
    }

    @Test
    void explicitDestroyKillsStubbornCapturedChildAndRoot() throws Exception {
        Path pidFile = tempDir.resolve("destroy-tree.pid");
        ConnectorCliRunner.ManagedProcess process = null;
        try {
            process = runner.start(
                List.of("/bin/sh", "-c", STUBBORN_PROCESS_SCRIPT),
                Map.of("TASK4_PID_FILE", pidFile.toString()),
                null);
            List<Long> pids = readPids(pidFile, 2);

            process.destroy();

            assertThat(await(() -> pids.stream().noneMatch(this::isAlive), TEST_TIMEOUT)).isTrue();
        } finally {
            if (process != null) {
                process.destroy();
            }
            forceCleanup(pidFile);
        }
    }

    @Test
    void runDeadlineIncludesBlockedAsynchronousStdinWrite() {
        Path pidFile = tempDir.resolve("blocked-run-input.pid");
        String largeStdin = "s".repeat(2 * 1024 * 1024);
        try {
            ConnectorCliRunner.CliResult result = assertTimeoutPreemptively(
                Duration.ofSeconds(2),
                () -> runner.run(
                    List.of("/bin/sh", "-c", "echo $$ > \"$TASK4_PID_FILE\"; sleep 30"),
                    Map.of("TASK4_PID_FILE", pidFile.toString()),
                    largeStdin,
                    Duration.ofMillis(300)));

            assertThat(result.exitCode()).isEqualTo(124);
            assertThat(await(() -> readExistingPids(pidFile).stream().noneMatch(this::isAlive), TEST_TIMEOUT)).isTrue();
        } finally {
            forceCleanup(pidFile);
        }
    }

    @Test
    void startReturnsPromptlyWhileLargeStdinWriteRunsAsynchronously() {
        Path pidFile = tempDir.resolve("blocked-start-input.pid");
        String largeStdin = "s".repeat(2 * 1024 * 1024);
        ConnectorCliRunner.ManagedProcess process = null;
        try {
            process = assertTimeoutPreemptively(
                Duration.ofSeconds(1),
                () -> runner.start(
                    List.of("/bin/sh", "-c", "echo $$ > \"$TASK4_PID_FILE\"; sleep 30"),
                    Map.of("TASK4_PID_FILE", pidFile.toString()),
                    largeStdin));

            assertThat(process.isAlive()).isTrue();
        } finally {
            if (process != null) {
                process.destroy();
            }
            forceCleanup(pidFile);
        }
    }

    @Test
    void commandValidationRejectsEveryNullOrNulElementWithoutDisclosingValues() {
        String secret = "task4-command-secret";
        List<String> nullElement = new ArrayList<>();
        nullElement.add("/bin/sh");
        nullElement.add(null);

        assertGenericValidation(() -> runner.start(null, Map.of(), secret), secret);
        assertGenericValidation(() -> runner.start(List.of(), Map.of(), secret), secret);
        assertGenericValidation(() -> runner.start(nullElement, Map.of(), secret), secret);
        assertGenericValidation(
            () -> runner.start(List.of("/bin/sh", secret + "\0argument"), Map.of(), secret), secret);
    }

    @Test
    void environmentValidationRejectsNullNulAndInvalidKeysWithoutDisclosingValues() {
        String secret = "task4-environment-secret";
        Map<String, String> nullKey = new HashMap<>();
        nullKey.put(null, "value");
        Map<String, String> nullValue = new HashMap<>();
        nullValue.put("TASK4_SECRET", null);

        assertGenericValidation(() -> runner.start(List.of("/bin/sh"), nullKey, secret), secret);
        assertGenericValidation(() -> runner.start(List.of("/bin/sh"), nullValue, secret), secret);
        assertGenericValidation(
            () -> runner.start(List.of("/bin/sh"), Map.of("", secret), secret), secret);
        assertGenericValidation(
            () -> runner.start(List.of("/bin/sh"), Map.of(secret + "=KEY", "value"), secret), secret);
        assertGenericValidation(
            () -> runner.start(List.of("/bin/sh"), Map.of("TASK4_SECRET", secret + "\0value"), secret), secret);
    }

    @Test
    void truncationIsExplicitUtf8SafeAndRetainsRecentOutput() {
        ConnectorCliRunner.CliResult result = runner.run(
            List.of(
                "/bin/sh",
                "-c",
                "i=0; while [ \"$i\" -lt 24000 ]; do printf '界'; i=$((i + 1)); done; printf 'TAIL-✓'"),
            Map.of(),
            null,
            TEST_TIMEOUT);

        assertThat(result.exitCode()).isZero();
        assertThat(result.output().getBytes(StandardCharsets.UTF_8).length).isLessThanOrEqualTo(64 * 1024);
        assertThat(result.output()).doesNotContain("\uFFFD").endsWith("TAIL-✓");
        assertThat(resultTruncated(result)).isTrue();
    }

    @Test
    void twoArgumentCliResultConstructorRemainsCompatibleAndDefaultsToNotTruncated() {
        ConnectorCliRunner.CliResult result = new ConnectorCliRunner.CliResult(0, "json");

        assertThat(result.exitCode()).isZero();
        assertThat(result.output()).isEqualTo("json");
        assertThat(resultTruncated(result)).isFalse();
    }

    @Test
    void managedProcessExposesOutputTruncation() throws Exception {
        ConnectorCliRunner.ManagedProcess process = runner.start(
            List.of(
                "/bin/sh",
                "-c",
                "i=0; while [ \"$i\" -lt 70000 ]; do printf x; i=$((i + 1)); done"),
            Map.of(),
            null);
        try {
            assertThat(await(() -> !process.isAlive(), TEST_TIMEOUT)).isTrue();
            assertThat(managedOutputTruncated(process)).isTrue();
        } finally {
            process.destroy();
        }
    }

    @Test
    void overallDeadlineIncludesDefinitiveOutputDrain() throws Exception {
        Path childPidFile = tempDir.resolve("drain-child.pid");
        try {
            long startedAt = System.nanoTime();
            ConnectorCliRunner.CliResult result = runner.run(
                List.of(
                    "/bin/sh",
                    "-c",
                    "sleep 30 & child=$!; echo $child > \"$TASK4_CHILD_PID_FILE\"; echo direct-output"),
                Map.of("TASK4_CHILD_PID_FILE", childPidFile.toString()),
                null,
                Duration.ofMillis(300));
            Duration elapsed = Duration.ofNanos(System.nanoTime() - startedAt);

            assertThat(result.exitCode()).isEqualTo(124);
            assertThat(result.output()).contains("direct-output");
            assertThat(elapsed).isLessThan(Duration.ofSeconds(2));
        } finally {
            forceCleanup(childPidFile);
        }
    }

    @Test
    void normalCompletionWaitsForDefinitiveOutputDrain() {
        ConnectorCliRunner.CliResult result = runner.run(
            List.of("/bin/sh", "-c", "i=0; while [ \"$i\" -lt 1000 ]; do printf x; i=$((i + 1)); done; echo END"),
            Map.of(),
            null,
            TEST_TIMEOUT);

        assertThat(result.exitCode()).isZero();
        assertThat(result.output()).hasSize(1004).endsWith("END\n");
        assertThat(resultTruncated(result)).isFalse();
    }

    @Test
    void managedProcessExposesLifecycleOutputAndIdempotentDestroyWithCleanup() {
        ConnectorCliRunner.ManagedProcess process = runner.start(
            List.of("/bin/sh", "-c", "echo ready; sleep 30"), Map.of(), null);
        try {
            assertThat(await(() -> process.output().contains("ready"), TEST_TIMEOUT)).isTrue();
            assertThat(process.isAlive()).isTrue();
            assertThat(process.exitCode()).isNull();

            process.destroy();
            process.destroy();

            assertThat(await(() -> !process.isAlive(), TEST_TIMEOUT)).isTrue();
            assertThat(process.exitCode()).isNotNull();
            assertThat(process.output()).contains("ready");
        } finally {
            process.destroy();
        }
    }

    @Test
    void runValidatesPositiveTimeout() {
        assertThatThrownBy(() -> runner.run(
            List.of("/bin/sh", "-c", "true"), Map.of(), null, Duration.ZERO))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void processStartFailureDoesNotExposeStdinInExceptionMessage() {
        String secret = "secret-stdin-value";

        Throwable thrown = catchThrowable(() -> runner.start(
            List.of("/definitely/missing/task4-command"), Map.of(), secret));

        assertThat(thrown).isInstanceOf(IllegalStateException.class);
        assertThat(exceptionMessageChain(thrown)).doesNotContain(secret);
    }

    private void assertGenericValidation(ThrowingCallable callable, String secret) {
        Throwable thrown = catchThrowable(callable);

        assertThat(thrown).isInstanceOf(IllegalArgumentException.class);
        assertThat(exceptionMessageChain(thrown)).doesNotContain(secret);
    }

    private boolean resultTruncated(ConnectorCliRunner.CliResult result) {
        try {
            return (boolean) ConnectorCliRunner.CliResult.class.getMethod("truncated").invoke(result);
        } catch (ReflectiveOperationException e) {
            throw new AssertionError("CliResult.truncated() is required", e);
        }
    }

    private boolean managedOutputTruncated(ConnectorCliRunner.ManagedProcess process) {
        try {
            return (boolean) ConnectorCliRunner.ManagedProcess.class.getMethod("outputTruncated").invoke(process);
        } catch (ReflectiveOperationException e) {
            throw new AssertionError("ManagedProcess.outputTruncated() is required", e);
        }
    }

    private String exceptionMessageChain(Throwable throwable) {
        StringBuilder messages = new StringBuilder();
        Throwable current = throwable;
        while (current != null) {
            if (current.getMessage() != null) {
                messages.append(current.getMessage()).append('\n');
            }
            current = current.getCause();
        }
        return messages.toString();
    }

    private List<Long> readPids(Path pidFile, int expectedCount) throws Exception {
        assertThat(await(() -> readExistingPids(pidFile).size() == expectedCount, TEST_TIMEOUT)).isTrue();
        return readExistingPids(pidFile);
    }

    private List<Long> readExistingPids(Path pidFile) {
        try {
            if (!Files.isRegularFile(pidFile)) {
                return List.of();
            }
            String value = Files.readString(pidFile).trim();
            if (value.isEmpty()) {
                return List.of();
            }
            return List.of(value.split("\\s+")).stream().map(Long::parseLong).toList();
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private boolean isAlive(long pid) {
        return ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false);
    }

    private void forceCleanup(Path pidFile) {
        readExistingPids(pidFile).forEach(this::forceKillTree);
    }

    private void forceKillTree(long pid) {
        ProcessHandle.of(pid).ifPresent(handle -> {
            handle.descendants().forEach(ProcessHandle::destroyForcibly);
            handle.destroyForcibly();
        });
    }

    private boolean await(BooleanSupplier condition, Duration timeout) {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            if (condition.getAsBoolean()) {
                return true;
            }
            try {
                Thread.sleep(10);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return condition.getAsBoolean();
    }
}
