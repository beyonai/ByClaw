package com.iwhalecloud.byai.manager.domain.connector.provider.ima;

import java.time.Duration;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialFormProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifier;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialFormVerification;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorManifestService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

/** IMA OpenAPI key-pair probe. Secrets are passed only through the child environment. */
@Component
public class ImaOpenApiCliCredentialProvider implements ConnectorCredentialFormProvider, ConnectorCredentialVerifier {

    public static final String PROVIDER_CODE = "ima-openapi";
    public static final String CLIENT_ID = "IMA_OPENAPI_CLIENTID";
    public static final String API_KEY = "IMA_OPENAPI_APIKEY";
    private static final List<String> CHECK_COMMAND = List.of("ima", "auth", "check", "--test", "--json");
    private static final Duration CHECK_TIMEOUT = Duration.ofSeconds(30);
    private static final Duration RUNTIME_COMMAND_TIMEOUT = Duration.ofSeconds(120);
    private static final int RUNTIME_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
    private static final List<String> MANAGED_KEYS = List.of(CLIENT_ID, API_KEY);
    private static final Set<String> SENSITIVE_OUTPUT_FIELDS = Set.of(
        "apikey", "authorization", "coscredential", "secretid", "secretkey", "securitytoken",
        "sessiontoken", "signature", "token");

    private final ConnectorCliRunner cliRunner;
    private final ConnectorManifestService manifestService;
    private final ObjectMapper objectMapper;

    public ImaOpenApiCliCredentialProvider(ConnectorCliRunner cliRunner) {
        this(cliRunner, null, new ObjectMapper());
    }

    @Autowired
    public ImaOpenApiCliCredentialProvider(
            ConnectorCliRunner cliRunner,
            ConnectorManifestService manifestService) {
        this(cliRunner, manifestService, new ObjectMapper());
    }

    ImaOpenApiCliCredentialProvider(
            ConnectorCliRunner cliRunner,
            ConnectorManifestService manifestService,
            ObjectMapper objectMapper) {
        this.cliRunner = cliRunner;
        this.manifestService = manifestService;
        this.objectMapper = objectMapper.copy().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }

    @Override
    public String providerCode() {
        return PROVIDER_CODE;
    }

    @Override
    public CredentialFormVerification verify(String userId, ConnectorInfo connector, Map<String, String> credentials) {
        Map<String, String> environment = validateCredentials(credentials);
        return new CredentialFormVerification(probe(environment), environment);
    }

    @Override
    public AuthorizationStatusResult verify(Long userId, ConnectorInfo connector) {
        if (userId == null || manifestService == null) {
            return invalid();
        }
        Map<String, String> environment;
        try {
            environment = manifestService.readManagedCredentialsForVerification(userId, connector, SetHolder.KEYS);
        } catch (RuntimeException e) {
            return invalid();
        }
        if (!environment.keySet().equals(SetHolder.KEYS)) {
            return invalid();
        }
        try {
            validateCredentials(Map.of("clientId", environment.get(CLIENT_ID), "apiKey", environment.get(API_KEY)));
        } catch (RuntimeException e) {
            return invalid();
        }
        return probe(environment);
    }

    /** Runs one IMA business command with credentials that remain in the backend child environment. */
    public RuntimeCommandResult executeRuntimeCommand(Map<String, String> environment, List<String> argv) {
        List<String> command = runtimeCommand(argv);
        Map<String, String> safeEnvironment = runtimeEnvironment(environment);
        java.nio.file.Path configDir = null;
        ConnectorCliRunner.CliResult result;
        try {
            configDir = java.nio.file.Files.createTempDirectory("ima-runtime-config-");
            Map<String, String> commandEnvironment = new LinkedHashMap<>(safeEnvironment);
            commandEnvironment.put("IMA_CONFIG_DIR", configDir.toString());
            result = cliRunner.run(
                command, Map.copyOf(commandEnvironment), null, RUNTIME_COMMAND_TIMEOUT, RUNTIME_MAX_OUTPUT_BYTES);
        } catch (java.io.IOException e) {
            return RuntimeCommandResult.failed("IMA_CLI_UNAVAILABLE");
        } catch (RuntimeException e) {
            return RuntimeCommandResult.failed("IMA_CLI_UNAVAILABLE");
        } finally {
            deleteRuntimeConfig(configDir);
        }
        if (result == null) {
            return RuntimeCommandResult.failed("IMA_CLI_UNAVAILABLE");
        }
        if (result.exitCode() == 124) {
            return RuntimeCommandResult.failed("IMA_COMMAND_TIMEOUT");
        }
        if (result.exitCode() != 0) {
            return RuntimeCommandResult.completed(result.exitCode(), null);
        }
        if (result.truncated()) {
            return RuntimeCommandResult.failed("IMA_RESULT_TOO_LARGE");
        }
        JsonNode output = parseRuntimeOutput(result.output(), safeEnvironment);
        return output == null
            ? RuntimeCommandResult.failed("IMA_CLI_PROTOCOL_ERROR")
            : RuntimeCommandResult.completed(0, output);
    }

    private AuthorizationStatusResult probe(Map<String, String> environment) {
        ConnectorCliRunner.CliResult result;
        try {
            result = cliRunner.run(CHECK_COMMAND, environment, null, CHECK_TIMEOUT);
        } catch (RuntimeException e) {
            return unavailable(e) ? failed("CONNECTOR_CLI_UNAVAILABLE") : failed("CONNECTOR_CREDENTIAL_INVALID");
        }
        if (result == null) {
            return failed("CONNECTOR_CREDENTIAL_INVALID");
        }
        if (result.exitCode() == 124) {
            return failed("CONNECTOR_VERIFICATION_TIMEOUT");
        }
        if (result.exitCode() != 0) {
            return failed("CONNECTOR_CREDENTIAL_INVALID");
        }
        if (result.truncated() || !validSuccessPayload(result.output())) {
            return failed("PROVIDER_PROTOCOL_ERROR");
        }
        return AuthorizationStatusResult.connected(
            null, "IMA", CredentialState.READY, CredentialRenewalMode.NONE, null, null, new Date(), null);
    }

    private boolean validSuccessPayload(String output) {
        if (output == null || output.isBlank()) {
            return false;
        }
        try {
            JsonNode root = objectMapper.readTree(output);
            JsonNode checks = root == null ? null : root.get("checks");
            return root != null && root.isObject() && "ok".equals(root.path("status").textValue())
                && checks != null && checks.isObject()
                && checks.path("client_id_present").isBoolean() && checks.path("client_id_present").booleanValue()
                && checks.path("api_key_present").isBoolean() && checks.path("api_key_present").booleanValue()
                && checks.path("token_fetch").isBoolean() && checks.path("token_fetch").booleanValue();
        } catch (RuntimeException | java.io.IOException e) {
            return false;
        }
    }

    private List<String> runtimeCommand(List<String> argv) {
        if (argv == null || argv.size() < 2 || argv.size() > 32 || !argv.contains("--json")) {
            throw new IllegalArgumentException("Unsupported IMA command");
        }
        java.util.ArrayList<String> command = new java.util.ArrayList<>(argv.size() + 1);
        command.add("ima");
        for (String value : argv) {
            if (value == null || value.isBlank() || value.indexOf('\0') >= 0) {
                throw new IllegalArgumentException("Unsupported IMA command");
            }
            command.add(value.trim());
        }
        if ("auth".equals(argv.getFirst())) {
            if (argv.size() != 4 || !"check".equals(argv.get(1)) || !"--test".equals(argv.get(2))
                    || !"--json".equals(argv.get(3))) {
                throw new IllegalArgumentException("Unsupported IMA command");
            }
        } else if (!"note".equals(argv.getFirst()) && !"wiki".equals(argv.getFirst())) {
            throw new IllegalArgumentException("Unsupported IMA command");
        }
        return List.copyOf(command);
    }

    private Map<String, String> runtimeEnvironment(Map<String, String> environment) {
        if (environment == null || !environment.keySet().equals(SetHolder.KEYS)) {
            throw new IllegalArgumentException("IMA runtime credentials are invalid");
        }
        String clientId = environment.get(CLIENT_ID);
        String apiKey = environment.get(API_KEY);
        validateValue(clientId, 256, "clientId");
        validateValue(apiKey, 2048, "apiKey");
        Map<String, String> copy = new LinkedHashMap<>();
        copy.put(CLIENT_ID, clientId);
        copy.put(API_KEY, apiKey);
        return Map.copyOf(copy);
    }

    private JsonNode parseRuntimeOutput(String output, Map<String, String> environment) {
        if (output == null || output.isBlank()) {
            return null;
        }
        try {
            JsonNode root = objectMapper.readTree(output);
            if (root == null) {
                return null;
            }
            return sanitizeOutput(root, environment.get(CLIENT_ID), environment.get(API_KEY));
        } catch (java.io.IOException | RuntimeException e) {
            return null;
        }
    }

    private JsonNode sanitizeOutput(JsonNode node, String clientId, String apiKey) {
        if (node.isObject()) {
            ObjectNode sanitized = JsonNodeFactory.instance.objectNode();
            node.fields().forEachRemaining(field -> {
                if (!SENSITIVE_OUTPUT_FIELDS.contains(normalizeFieldName(field.getKey()))) {
                    sanitized.set(field.getKey(), sanitizeOutput(field.getValue(), clientId, apiKey));
                }
            });
            return sanitized;
        }
        if (node.isArray()) {
            ArrayNode sanitized = JsonNodeFactory.instance.arrayNode();
            node.forEach(value -> sanitized.add(sanitizeOutput(value, clientId, apiKey)));
            return sanitized;
        }
        if (node.isTextual()) {
            return JsonNodeFactory.instance.textNode(node.textValue().replace(clientId, "***").replace(apiKey, "***"));
        }
        return node.deepCopy();
    }

    private String normalizeFieldName(String value) {
        return value.replaceAll("[^a-zA-Z0-9]", "").toLowerCase(java.util.Locale.ROOT);
    }

    private void deleteRuntimeConfig(java.nio.file.Path configDir) {
        if (configDir == null) {
            return;
        }
        try (java.util.stream.Stream<java.nio.file.Path> paths = java.nio.file.Files.walk(configDir)) {
            paths.sorted(java.util.Comparator.reverseOrder()).forEach(path -> {
                try {
                    java.nio.file.Files.deleteIfExists(path);
                } catch (java.io.IOException ignored) {
                    // The OS will eventually clean an inaccessible temporary runtime directory.
                }
            });
        } catch (java.io.IOException ignored) {
            // The CLI has already finished; cleanup failure must not alter its result.
        }
    }

    private Map<String, String> validateCredentials(Map<String, String> credentials) {
        if (credentials == null || !credentials.keySet().equals(SetHolder.FORM_KEYS)) {
            throw new IllegalArgumentException("IMA credentials must include exactly clientId and apiKey");
        }
        String clientId = credentials.get("clientId");
        String apiKey = credentials.get("apiKey");
        validateValue(clientId, 256, "clientId");
        validateValue(apiKey, 2048, "apiKey");
        Map<String, String> environment = new LinkedHashMap<>();
        environment.put(CLIENT_ID, clientId);
        environment.put(API_KEY, apiKey);
        return Map.copyOf(environment);
    }

    private void validateValue(String value, int maxLength, String field) {
        if (value == null || value.trim().isEmpty() || value.length() > maxLength) {
            throw new IllegalArgumentException("IMA " + field + " is invalid");
        }
        for (int i = 0; i < value.length(); i++) {
            if (Character.isISOControl(value.charAt(i))) {
                throw new IllegalArgumentException("IMA " + field + " is invalid");
            }
        }
    }

    private AuthorizationStatusResult invalid() {
        return failed("CONNECTOR_CREDENTIAL_INVALID");
    }

    private AuthorizationStatusResult failed(String errorCode) {
        return new AuthorizationStatusResult(
            AuthorizationStatus.FAILED, null, null, null, null, errorCode, "IMA credential verification failed");
    }

    private boolean unavailable(RuntimeException exception) {
        return exception.getMessage() != null && exception.getMessage().contains("Unable to start connector CLI process");
    }

    private static final class SetHolder {
        private static final java.util.Set<String> KEYS = java.util.Set.copyOf(MANAGED_KEYS);
        private static final java.util.Set<String> FORM_KEYS = java.util.Set.of("clientId", "apiKey");
    }

    public record RuntimeCommandResult(boolean ok, Integer exitCode, JsonNode data, String errorCode) {

        static RuntimeCommandResult completed(int exitCode, JsonNode data) {
            return new RuntimeCommandResult(exitCode == 0, exitCode, data, null);
        }

        static RuntimeCommandResult failed(String errorCode) {
            return new RuntimeCommandResult(false, null, null, errorCode);
        }
    }
}
