package com.iwhalecloud.byai.manager.domain.mail;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandExecutor;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandResult;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import org.springframework.stereotype.Component;

/** Safe, fixed-purpose boundary for the mail runtime connection check. */
@Component
public class MailRuntimeProbe {

    private static final String SCRIPT = "/app/skills/mail/scripts/mailctl.py";
    private static final Duration TIMEOUT = Duration.ofSeconds(30);
    private static final int MAX_OUTPUT_BYTES = 16 * 1024;
    private static final Set<String> CAPABILITIES = Set.of(
        "list", "get", "search", "downloadAttachment", "send", "reply", "delete");
    private static final Pattern CONDITIONAL = Pattern.compile("CONDITIONAL_[A-Z0-9_]{1,48}");

    private final SandboxCommandExecutor executor;
    private final UserSandboxResolver sandboxResolver;
    private final UserService userService;
    private final ObjectMapper objectMapper;

    public MailRuntimeProbe(
            SandboxCommandExecutor executor,
            UserSandboxResolver sandboxResolver,
            UserService userService,
            ObjectMapper objectMapper) {
        this.executor = executor;
        this.sandboxResolver = sandboxResolver;
        this.userService = userService;
        this.objectMapper = objectMapper.copy()
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }

    public Result check(Long userId, Long accountId) {
        if (userId == null || userId <= 0 || accountId == null || accountId <= 0) {
            throw new IllegalArgumentException("邮箱账号ID不能为空");
        }
        SandboxCommandResult commandResult;
        try {
            Users user = userService.findById(userId);
            if (user == null || user.getUserCode() == null || user.getUserCode().isBlank()) {
                throw new InfrastructureUnavailableException();
            }
            String sandboxId = sandboxResolver.resolve(user.getUserCode(), "openclaw").sandboxId();
            SandboxCommandRequest request = new SandboxCommandRequest(
                List.of("python3", SCRIPT, "check", "--account", accountId.toString()),
                Map.of(), null, TIMEOUT, MAX_OUTPUT_BYTES, false);
            commandResult = executor.run(sandboxId, request);
        } catch (RuntimeException e) {
            if (e instanceof InfrastructureUnavailableException unavailableException) {
                throw unavailableException;
            }
            throw new InfrastructureUnavailableException();
        }
        if (commandResult == null) {
            throw new InfrastructureUnavailableException();
        }
        if (commandResult.timedOut() || commandResult.truncated()
            || commandResult.stderr() == null || !commandResult.stderr().isEmpty()) {
            return unavailable();
        }
        try {
            JsonNode root = parseOneLine(commandResult.stdout());
            if (commandResult.exitCode() != 0) {
                return parseFailure(root, accountId);
            }
            return parseSuccess(root, accountId);
        } catch (RuntimeException e) {
            return unavailable();
        }
    }

    private JsonNode parseOneLine(String output) {
        if (output == null || output.isEmpty() || output.length() > MAX_OUTPUT_BYTES) {
            throw invalidOutput();
        }
        String line = output.endsWith("\n") ? output.substring(0, output.length() - 1) : output;
        if (line.isEmpty() || line.indexOf('\n') >= 0 || line.indexOf('\r') >= 0) {
            throw invalidOutput();
        }
        try {
            return objectMapper.readTree(line);
        } catch (Exception e) {
            throw invalidOutput();
        }
    }

    private Result parseSuccess(JsonNode root, Long accountId) {
        requireObjectWithFields(root, Set.of("ok", "operation", "accountId", "data"));
        if (!root.path("ok").isBoolean() || !root.path("ok").booleanValue()
            || !"check".equals(text(root, "operation", 16))
            || !accountId.toString().equals(text(root, "accountId", 128))) {
            throw invalidOutput();
        }
        JsonNode data = root.get("data");
        requireObjectWithFields(data, Set.of("status", "latencyMs", "capabilityStatus"));
        String runtimeStatus = text(data, "status", 16);
        if (!Set.of("NORMAL", "PARTIAL").contains(runtimeStatus)) {
            throw invalidOutput();
        }
        JsonNode latency = data.get("latencyMs");
        if (latency == null || !latency.isIntegralNumber() || !latency.canConvertToLong()
            || latency.longValue() < 0 || latency.longValue() > 3_600_000) {
            throw invalidOutput();
        }
        JsonNode statuses = data.get("capabilityStatus");
        requireObjectWithFields(statuses, CAPABILITIES);
        Map<String, String> capabilityStatus = new LinkedHashMap<>();
        for (String capability : CAPABILITIES) {
            String value = text(statuses, capability, 64);
            if (!"YES".equals(value) && !"NO".equals(value) && !CONDITIONAL.matcher(value).matches()) {
                throw invalidOutput();
            }
            capabilityStatus.put(capability, value);
        }
        boolean partial = "PARTIAL".equals(runtimeStatus)
            || capabilityStatus.values().stream().anyMatch(value -> !"YES".equals(value));
        return new Result(partial ? Status.PARTIAL : Status.NORMAL, latency.longValue(),
            Map.copyOf(capabilityStatus), partial ? "部分邮箱能力暂不可用" : null);
    }

    private Result parseFailure(JsonNode root, Long accountId) {
        requireObjectWithFields(root, Set.of("ok", "operation", "accountId", "error"));
        if (!root.path("ok").isBoolean() || root.path("ok").booleanValue()
            || !"check".equals(text(root, "operation", 16))
            || !accountId.toString().equals(text(root, "accountId", 128))) {
            throw invalidOutput();
        }
        JsonNode error = root.get("error");
        Set<String> fields = fields(error);
        if (!fields.equals(Set.of("code", "message", "retryable", "ambiguous"))
            && !fields.equals(Set.of("code", "message", "retryable", "ambiguous", "retryAfterMs"))) {
            throw invalidOutput();
        }
        String code = text(error, "code", 64);
        text(error, "message", 256);
        if (!error.path("retryable").isBoolean() || !error.path("ambiguous").isBoolean()) {
            throw invalidOutput();
        }
        if (error.has("retryAfterMs") && (!error.get("retryAfterMs").isIntegralNumber()
            || error.get("retryAfterMs").longValue() <= 0 || error.get("retryAfterMs").longValue() > 3_600_000)) {
            throw invalidOutput();
        }
        if ("AUTH_REQUIRED".equals(code) || "AUTH_EXPIRED".equals(code)) {
            return new Result(Status.AUTH_REQUIRED, null, Map.of(), "邮箱需要重新授权");
        }
        return unavailable();
    }

    private void requireObjectWithFields(JsonNode node, Set<String> expected) {
        if (node == null || !node.isObject() || !fields(node).equals(expected)) {
            throw invalidOutput();
        }
    }

    private Set<String> fields(JsonNode node) {
        if (node == null || !node.isObject()) {
            throw invalidOutput();
        }
        Set<String> names = new java.util.HashSet<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }

    private String text(JsonNode node, String field, int maximum) {
        JsonNode value = node.get(field);
        if (value == null || !value.isTextual() || value.textValue().isEmpty()
            || value.textValue().length() > maximum) {
            throw invalidOutput();
        }
        return value.textValue();
    }

    private IllegalArgumentException invalidOutput() {
        return new IllegalArgumentException("Invalid mail runtime response");
    }

    private Result unavailable() {
        return new Result(Status.UNAVAILABLE, null, Map.of(), "邮箱服务暂时不可用，请稍后重试");
    }

    public enum Status {
        NORMAL,
        AUTH_REQUIRED,
        UNAVAILABLE,
        PARTIAL
    }

    public record Result(Status status, Long latencyMs, Map<String, String> capabilityStatus, String safeError) { }

    public static class InfrastructureUnavailableException extends RuntimeException {
        public InfrastructureUnavailableException() {
            super("Mail connection check infrastructure unavailable");
        }
    }
}
