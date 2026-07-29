package com.iwhalecloud.byai.state.application.service.recorder;

import java.io.BufferedReader;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "recorder.browser", name = "vnc-provider", havingValue = "managed")
public class PodmanRecorderVncProvider implements RecorderVncProvider {

    private static final String LOCALHOST = "127.0.0.1";

    private final RecorderBrowserProperties properties;
    private final HttpClient httpClient;
    private final Map<String, RecorderVncEndpoint> endpoints = new ConcurrentHashMap<>();

    public PodmanRecorderVncProvider(RecorderBrowserProperties properties) {
        this.properties = properties;
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(1500))
            .build();
    }

    @Override
    public RecorderVncEndpoint start(String sessionId) {
        RecorderVncEndpoint existing = endpoints.get(sessionId);
        if (existing != null) {
            return existing;
        }
        String containerName = properties.getVncContainer();
        String state = podman(List.of("inspect", containerName, "--format", "{{.State.Status}}"), 15000, true);
        if ("running".equals(state)) {
            // Reuse existing container.
        } else if (state != null && !state.isBlank()) {
            podman(List.of("start", containerName), 30000, false);
        } else {
            podman(List.of("run", "-d", "-P", "--name", containerName, properties.getVncImage()), 30000, false);
        }

        int vncPort = hostPort(containerName, 6080);
        int gatewayPort = hostPort(containerName, 7000);
        long deadline = System.currentTimeMillis() + properties.getVncReadyTimeoutMs();
        waitReady("http://" + LOCALHOST + ":" + gatewayPort + "/healthz", deadline);
        String vncUrl = "http://" + LOCALHOST + ":" + vncPort + "/vnc.html";
        waitReady(vncUrl, deadline);
        RecorderVncEndpoint endpoint = new RecorderVncEndpoint(
            "managed",
            vncUrl,
            LOCALHOST,
            gatewayPort,
            containerName,
            vncPort
        );
        endpoints.put(sessionId, endpoint);
        return endpoint;
    }

    @Override
    public void stop(String sessionId) {
        RecorderVncEndpoint endpoint = endpoints.remove(sessionId);
        if (endpoint == null || !properties.isVncRemoveOnStop()) {
            return;
        }
        podman(List.of("rm", "-f", endpoint.containerName()), 30000, true);
    }

    @Override
    public void stopAll() {
        new ArrayList<>(endpoints.keySet()).forEach(this::stop);
    }

    private int hostPort(String containerName, int containerPort) {
        String output = podman(List.of(
            "inspect",
            containerName,
            "--format",
            "{{(index .NetworkSettings.Ports \"" + containerPort + "/tcp\" 0).HostPort}}"
        ), 15000, false);
        try {
            return Integer.parseInt(output);
        } catch (NumberFormatException e) {
            throw new RecorderBrowserException(
                "daemon_unavailable",
                "failed to resolve VNC container port " + containerPort + ": " + output
            );
        }
    }

    private void waitReady(String url, long deadline) {
        while (System.currentTimeMillis() < deadline) {
            try {
                HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofMillis(1500))
                    .GET()
                    .build();
                HttpResponse<Void> response = httpClient.send(request, HttpResponse.BodyHandlers.discarding());
                if (response.statusCode() >= 200 && response.statusCode() < 300) {
                    return;
                }
            } catch (IOException e) {
                // Retry until deadline.
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RecorderBrowserException("daemon_unavailable", "VNC readiness interrupted");
            }
            try {
                Thread.sleep(400);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RecorderBrowserException("daemon_unavailable", "VNC readiness interrupted");
            }
        }
        throw new RecorderBrowserException("daemon_unavailable", "VNC container readiness timed out: " + url);
    }

    private String podman(List<String> args, long timeoutMs, boolean allowFailure) {
        List<String> command = new ArrayList<>();
        command.add(properties.getPodmanBin());
        command.addAll(args);
        ProcessBuilder builder = new ProcessBuilder(command);
        try {
            Process process = builder.start();
            boolean exited = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
            if (!exited) {
                process.destroyForcibly();
                throw new RecorderBrowserException("daemon_unavailable", "podman " + args.getFirst() + " timed out");
            }
            String stdout = read(process.inputReader());
            String stderr = read(process.errorReader());
            if (process.exitValue() == 0) {
                return stdout.trim();
            }
            if (allowFailure) {
                return "";
            }
            throw new RecorderBrowserException(
                "daemon_unavailable",
                "podman " + args.getFirst() + " failed: " + (stderr.isBlank() ? stdout : stderr).trim()
            );
        } catch (IOException e) {
            if (allowFailure) {
                return "";
            }
            throw new RecorderBrowserException("daemon_unavailable", e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RecorderBrowserException("daemon_unavailable", "podman " + args.getFirst() + " interrupted");
        }
    }

    private String read(BufferedReader reader) throws IOException {
        StringBuilder output = new StringBuilder();
        try (reader) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!output.isEmpty()) {
                    output.append('\n');
                }
                output.append(line);
            }
        }
        return output.toString();
    }
}
