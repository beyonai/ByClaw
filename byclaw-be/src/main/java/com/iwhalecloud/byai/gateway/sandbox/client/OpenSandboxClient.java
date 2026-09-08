package com.iwhalecloud.byai.gateway.sandbox.client;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.StringJoiner;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.ErrorResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.RenewSandboxExpirationRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.ResizeSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.ResizeSandboxResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxDetail;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxEndpoint;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandResult;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxProcessHandle;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxProcessSnapshot;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class OpenSandboxClient {

    private static final Logger log = LoggerFactory.getLogger(OpenSandboxClient.class);
    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");
    private static final Pattern PROCESS_EXIT_CODE_PATTERN = Pattern.compile("(?i)\\bcode\\s+(\\d+)\\b");
    private static final int RAW_COMMAND_OVERHEAD_BYTES = 64 * 1024;
    private static final int MAX_RAW_COMMAND_BYTES = 64 * 1024 * 1024;
    private static final int MAX_COMMAND_ENDPOINT_BYTES = 8 * 1024;

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final ObjectMapper commandEndpointMapper;
    private final SandboxProperties properties;
    private final String baseUrl;
    private final String apiKey;
    private final Duration pollInterval;
    private final Duration pollTimeout;
    private final String endpointScheme;

    public OpenSandboxClient(SandboxProperties properties) {
        this.properties = properties;
        this.baseUrl = normalizeBaseUrl(properties.getOpensandbox().getBaseUrl());
        this.apiKey = properties.getOpensandbox().getApiKey();
        this.pollInterval = properties.getPollInterval();
        this.pollTimeout = properties.getPollTimeout();
        this.endpointScheme = properties.getOpensandbox().getEndpointScheme();

        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(Duration.ofSeconds(30))
                .readTimeout(Duration.ofSeconds(60))
                .writeTimeout(Duration.ofSeconds(60))
                .build();

        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
        this.objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        this.commandEndpointMapper = this.objectMapper.copy()
            .enable(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }

    public CreateSandboxResponse createSandbox(CreateSandboxRequest request) {
        return createSandbox(request, null);
    }

    /**
     * 创建沙箱；若 {@code idempotencyKey} 非空且配置开启，则携带 Idempotency-Key 请求头。
     */
    public CreateSandboxResponse createSandbox(CreateSandboxRequest request, String idempotencyKey) {
        String url = baseUrl + "/v1/sandboxes";
        String body = toJson(request);
        log.debug("OpenSandbox沙箱 POST {} {}", url, createSandboxLogSummary(request));
        Request.Builder rb = newRequestBuilder(url)
                .post(RequestBody.create(body, JSON_MEDIA_TYPE));
        if (idempotencyKey != null
                && !idempotencyKey.isBlank()
                && properties.getOpensandbox().isSendIdempotencyKeyHeader()) {
            rb.header("Idempotency-Key", idempotencyKey.trim());
        }
        return execute(rb.build(), CreateSandboxResponse.class);
    }

    private static String createSandboxLogSummary(CreateSandboxRequest request) {
        if (request == null) {
            return "request=null";
        }
        return "timeout=" + request.getTimeout()
            + " envKeys=" + (request.getEnv() == null
                ? Collections.emptySet() : new TreeSet<>(request.getEnv().keySet()))
            + " metadataKeys=" + (request.getMetadata() == null
                ? Collections.emptySet() : new TreeSet<>(request.getMetadata().keySet()));
    }

    /**
     * 按 userCode、serviceKey（与创建时 metadata 一致）查询已有沙箱。
     * 远端不支持或非 2xx 时返回空列表，不阻断创建流程。
     */
    public List<SandboxDetail> listSandboxes(String userCode, String serviceKey) {
        if (userCode == null || userCode.isBlank() || serviceKey == null || serviceKey.isBlank()) {
            return List.of();
        }
        return listSandboxesByMetadata(Map.of("userCode", userCode, "serviceKey", serviceKey), 1, 100);
    }

    public List<SandboxDetail> listSandboxesByMetadata(Map<String, String> metadata, int pageNo, int pageSize) {
        try {
            return listSandboxesByMetadataStrict(metadata, pageNo, pageSize);
        } catch (OpenSandboxException e) {
            log.debug("listSandboxes failed (will create new if needed): {}", e.getMessage());
            return List.of();
        }
    }

    public List<SandboxDetail> listSandboxesByMetadataStrict(Map<String, String> metadata, int pageNo, int pageSize) {
        SandboxProperties.OpenSandboxConfig cfg = properties.getOpensandbox();
        if (!cfg.isListSandboxesBeforeCreate()) {
            log.debug("OpenSandbox沙箱 listSandboxes skipped (listSandboxesBeforeCreate=false) metadata={}", metadata);
            return List.of();
        }
        if (metadata == null || metadata.isEmpty()) {
            return List.of();
        }
        String path = cfg.getListSandboxesPath();
        if (path == null || path.isBlank()) {
            path = "/v1/sandboxes";
        }
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        HttpUrl base = HttpUrl.parse(baseUrl + path);
        if (base == null) {
            throw new OpenSandboxException("Invalid OpenSandbox list URL: baseUrl=" + baseUrl + " path=" + path);
        }
        HttpUrl.Builder urlBuilder = base.newBuilder()
                .addQueryParameter("page", String.valueOf(Math.max(1, pageNo)))
                .addQueryParameter("pageSize", String.valueOf(Math.max(1, pageSize)));
        String metadataQuery = buildMetadataQuery(metadata);
        if (!metadataQuery.isBlank()) {
            urlBuilder.addQueryParameter("metadata", metadataQuery);
        }
        Request httpRequest = newRequestBuilder(urlBuilder.build().toString()).get().build();
        return executeSandboxesList(httpRequest);
    }

    private static String buildMetadataQuery(Map<String, String> metadata) {
        StringJoiner joiner = new StringJoiner("&");
        addMetadataQueryPart(joiner, metadata, "userCode");
        addMetadataQueryPart(joiner, metadata, "serviceKey");
        metadata.entrySet().stream()
            .filter(OpenSandboxClient::isValidMetadataEntry)
            .filter(entry -> !"userCode".equals(entry.getKey()) && !"serviceKey".equals(entry.getKey()))
            .sorted(Map.Entry.comparingByKey())
            .forEach(entry -> joiner.add(entry.getKey() + "=" + entry.getValue()));
        return joiner.toString();
    }

    private static void addMetadataQueryPart(StringJoiner joiner, Map<String, String> metadata, String key) {
        String value = metadata.get(key);
        if (value != null && !value.isBlank()) {
            joiner.add(key + "=" + value);
        }
    }

    private static boolean isValidMetadataEntry(Map.Entry<String, String> entry) {
        return entry != null
            && entry.getKey() != null
            && !entry.getKey().isBlank()
            && entry.getValue() != null
            && !entry.getValue().isBlank();
    }

    public SandboxDetail getSandbox(String sandboxId) {
        String url = baseUrl + "/v1/sandboxes/" + sandboxId;
        log.debug("OpenSandbox沙箱 GET {}", url);
        Request httpRequest = newRequestBuilder(url).get().build();
        return execute(httpRequest, SandboxDetail.class);
    }

    public SandboxDetail getSandboxIfExists(String sandboxId) {
        SandboxDetail detail = getSandboxIfExistsByUrl(baseUrl + "/v1/sandboxes/" + sandboxId);
        if (detail != null) {
            return detail;
        }
        return getSandboxIfExistsByUrl(baseUrl + "/sandboxes/" + sandboxId);
    }

    private SandboxDetail getSandboxIfExistsByUrl(String url) {
        log.debug("OpenSandbox沙箱 GET(ifExists) {}", url);
        Request httpRequest = newRequestBuilder(url).get().build();
        try (Response response = httpClient.newCall(httpRequest).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            log.debug("OpenSandbox沙箱 GET(ifExists) {} -> status={} body={}", url, response.code(), responseBody);
            if (response.code() == 404) {
                return null;
            }
            if (!response.isSuccessful()) {
                throw new OpenSandboxException("HTTP " + response.code() + ": " + responseBody);
            }
            return objectMapper.readValue(responseBody, SandboxDetail.class);
        } catch (OpenSandboxException e) {
            throw e;
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to call OpenSandbox API: " + httpRequest.url(), e);
        }
    }

    public void deleteSandbox(String sandboxId) {
        String url = baseUrl + "/v1/sandboxes/" + sandboxId;
        log.debug("OpenSandbox沙箱 DELETE {}", url);
        Request httpRequest = newRequestBuilder(url).delete().build();
        try (Response response = httpClient.newCall(httpRequest).execute()) {
            log.debug("OpenSandbox沙箱 DELETE {} -> status={}", url, response.code());
            if (!response.isSuccessful() && response.code() != 404) {
                String responseBody = response.body() != null ? response.body().string() : "";
                throw new OpenSandboxException("Failed to delete sandbox " + sandboxId
                        + ", status=" + response.code() + ", body=" + responseBody);
            }
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to delete sandbox " + sandboxId, e);
        }
    }

    public SandboxEndpoint getSandboxEndpoint(String sandboxId, int port) {
        String url = baseUrl + "/v1/sandboxes/" + sandboxId + "/endpoints/" + port;
        log.debug("OpenSandbox沙箱 GET {}", url);
        Request httpRequest = newRequestBuilder(url).get().build();
        return execute(httpRequest, SandboxEndpoint.class);
    }

    public SandboxCommandResult runCommand(String sandboxId, SandboxCommandRequest request) {
        log.debug("Executing foreground command in sandbox: sandboxId={}, timeoutMs={}",
            sandboxId, request.timeout().toMillis());
        CommandDeadline deadline = commandDeadline(request.timeout());
        String endpoint = resolveCommandEndpoint(sandboxId, remaining(deadline));
        Duration commandBudget = remaining(deadline);
        String body = toJson(commandBody(request, false, Math.max(1L, commandBudget.toMillis())));
        try (Response response = commandCallToEndpoint(endpoint, "/command", body, commandBudget)) {
            String stream = responseBodyBounded(response, rawCommandLimit(request.maxOutputBytes()));
            return parseCommandStream(stream, request.maxOutputBytes(), false);
        } catch (InterruptedIOException e) {
            throw new OpenSandboxCommandTimeoutException();
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to execute command in sandbox " + sandboxId, e);
        }
    }

    public SandboxProcessHandle startCommand(String sandboxId, SandboxCommandRequest request) {
        log.debug("Starting background command in sandbox: sandboxId={}, timeoutMs={}",
            sandboxId, request.timeout().toMillis());
        String body = toJson(commandBody(request, true));
        try (Response response = commandCall(sandboxId, "/command", body, request.timeout())) {
            String stream = responseBodyBounded(response, rawCommandLimit(request.maxOutputBytes()));
            String processId = firstCommandId(stream);
            if (processId == null || processId.isBlank()) {
                throw new OpenSandboxException("OpenSandbox did not return a command id");
            }
            log.debug("Background command started: sandboxId={}, processId={}", sandboxId, processId);
            return new SandboxProcessHandle(sandboxId, processId, Instant.now());
        } catch (InterruptedIOException e) {
            throw new OpenSandboxCommandTimeoutException();
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to start command in sandbox " + sandboxId, e);
        }
    }

    public SandboxProcessSnapshot getCommandStatus(String sandboxId, String processId) {
        log.debug("Inspecting sandbox command: sandboxId={}, processId={}", sandboxId, processId);
        String endpoint = resolveExecdEndpoint(sandboxId);
        Request request = newExecdRequestBuilder(endpoint + "/command/status/" + encodePath(processId)).get().build();
        try (Response response = httpClient.newCall(request).execute()) {
            String body = responseBody(response);
            if (response.code() == 404) {
                return new SandboxProcessSnapshot(SandboxProcessSnapshot.State.NOT_FOUND, null, "", 0, false);
            }
            ensureSuccessful(response, body);
            JsonNode root = objectMapper.readTree(body);
            boolean running = root.path("running").asBoolean(false);
            Integer exitCode = root.has("exit_code") && !root.get("exit_code").isNull()
                ? root.get("exit_code").asInt() : null;
            return new SandboxProcessSnapshot(
                running ? SandboxProcessSnapshot.State.RUNNING
                    : (exitCode != null && exitCode == 0
                        ? SandboxProcessSnapshot.State.EXITED : SandboxProcessSnapshot.State.FAILED),
                exitCode,
                root.path("error").asText(""),
                0,
                false);
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to inspect command " + processId, e);
        }
    }

    public SandboxProcessSnapshot getCommandLogs(String sandboxId, String processId, long cursor) {
        log.debug("Reading sandbox command output: sandboxId={}, processId={}, cursor={}",
            sandboxId, processId, cursor);
        String endpoint = resolveExecdEndpoint(sandboxId);
        HttpUrl url = HttpUrl.parse(endpoint + "/command/" + encodePath(processId) + "/logs")
            .newBuilder().addQueryParameter("cursor", Long.toString(Math.max(0, cursor))).build();
        Request request = newExecdRequestBuilder(url.toString()).get().build();
        try (Response response = httpClient.newCall(request).execute()) {
            String output = responseBody(response);
            if (response.code() == 404) {
                return new SandboxProcessSnapshot(SandboxProcessSnapshot.State.NOT_FOUND, null, "", cursor, false);
            }
            ensureSuccessful(response, output);
            String nextCursor = response.header("EXECD-COMMANDS-TAIL-CURSOR");
            long parsedCursor = nextCursor == null ? cursor : Long.parseLong(nextCursor);
            return new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, output,
                parsedCursor, false);
        } catch (IOException | NumberFormatException e) {
            throw new OpenSandboxException("Failed to read command logs " + processId, e);
        }
    }

    public void interruptCommand(String sandboxId, String processId) {
        log.info("Terminating sandbox command: sandboxId={}, processId={}", sandboxId, processId);
        String endpoint = resolveExecdEndpoint(sandboxId);
        HttpUrl url = HttpUrl.parse(endpoint + "/command").newBuilder()
            .addQueryParameter("id", processId).build();
        Request request = newExecdRequestBuilder(url.toString()).delete().build();
        try (Response response = httpClient.newCall(request).execute()) {
            String body = responseBody(response);
            if (!response.isSuccessful() && response.code() != 404) {
                throw new OpenSandboxException("Failed to terminate command " + processId + ": " + body);
            }
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to terminate command " + processId, e);
        }
    }

    private Response commandCall(String sandboxId, String path, String body, Duration timeout) throws IOException {
        String endpoint = resolveExecdEndpoint(sandboxId);
        return commandCallToEndpoint(endpoint, path, body, timeout);
    }

    private Response commandCallToEndpoint(String endpoint, String path, String body, Duration timeout)
            throws IOException {
        Request request = newExecdRequestBuilder(endpoint + path)
            .post(RequestBody.create(body, JSON_MEDIA_TYPE)).build();
        okhttp3.Call call = httpClient.newCall(request);
        call.timeout().timeout(timeout.toNanos(), TimeUnit.NANOSECONDS);
        Response response = call.execute();
        if (!response.isSuccessful()) {
            response.close();
            throw new OpenSandboxException("OpenSandbox command failed: HTTP " + response.code());
        }
        return response;
    }

    private String resolveExecdEndpoint(String sandboxId) {
        SandboxEndpoint endpoint = getSandboxEndpoint(sandboxId, properties.getOpensandbox().getExecdPort());
        if (endpoint == null || endpoint.getEndpoint() == null || endpoint.getEndpoint().isBlank()) {
            throw new OpenSandboxException("OpenSandbox Execd endpoint is unavailable for sandbox " + sandboxId);
        }
        String value = endpoint.getEndpoint().trim();
        log.debug("Resolved sandbox Execd endpoint: sandboxId={}, endpointPort={}",
            sandboxId, properties.getOpensandbox().getExecdPort());
        return value.startsWith("http://") || value.startsWith("https://")
            ? value.replaceAll("/$", "")
            : properties.getOpensandbox().getEndpointScheme() + "://" + value;
    }

    private String resolveCommandEndpoint(String sandboxId, Duration timeout) {
        String url = baseUrl + "/v1/sandboxes/" + sandboxId + "/endpoints/"
            + properties.getOpensandbox().getExecdPort();
        Request request = newRequestBuilder(url).get().build();
        okhttp3.Call call = httpClient.newCall(request);
        call.timeout().timeout(timeout.toNanos(), TimeUnit.NANOSECONDS);
        try (Response response = call.execute()) {
            String body;
            try {
                body = decodeCommandEndpoint(responseBytesBounded(response, MAX_COMMAND_ENDPOINT_BYTES));
            } catch (OpenSandboxOutputLimitException e) {
                throw new OpenSandboxEndpointInvalidResponseException();
            }
            if (!response.isSuccessful()) {
                throw new OpenSandboxEndpointUnavailableException();
            }
            return parseCommandEndpoint(body);
        } catch (InterruptedIOException e) {
            throw new OpenSandboxCommandTimeoutException();
        } catch (OpenSandboxException e) {
            throw e;
        } catch (IOException e) {
            throw new OpenSandboxEndpointUnavailableException();
        }
    }

    private String parseCommandEndpoint(String body) {
        try {
            JsonNode root = commandEndpointMapper.readTree(body);
            if (root == null || !root.isObject()) {
                throw new OpenSandboxEndpointInvalidResponseException();
            }
            java.util.Set<String> fields = new java.util.HashSet<>();
            root.fieldNames().forEachRemaining(fields::add);
            if (!fields.equals(java.util.Set.of("endpoint", "headers"))
                    || !root.path("endpoint").isTextual() || !root.path("headers").isObject()) {
                throw new OpenSandboxEndpointInvalidResponseException();
            }
            String value = root.path("endpoint").textValue().trim();
            if (value.isEmpty() || value.length() > 2048 || value.chars().anyMatch(
                    character -> character < 32 || character == 127)) {
                throw new OpenSandboxEndpointInvalidResponseException();
            }
            var headers = root.path("headers").fields();
            while (headers.hasNext()) {
                var header = headers.next();
                if (header.getKey().isBlank() || header.getKey().length() > 256
                        || !header.getValue().isTextual() || header.getValue().textValue().length() > 4096) {
                    throw new OpenSandboxEndpointInvalidResponseException();
                }
            }
            String resolved = value.startsWith("http://") || value.startsWith("https://")
                ? value : properties.getOpensandbox().getEndpointScheme() + "://" + value;
            HttpUrl parsed = HttpUrl.parse(resolved);
            if (parsed == null || !("http".equals(parsed.scheme()) || "https".equals(parsed.scheme()))) {
                throw new OpenSandboxEndpointInvalidResponseException();
            }
            log.debug("Resolved command endpoint: sandboxIdPresent={}, endpointPort={}",
                true, properties.getOpensandbox().getExecdPort());
            return resolved.replaceAll("/$", "");
        } catch (OpenSandboxEndpointInvalidResponseException e) {
            throw e;
        } catch (IOException | RuntimeException e) {
            throw new OpenSandboxEndpointInvalidResponseException();
        }
    }

    private CommandDeadline commandDeadline(Duration timeout) {
        if (timeout == null || timeout.isZero() || timeout.isNegative()) {
            throw new OpenSandboxCommandTimeoutException();
        }
        long duration;
        try {
            duration = timeout.toNanos();
        } catch (ArithmeticException e) {
            duration = Long.MAX_VALUE;
        }
        return new CommandDeadline(System.nanoTime(), duration);
    }

    private Duration remaining(CommandDeadline deadline) {
        long elapsed = System.nanoTime() - deadline.startedAtNanos();
        long nanos = deadline.timeoutNanos() - elapsed;
        if (nanos <= 0) {
            throw new OpenSandboxCommandTimeoutException();
        }
        return Duration.ofNanos(nanos);
    }

    private record CommandDeadline(long startedAtNanos, long timeoutNanos) { }

    private Map<String, Object> commandBody(SandboxCommandRequest request, boolean background) {
        return commandBody(request, background, request.timeout().toMillis());
    }

    private Map<String, Object> commandBody(SandboxCommandRequest request, boolean background, long timeoutMillis) {
        return Map.of(
            "command", shellCommand(request.argv()),
            "background", background,
            "timeout", timeoutMillis,
            "envs", request.environment());
    }

    private String shellCommand(List<String> argv) {
        return argv.stream().map(this::shellQuote).collect(java.util.stream.Collectors.joining(" "));
    }

    private String shellQuote(String value) {
        return "'" + value.replace("'", "'\\''") + "'";
    }

    private String firstCommandId(String stream) {
        try {
            for (String line : stream.split("\\R")) {
                JsonNode node = commandEventNode(line);
                if (node == null) {
                    continue;
                }
                String id = firstText(node, "id", "command_id", "commandId");
                if (id == null && "init".equals(node.path("type").asText(""))) {
                    id = firstText(node, "text");
                }
                if (id != null) {
                    return id;
                }
            }
        } catch (IOException ignored) {
            // The caller turns a missing id into a stable execution error.
        }
        return null;
    }

    private SandboxCommandResult parseCommandStream(String stream, int maxOutputBytes, boolean ignored) {
        StringBuilder stdout = new StringBuilder();
        StringBuilder stderr = new StringBuilder();
        StringBuilder commandError = new StringBuilder();
        int exitCode = 0;
        try {
            for (String line : stream.split("\\R")) {
                JsonNode node = commandEventNode(line);
                if (node == null) {
                    continue;
                }
                String type = node.path("type").asText("");
                String text = commandEventText(node);
                if ("stderr".equals(type)) {
                    stderr.append(text);
                } else if ("error".equals(type) || node.has("error")) {
                    commandError.append(text);
                } else if ("stdout".equals(type) || "result".equals(type)) {
                    stdout.append(text);
                }
                exitCode = commandExitCode(node, exitCode);
            }
        } catch (IOException e) {
            throw new OpenSandboxException("Invalid OpenSandbox command stream", e);
        }
        if (stderr.isEmpty() && !commandError.isEmpty()) {
            stderr.append(commandError);
        }
        int outputBytes = utf8Length(stdout) + utf8Length(stderr);
        if (outputBytes > maxOutputBytes) {
            throw new OpenSandboxOutputLimitException();
        }
        return new SandboxCommandResult(exitCode, stdout.toString(), stderr.toString(), false, false);
    }

    private JsonNode commandEventNode(String line) throws IOException {
        String payload = line == null ? "" : line.trim();
        if (payload.startsWith("data:")) {
            payload = payload.substring(5).trim();
        }
        if (payload.isBlank() || !payload.startsWith("{")) {
            return null;
        }
        return objectMapper.readTree(payload);
    }

    private int commandExitCode(JsonNode node, int currentExitCode) {
        if (node.has("exit_code")) {
            return node.path("exit_code").asInt(currentExitCode);
        }
        if (node.has("exitCode")) {
            return node.path("exitCode").asInt(currentExitCode);
        }
        JsonNode error = node.get("error");
        if (error == null || error.isNull()) {
            return currentExitCode;
        }
        Matcher matcher = PROCESS_EXIT_CODE_PATTERN.matcher(error.path("evalue").asText(""));
        if (matcher.find()) {
            return Integer.parseInt(matcher.group(1));
        }
        return currentExitCode == 0 ? 1 : currentExitCode;
    }

    private String commandEventText(JsonNode node) {
        for (String field : List.of("text", "output", "message", "data")) {
            JsonNode value = node.get(field);
            if (value == null || value.isNull()) {
                continue;
            }
            return value.isTextual() ? value.asText() : value.toString();
        }
        JsonNode error = node.get("error");
        return error == null || error.isNull() ? "" : error.toString();
    }

    private String responseBody(Response response) throws IOException {
        return response.body() == null ? "" : response.body().string();
    }

    private String responseBodyBounded(Response response, int maximumBytes) throws IOException {
        return new String(responseBytesBounded(response, maximumBytes), java.nio.charset.StandardCharsets.UTF_8);
    }

    private byte[] responseBytesBounded(Response response, int maximumBytes) throws IOException {
        if (response.body() == null) {
            return new byte[0];
        }
        try (InputStream input = response.body().byteStream();
                ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(maximumBytes, 8192))) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (read > maximumBytes - total) {
                    throw new OpenSandboxOutputLimitException();
                }
                output.write(buffer, 0, read);
                total += read;
            }
            return output.toByteArray();
        }
    }

    private String decodeCommandEndpoint(byte[] bytes) {
        try {
            return java.nio.charset.StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString();
        } catch (CharacterCodingException e) {
            throw new OpenSandboxEndpointInvalidResponseException();
        }
    }

    private int rawCommandLimit(int maxOutputBytes) {
        if (maxOutputBytes < 1) {
            throw new IllegalArgumentException("maxOutputBytes must be positive");
        }
        long escaped = (long) maxOutputBytes * 6L + RAW_COMMAND_OVERHEAD_BYTES;
        return (int) Math.min(MAX_RAW_COMMAND_BYTES, escaped);
    }

    private int utf8Length(CharSequence value) {
        return value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
    }

    private void ensureSuccessful(Response response, String body) {
        if (!response.isSuccessful()) {
            throw new OpenSandboxException("OpenSandbox command API failed: HTTP " + response.code() + " " + body);
        }
    }

    private String encodePath(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
    }

    private String firstText(JsonNode node, String... names) {
        for (String name : names) {
            if (node.has(name) && node.get(name).isTextual() && !node.get(name).asText().isBlank()) {
                return node.get(name).asText();
            }
        }
        return null;
    }

    public ResizeSandboxResponse resizeSandbox(String sandboxId, ResizeSandboxRequest request) {
        String url = baseUrl + "/v1/sandboxes/" + sandboxId + "/resize";
        String body = toJson(request);
        log.debug("OpenSandbox沙箱 POST {} body={}", url, body);
        Request httpRequest = newRequestBuilder(url)
            .post(RequestBody.create(body, JSON_MEDIA_TYPE))
            .build();
        return execute(httpRequest, ResizeSandboxResponse.class);
    }

    /**
     * 续期沙箱过期时间。
     */
    public void renewExpiration(String sandboxId, RenewSandboxExpirationRequest request) {
        String url = baseUrl + "/v1/sandboxes/" + sandboxId + "/renew-expiration";
        String body = toJson(request);
        log.debug("OpenSandbox沙箱 POST {} body={}", url, body);
        Request httpRequest = newRequestBuilder(url)
                .post(RequestBody.create(body, JSON_MEDIA_TYPE))
                .build();
        try (Response response = httpClient.newCall(httpRequest).execute()) {
            log.debug("OpenSandbox沙箱 POST {} -> status={}", url, response.code());
            if (!response.isSuccessful()) {
                String responseBody = response.body() != null ? response.body().string() : "";
                throw new OpenSandboxException("Failed to renew expiration for sandbox " + sandboxId
                        + ", status=" + response.code() + ", body=" + responseBody);
            }
        } catch (OpenSandboxException e) {
            throw e;
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to renew expiration for sandbox " + sandboxId, e);
        }
    }

    /**
     * 轮询等待沙箱进入 Running 状态。
     * 如果进入 Failed/Terminated 状态则抛出异常。
     */
    public SandboxDetail waitForRunning(String sandboxId, String endpoint) {
        return waitForRunning(sandboxId, endpoint, null);
    }

    /**
     * Poll until sandbox endpoint is ready.
     *
     * If {@code endpoint} already contains scheme (http/https), we use it as-is.
     * Otherwise we apply {@code protocol} (if not blank) or fall back to {@link #endpointScheme}.
     */
    public SandboxDetail waitForRunning(String sandboxId, String endpoint, String protocol) {
        long startTime = System.currentTimeMillis();
        long timeoutMs = pollTimeout.toMillis();
        long intervalMs = pollInterval.toMillis();
        String url;
        if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
            url = endpoint;
        } else {
            String scheme = (protocol != null && !protocol.isBlank()) ? protocol : endpointScheme;
            url = scheme + "://" + endpoint;
        }
        while (System.currentTimeMillis() - startTime < timeoutMs) {
            Request httpRequest = new Request.Builder().url(url).get().build();
            try (Response response = httpClient.newCall(httpRequest).execute()) {
                if (response.isSuccessful() && response.code() == 200) {
                    log.debug("Endpoint {} returned 200, sandbox {} is ready", endpoint, sandboxId);
                    return getSandbox(sandboxId);
                }
                log.debug("Endpoint {} returned {}, sandbox {} not ready", endpoint, response.code(), sandboxId);
            } catch (IOException e) {
                log.debug("Endpoint {} request failed: {}, sandbox {} not ready", endpoint, e.getMessage(), sandboxId);
            }

            try {
                Thread.sleep(intervalMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new OpenSandboxException("Interrupted while waiting for sandbox " + sandboxId, e);
            }
        }
        throw new OpenSandboxException("Timeout waiting for sandbox " + sandboxId
                + " to become ready after " + pollTimeout.toSeconds() + "s");
    }

    private Request.Builder newRequestBuilder(String url) {
        Request.Builder builder = new Request.Builder().url(url);
        if (apiKey != null && !apiKey.isBlank()) {
//            builder.header("Authorization", "Bearer " + apiKey);
            builder.header("OPEN-SANDBOX-API-KEY", apiKey);
        }
        return builder;
    }

    private Request.Builder newExecdRequestBuilder(String url) {
        Request.Builder builder = newRequestBuilder(url);
        if (apiKey != null && !apiKey.isBlank()) {
            builder.header("X-EXECD-ACCESS-TOKEN", apiKey);
        }
        return builder;
    }

    private <T> T execute(Request request, Class<T> responseType) {
        log.debug("OpenSandbox沙箱 {} {}", request.method(), request.url());
        try (Response response = httpClient.newCall(request).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            log.debug("OpenSandbox沙箱 {} {} -> status={} body={}", request.method(), request.url(), response.code(), responseBody);
            if (!response.isSuccessful()) {
                ErrorResponse error = null;
                try {
                    error = objectMapper.readValue(responseBody, ErrorResponse.class);
                } catch (Exception ignored) {
                }
                String msg = error != null
                        ? error.getCode() + ": " + error.getMessage()
                        : "HTTP " + response.code() + ": " + responseBody;
                throw new OpenSandboxException("OpenSandbox API error: " + msg);
            }
            return objectMapper.readValue(responseBody, responseType);
        } catch (OpenSandboxException e) {
            throw e;
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to call OpenSandbox API: " + request.url(), e);
        }
    }

    private List<SandboxDetail> executeSandboxesList(Request request) {
        log.debug("OpenSandbox沙箱 GET {}", request.url());
        try (Response response = httpClient.newCall(request).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            log.debug("OpenSandbox沙箱 GET {} -> status={} body={}", request.url(), response.code(), responseBody);
            if (!response.isSuccessful()) {
                throw new OpenSandboxException("HTTP " + response.code() + ": " + responseBody);
            }
            return parseSandboxesListBody(responseBody);
        } catch (OpenSandboxException e) {
            throw e;
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to list sandboxes: " + request.url(), e);
        }
    }

    private List<SandboxDetail> parseSandboxesListBody(String body) throws IOException {
        if (body == null) {
            return List.of();
        }
        String trimmed = body.trim();
        if (trimmed.isEmpty()) {
            return List.of();
        }
        if (trimmed.startsWith("[")) {
            return objectMapper.readValue(trimmed, new TypeReference<List<SandboxDetail>>() {});
        }
        JsonNode root = objectMapper.readTree(trimmed);
        if (root.isArray()) {
            return objectMapper.convertValue(root, new TypeReference<List<SandboxDetail>>() {});
        }
        for (String field : List.of("items", "sandboxes", "data", "results")) {
            JsonNode arr = root.get(field);
            if (arr != null && arr.isArray()) {
                return objectMapper.convertValue(arr, new TypeReference<List<SandboxDetail>>() {});
            }
        }
        return Collections.emptyList();
    }

    private String toJson(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to serialize request", e);
        }
    }

    private String normalizeBaseUrl(String url) {
        return url != null && url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    public static class OpenSandboxException extends RuntimeException {
        public OpenSandboxException(String message) {
            super(message);
        }

        public OpenSandboxException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public static class OpenSandboxCommandTimeoutException extends OpenSandboxException {
        public OpenSandboxCommandTimeoutException() {
            super("OpenSandbox command timed out");
        }
    }

    public static class OpenSandboxOutputLimitException extends OpenSandboxException {
        public OpenSandboxOutputLimitException() {
            super("OpenSandbox command output exceeded the configured limit");
        }
    }

    public static class OpenSandboxEndpointUnavailableException extends OpenSandboxException {
        public OpenSandboxEndpointUnavailableException() {
            super("OpenSandbox command endpoint is unavailable");
        }
    }

    public static class OpenSandboxEndpointInvalidResponseException extends OpenSandboxException {
        public OpenSandboxEndpointInvalidResponseException() {
            super("OpenSandbox command endpoint response is invalid");
        }
    }
}
