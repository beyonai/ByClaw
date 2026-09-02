package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.springframework.stereotype.Component;

@Component
public class ConnectorCliRunner {

    private static final int MAX_OUTPUT_BYTES = 64 * 1024;
    private static final int MAX_CALLER_OUTPUT_BYTES = 16 * 1024 * 1024;
    private static final long PROCESS_POLL_MILLIS = 20L;
    private static final long DESTROY_GRACE_MILLIS = 200L;
    private static final long DESTROY_POLL_MILLIS = 10L;
    private static final String CLI_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

    public CliResult run(
        List<String> command,
        Map<String, String> environment,
        String stdin,
        Duration timeout) {
        return run(command, environment, stdin, timeout, MAX_OUTPUT_BYTES);
    }

    public CliResult run(
        List<String> command,
        Map<String, String> environment,
        String stdin,
        Duration timeout,
        int maxOutputBytes) {
        if (timeout == null || timeout.isZero() || timeout.isNegative()) {
            throw new IllegalArgumentException("timeout must be positive");
        }
        if (maxOutputBytes <= 0 || maxOutputBytes > MAX_CALLER_OUTPUT_BYTES) {
            throw new IllegalArgumentException("maxOutputBytes is invalid");
        }
        long deadlineNanos = deadlineFromNow(timeout);
        List<String> safeCommand = validatedCommandCopy(command);
        Map<String, String> safeEnvironment = validatedEnvironmentCopy(environment);
        DefaultManagedProcess managedProcess = startProcess(safeCommand, safeEnvironment, stdin, maxOutputBytes);

        try {
            while (managedProcess.isAlive()) {
                if (managedProcess.inputFailed()) {
                    managedProcess.destroy();
                    throw new IllegalStateException("Connector CLI input failed");
                }
                if (managedProcess.outputFailed()) {
                    managedProcess.destroy();
                    throw new IllegalStateException("Connector CLI output failed");
                }
                long remainingNanos = remainingNanos(deadlineNanos);
                if (remainingNanos <= 0) {
                    return timeoutResult(managedProcess);
                }
                managedProcess.waitForProcess(Math.min(
                    remainingNanos,
                    TimeUnit.MILLISECONDS.toNanos(PROCESS_POLL_MILLIS)));
            }

            if (!managedProcess.awaitInput(remainingNanos(deadlineNanos))
                || !managedProcess.awaitOutput(remainingNanos(deadlineNanos))) {
                return timeoutResult(managedProcess);
            }
            if (managedProcess.inputFailed()) {
                managedProcess.destroy();
                throw new IllegalStateException("Connector CLI input failed");
            }
            if (managedProcess.outputFailed()) {
                managedProcess.destroy();
                throw new IllegalStateException("Connector CLI output failed");
            }
            return new CliResult(
                managedProcess.exitCode(),
                managedProcess.output(),
                managedProcess.outputTruncated());
        } catch (InterruptedException e) {
            managedProcess.destroy();
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while waiting for connector CLI process");
        }
    }

    public ManagedProcess start(List<String> command, Map<String, String> environment, String stdin) {
        List<String> safeCommand = validatedCommandCopy(command);
        Map<String, String> safeEnvironment = validatedEnvironmentCopy(environment);
        return startProcess(safeCommand, safeEnvironment, stdin, MAX_OUTPUT_BYTES);
    }

    private DefaultManagedProcess startProcess(
        List<String> command,
        Map<String, String> environment,
        String stdin,
        int maxOutputBytes) {
        ProcessBuilder processBuilder = new ProcessBuilder(command);
        processBuilder.redirectErrorStream(true);
        processBuilder.environment().clear();
        processBuilder.environment().putAll(environment);
        processBuilder.environment().put("PATH", CLI_PATH);

        try {
            return new DefaultManagedProcess(processBuilder.start(), stdin, maxOutputBytes);
        } catch (IOException | RuntimeException e) {
            throw new IllegalStateException("Unable to start connector CLI process");
        }
    }

    private CliResult timeoutResult(DefaultManagedProcess managedProcess) {
        managedProcess.destroy();
        return new CliResult(124, managedProcess.output(), managedProcess.outputTruncated());
    }

    private List<String> validatedCommandCopy(List<String> command) {
        if (command == null || command.isEmpty()) {
            throw invalidRequest();
        }
        List<String> copy = new ArrayList<>(command.size());
        for (String element : command) {
            if (element == null || element.indexOf('\0') >= 0) {
                throw invalidRequest();
            }
            copy.add(element);
        }
        if (copy.getFirst().isBlank()) {
            throw invalidRequest();
        }
        return List.copyOf(copy);
    }

    private Map<String, String> validatedEnvironmentCopy(Map<String, String> environment) {
        if (environment == null || environment.isEmpty()) {
            return Map.of();
        }
        Map<String, String> copy = new HashMap<>();
        try {
            for (Map.Entry<String, String> entry : environment.entrySet()) {
                String key = entry.getKey();
                String value = entry.getValue();
                if (key == null || key.isEmpty() || key.indexOf('=') >= 0 || key.indexOf('\0') >= 0
                    || value == null || value.indexOf('\0') >= 0) {
                    throw invalidRequest();
                }
                copy.put(key, value);
            }
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (RuntimeException e) {
            throw invalidRequest();
        }
        return Map.copyOf(copy);
    }

    private IllegalArgumentException invalidRequest() {
        return new IllegalArgumentException("Invalid connector CLI request");
    }

    private long deadlineFromNow(Duration timeout) {
        long timeoutNanos;
        try {
            timeoutNanos = timeout.toNanos();
        } catch (ArithmeticException e) {
            return Long.MAX_VALUE;
        }
        try {
            return Math.addExact(System.nanoTime(), timeoutNanos);
        } catch (ArithmeticException e) {
            return Long.MAX_VALUE;
        }
    }

    private long remainingNanos(long deadlineNanos) {
        if (deadlineNanos == Long.MAX_VALUE) {
            return Long.MAX_VALUE;
        }
        return deadlineNanos - System.nanoTime();
    }

    public record CliResult(int exitCode, String output, boolean truncated) {

        public CliResult(int exitCode, String output) {
            this(exitCode, output, false);
        }
    }

    public interface ManagedProcess {

        boolean isAlive();

        Integer exitCode();

        String output();

        boolean outputComplete();

        boolean outputTruncated();

        void destroy();
    }

    private static final class DefaultManagedProcess implements ManagedProcess {

        private final Process process;
        private final BoundedOutput output;
        private final AtomicBoolean destroyed = new AtomicBoolean();
        private final AtomicBoolean inputFailed = new AtomicBoolean();
        private final AtomicBoolean outputFailed = new AtomicBoolean();
        private final CountDownLatch inputCompleted = new CountDownLatch(1);
        private final CountDownLatch outputCompleted = new CountDownLatch(1);
        private final Thread inputWriter;
        private final Thread outputDrainer;

        private DefaultManagedProcess(Process process, String stdin, int maxOutputBytes) {
            this.process = process;
            this.output = new BoundedOutput(maxOutputBytes);
            this.outputDrainer = Thread.ofVirtual()
                .name("connector-cli-output-drainer")
                .start(this::drainOutput);
            this.inputWriter = Thread.ofVirtual()
                .name("connector-cli-input-writer")
                .start(() -> writeInput(stdin));
        }

        @Override
        public boolean isAlive() {
            return process.isAlive();
        }

        @Override
        public Integer exitCode() {
            if (process.isAlive()) {
                return null;
            }
            return process.exitValue();
        }

        @Override
        public String output() {
            return output.snapshot();
        }

        @Override
        public boolean outputComplete() {
            return outputCompleted.getCount() == 0;
        }

        @Override
        public boolean outputTruncated() {
            return output.truncated();
        }

        @Override
        public void destroy() {
            if (!destroyed.compareAndSet(false, true)) {
                return;
            }

            Set<ProcessHandle> captured = new HashSet<>();
            captured.add(process.toHandle());
            long graceDeadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(DESTROY_GRACE_MILLIS);
            boolean interrupted = false;
            while (System.nanoTime() < graceDeadline) {
                captureDescendants(captured);
                captured.stream().filter(ProcessHandle::isAlive).forEach(ProcessHandle::destroy);
                if (captured.stream().noneMatch(ProcessHandle::isAlive)) {
                    break;
                }
                try {
                    Thread.sleep(DESTROY_POLL_MILLIS);
                } catch (InterruptedException e) {
                    interrupted = true;
                    break;
                }
            }

            captureDescendants(captured);
            captured.stream().filter(ProcessHandle::isAlive).forEach(ProcessHandle::destroyForcibly);
            long forceDeadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(DESTROY_GRACE_MILLIS);
            while (System.nanoTime() < forceDeadline && captured.stream().anyMatch(ProcessHandle::isAlive)) {
                captureDescendants(captured);
                captured.stream().filter(ProcessHandle::isAlive).forEach(ProcessHandle::destroyForcibly);
                try {
                    Thread.sleep(DESTROY_POLL_MILLIS);
                } catch (InterruptedException e) {
                    interrupted = true;
                    break;
                }
            }

            // Already-reparented descendants are no longer discoverable through ProcessHandle; process-group or
            // container supervision is required to terminate those portably. Closing streams still releases pipes.
            closeQuietly(process.getOutputStream());
            closeQuietly(process.getInputStream());
            closeQuietly(process.getErrorStream());
            awaitAfterDestroy(inputCompleted);
            awaitAfterDestroy(outputCompleted);
            if (interrupted) {
                Thread.currentThread().interrupt();
            }
        }

        private void writeInput(String stdin) {
            try (OutputStream childInput = process.getOutputStream()) {
                if (stdin != null) {
                    childInput.write(stdin.getBytes(StandardCharsets.UTF_8));
                }
            } catch (IOException | RuntimeException e) {
                if (!destroyed.get()) {
                    inputFailed.set(true);
                }
            } finally {
                inputCompleted.countDown();
            }
        }

        private void drainOutput() {
            try (InputStream processOutput = process.getInputStream()) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = processOutput.read(buffer)) != -1) {
                    output.append(buffer, read);
                }
            } catch (IOException | RuntimeException e) {
                if (!destroyed.get()) {
                    outputFailed.set(true);
                }
            } finally {
                outputCompleted.countDown();
            }
        }

        private boolean inputFailed() {
            return inputFailed.get();
        }

        private boolean outputFailed() {
            return outputFailed.get();
        }

        private boolean awaitInput(long timeoutNanos) throws InterruptedException {
            return await(inputCompleted, timeoutNanos);
        }

        private boolean awaitOutput(long timeoutNanos) throws InterruptedException {
            return await(outputCompleted, timeoutNanos);
        }

        private boolean waitForProcess(long timeoutNanos) throws InterruptedException {
            return process.waitFor(Math.max(0L, timeoutNanos), TimeUnit.NANOSECONDS);
        }

        private boolean await(CountDownLatch latch, long timeoutNanos) throws InterruptedException {
            return timeoutNanos > 0 && latch.await(timeoutNanos, TimeUnit.NANOSECONDS);
        }

        private void captureDescendants(Set<ProcessHandle> captured) {
            List<ProcessHandle> snapshot = new ArrayList<>(captured);
            for (ProcessHandle handle : snapshot) {
                try {
                    captured.addAll(handle.descendants().toList());
                } catch (RuntimeException ignored) {
                    // A process can disappear while its descendants are being enumerated.
                }
            }
        }

        private void awaitAfterDestroy(CountDownLatch latch) {
            try {
                latch.await(DESTROY_GRACE_MILLIS, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }

        private void closeQuietly(AutoCloseable closeable) {
            try {
                closeable.close();
            } catch (Exception ignored) {
                // Process teardown is best effort after all handles have been terminated.
            }
        }
    }

    private static final class BoundedOutput {

        private final byte[] retained;
        private int start;
        private int size;
        private boolean truncated;

        private BoundedOutput(int maxOutputBytes) {
            this.retained = new byte[maxOutputBytes];
        }

        private synchronized void append(byte[] bytes, int length) {
            for (int index = 0; index < length; index++) {
                if (size < retained.length) {
                    retained[(start + size) % retained.length] = bytes[index];
                    size++;
                } else {
                    retained[start] = bytes[index];
                    start = (start + 1) % retained.length;
                    truncated = true;
                }
            }
        }

        private synchronized String snapshot() {
            byte[] ordered = new byte[size];
            for (int index = 0; index < size; index++) {
                ordered[index] = retained[(start + index) % retained.length];
            }
            try {
                return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.IGNORE)
                    .onUnmappableCharacter(CodingErrorAction.IGNORE)
                    .decode(ByteBuffer.wrap(ordered))
                    .toString();
            } catch (Exception ignored) {
                return "";
            }
        }

        private synchronized boolean truncated() {
            return truncated;
        }
    }
}
