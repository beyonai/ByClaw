package com.iwhalecloud.byai.manager.domain.connector.manifest;

import java.nio.charset.StandardCharsets;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/** 校验连接器 Runtime Manifest，并生成与排版、对象字段顺序无关的 canonical JSON。 */
@Component
public class ConnectorManifestCanonicalizer {

    private static final String SCHEMA_VERSION = "1.0";
    private static final int MAX_MANIFEST_BYTES = 64 * 1024;
    private static final Path CONNECTOR_AUTH_ROOT = Path.of("/by/.connector-auth");
    private static final Pattern ENVIRONMENT_KEY_PATTERN = Pattern.compile("[A-Z_][A-Z0-9_]{0,127}");
    private static final List<String> SENSITIVE_FIELD_PARTS = List.of(
        "secret", "token", "password", "credential", "devicecode", "authorizationcode");

    private final ObjectMapper objectMapper;

    public ConnectorManifestCanonicalizer(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public String canonicalize(ConnectorInfo connector, String manifestJson) {
        if (connector == null || !StringUtils.hasText(connector.getConnectorCode())) {
            throw invalid("connectorCode is required");
        }
        if (!StringUtils.hasText(manifestJson)) {
            throw invalid("runtime_manifest is required");
        }
        if (manifestJson.getBytes(StandardCharsets.UTF_8).length > MAX_MANIFEST_BYTES) {
            throw invalid("runtime_manifest exceeds 64 KiB");
        }
        try {
            JsonNode root = objectMapper.readTree(manifestJson);
            validateRoot(root, connector.getConnectorCode(), connector.getSkillCode());
            return objectMapper.writeValueAsString(canonicalNode(root));
        } catch (InvalidConnectorManifestException e) {
            throw e;
        } catch (JsonProcessingException | RuntimeException e) {
            throw new InvalidConnectorManifestException("Invalid connector Manifest JSON", e);
        }
    }

    public Map<String, String> extractEnvironment(ConnectorInfo connector, String manifestJson) {
        String canonicalManifest = canonicalize(connector, manifestJson);
        try {
            JsonNode environmentNode = objectMapper.readTree(canonicalManifest)
                .path("authStorage")
                .path("environment");
            Map<String, String> environment = new LinkedHashMap<>();
            environmentNode.fields().forEachRemaining(field ->
                environment.put(field.getKey(), field.getValue().textValue()));
            return Collections.unmodifiableMap(environment);
        }
        catch (JsonProcessingException e) {
            throw new InvalidConnectorManifestException("Invalid connector Manifest JSON", e);
        }
    }

    /** 返回由受管凭据作业注入的环境变量白名单；其他存储模式返回空列表。 */
    public List<String> extractManagedEnvironmentKeys(ConnectorInfo connector, String manifestJson) {
        String canonicalManifest = canonicalize(connector, manifestJson);
        try {
            JsonNode authStorage = objectMapper.readTree(canonicalManifest).path("authStorage");
            if (!"managed-environment".equals(authStorage.path("mode").textValue())) {
                return List.of();
            }
            List<String> keys = new ArrayList<>();
            authStorage.path("managedEnvironmentKeys").forEach(key -> keys.add(key.textValue()));
            Collections.sort(keys);
            return List.copyOf(keys);
        }
        catch (JsonProcessingException e) {
            throw new InvalidConnectorManifestException("Invalid connector Manifest JSON", e);
        }
    }

    /** Returns the shared-volume credential projection declared by the connector, if any. */
    public Optional<CredentialProjectionSpec> extractCredentialProjection(
            ConnectorInfo connector, String manifestJson) {
        String canonicalManifest = canonicalize(connector, manifestJson);
        try {
            JsonNode authStorage = objectMapper.readTree(canonicalManifest).path("authStorage");
            if (!"credential-reference".equals(authStorage.path("mode").textValue())
                    || !"shared-volume-projection".equals(authStorage.path("runtimeMutation").textValue())) {
                return Optional.empty();
            }
            return Optional.of(new CredentialProjectionSpec(authStorage.path("projectionPath").textValue()));
        } catch (JsonProcessingException e) {
            throw new InvalidConnectorManifestException("Invalid connector Manifest JSON", e);
        }
    }

    public record CredentialProjectionSpec(String projectionPath) {
    }

    private void validateRoot(JsonNode root, String connectorCode, String connectorSkillCode) {
        requireObject(root, "Manifest root");
        rejectSensitiveFields(root);
        requireText(root, "schemaVersion", SCHEMA_VERSION);
        requireText(root, "id", connectorCode);
        requireNonBlankText(root, "version");

        JsonNode runtime = requireObject(root.get("runtime"), "runtime");
        String runtimeType = requireAllowedText(runtime, "type", "cli", "oauth2");
        requireAllowedText(runtime, "authorizeIn", "be-auth-job", "user-sandbox");
        JsonNode commands = runtime.get("commands");
        if ("cli".equals(runtimeType)) {
            commands = requireObject(commands, "runtime.commands");
            if (commands.isEmpty()) {
                throw invalid("runtime.commands must not be empty");
            }
            Iterator<Map.Entry<String, JsonNode>> commandFields = commands.fields();
            while (commandFields.hasNext()) {
                Map.Entry<String, JsonNode> field = commandFields.next();
                JsonNode commandGroup = field.getValue();
                if (!commandGroup.isArray() || commandGroup.isEmpty()) {
                    throw invalid("runtime.commands." + field.getKey() + " must be a non-empty command group");
                }
                for (JsonNode command : commandGroup) {
                    if (!command.isArray()) {
                        throw invalid("runtime.commands." + field.getKey() + " must be two-dimensional");
                    }
                    if (command.isEmpty()) {
                        throw invalid("runtime.commands." + field.getKey() + " contains an empty argv");
                    }
                    for (JsonNode argument : command) {
                        if (!argument.isTextual() || !StringUtils.hasText(argument.textValue())
                                || containsControlCharacter(argument.textValue())) {
                            throw invalid("runtime.commands." + field.getKey() + " contains an invalid argument");
                        }
                    }
                }
            }
        }

        JsonNode authStorage = requireObject(root.get("authStorage"), "authStorage");
        String storageMode = requireAllowedText(authStorage, "mode", "native-home", "credential-reference",
            "managed-environment");
        boolean cliRuntime = "cli".equals(runtimeType);
        boolean cliStorage = "native-home".equals(storageMode) || "managed-environment".equals(storageMode);
        if (cliRuntime != cliStorage) {
            throw invalid("runtime.type and authStorage.mode are incompatible");
        }
        requireAllowedText(authStorage, "owner", "be-auth-job", "user-sandbox-auth-job");
        String runtimeMutation = requireAllowedText(authStorage, "runtimeMutation", "provider-refresh-only",
            "sandbox-native", "shared-volume-projection");
        if ("native-home".equals(storageMode)) {
            if ("shared-volume-projection".equals(runtimeMutation)) {
                throw invalid("native-home must not use shared-volume-projection");
            }
            validateConnectorAuthPath(requireNonBlankText(authStorage, "nativePath"), "nativePath");
            rejectProjectionPath(authStorage, storageMode);
            rejectManagedEnvironmentKeys(authStorage, storageMode);
        } else if ("managed-environment".equals(storageMode)) {
            if (authStorage.has("nativePath")) {
                throw invalid("managed-environment must not define nativePath");
            }
            requireText(runtime, "authorizeIn", "be-auth-job");
            requireText(authStorage, "owner", "be-auth-job");
            requireText(authStorage, "runtimeMutation", "provider-refresh-only");
            rejectProjectionPath(authStorage, storageMode);
            validateManagedEnvironmentKeys(authStorage);
        } else {
            if (authStorage.has("nativePath")) {
                throw invalid("credential-reference must not define nativePath");
            }
            rejectManagedEnvironmentKeys(authStorage, storageMode);
            if ("shared-volume-projection".equals(runtimeMutation)) {
                validateConnectorAuthPath(requireNonBlankText(authStorage, "projectionPath"), "projectionPath");
                requireText(authStorage, "owner", "be-auth-job");
            } else {
                rejectProjectionPath(authStorage, storageMode);
            }
        }
        JsonNode environment = requireObject(authStorage.get("environment"), "authStorage.environment");
        if ("managed-environment".equals(storageMode) && !environment.isEmpty()) {
            throw invalid("managed-environment must not define static environment values");
        }
        Iterator<Map.Entry<String, JsonNode>> environmentFields = environment.fields();
        while (environmentFields.hasNext()) {
            Map.Entry<String, JsonNode> field = environmentFields.next();
            if (!ENVIRONMENT_KEY_PATTERN.matcher(field.getKey()).matches()) {
                throw invalid("authStorage.environment key is invalid: " + field.getKey());
            }
            if (!field.getValue().isTextual() || !StringUtils.hasText(field.getValue().textValue())) {
                throw invalid("authStorage.environment values must be non-blank strings");
            }
        }

        JsonNode skill = requireObject(root.get("skill"), "skill");
        String manifestSkillCode = requireNonBlankText(skill, "code");
        if (StringUtils.hasText(connectorSkillCode) && !connectorSkillCode.equals(manifestSkillCode)) {
            throw invalid("skill.code must equal connector skillCode");
        }
        requireNonBlankText(skill, "source");
        requireNonBlankText(skill, "installScope");
        requireNonBlankText(skill, "grantScope");
    }

    private void rejectSensitiveFields(JsonNode node) {
        if (node == null) {
            return;
        }
        if (node.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                String normalized = field.getKey().replaceAll("[^A-Za-z0-9]", "").toLowerCase(Locale.ROOT);
                if (SENSITIVE_FIELD_PARTS.stream().anyMatch(normalized::contains)) {
                    throw invalid("Manifest contains a sensitive field: " + field.getKey());
                }
                rejectSensitiveFields(field.getValue());
            }
        } else if (node.isArray()) {
            node.forEach(this::rejectSensitiveFields);
        }
    }

    private void validateConnectorAuthPath(String value, String fieldName) {
        try {
            Path path = Path.of(value);
            if (!path.isAbsolute() || !path.normalize().startsWith(CONNECTOR_AUTH_ROOT)
                    || path.normalize().equals(CONNECTOR_AUTH_ROOT)) {
                throw invalid("authStorage." + fieldName + " must be under /by/.connector-auth/");
            }
        } catch (InvalidPathException e) {
            throw invalid("authStorage." + fieldName + " is invalid");
        }
    }

    private void rejectManagedEnvironmentKeys(JsonNode authStorage, String storageMode) {
        if (authStorage.has("managedEnvironmentKeys")) {
            throw invalid(storageMode + " must not define managedEnvironmentKeys");
        }
    }

    private void rejectProjectionPath(JsonNode authStorage, String storageMode) {
        if (authStorage.has("projectionPath")) {
            throw invalid(storageMode + " must not define projectionPath");
        }
    }

    private void validateManagedEnvironmentKeys(JsonNode authStorage) {
        JsonNode keys = authStorage.get("managedEnvironmentKeys");
        if (keys == null || !keys.isArray() || keys.isEmpty()) {
            throw invalid("managedEnvironmentKeys must be a non-empty array");
        }
        Set<String> seen = new HashSet<>();
        for (JsonNode key : keys) {
            if (!key.isTextual() || !ENVIRONMENT_KEY_PATTERN.matcher(key.textValue()).matches()) {
                throw invalid("managedEnvironmentKeys contains an invalid environment variable name");
            }
            if (!seen.add(key.textValue())) {
                throw invalid("managedEnvironmentKeys contains a duplicate environment variable name");
            }
        }
    }

    private JsonNode canonicalNode(JsonNode node) {
        return canonicalNode(node, "");
    }

    private JsonNode canonicalNode(JsonNode node, String path) {
        if (node.isObject()) {
            ObjectNode object = objectMapper.createObjectNode();
            List<Map.Entry<String, JsonNode>> fields = new ArrayList<>();
            node.fields().forEachRemaining(fields::add);
            fields.sort(Comparator.comparing(Map.Entry::getKey));
            fields.forEach(field -> object.set(field.getKey(), canonicalField(path, field)));
            return object;
        }
        if (node.isArray()) {
            ArrayNode array = objectMapper.createArrayNode();
            node.forEach(item -> array.add(canonicalNode(item, path)));
            return array;
        }
        return node.deepCopy();
    }

    private JsonNode canonicalField(String parentPath, Map.Entry<String, JsonNode> field) {
        if ("authStorage".equals(parentPath) && "managedEnvironmentKeys".equals(field.getKey())) {
            List<JsonNode> keys = new ArrayList<>();
            field.getValue().forEach(keys::add);
            keys.sort(Comparator.comparing(JsonNode::textValue));
            ArrayNode sorted = objectMapper.createArrayNode();
            keys.forEach(key -> sorted.add(canonicalNode(key, parentPath + "." + field.getKey())));
            return sorted;
        }
        String fieldPath = parentPath.isEmpty() ? field.getKey() : parentPath + "." + field.getKey();
        return canonicalNode(field.getValue(), fieldPath);
    }

    private JsonNode requireObject(JsonNode node, String field) {
        if (node == null || !node.isObject()) {
            throw invalid(field + " must be an object");
        }
        return node;
    }

    private String requireNonBlankText(JsonNode parent, String field) {
        JsonNode value = parent.get(field);
        if (value == null || !value.isTextual() || !StringUtils.hasText(value.textValue())) {
            throw invalid(field + " must be a non-blank string");
        }
        return value.textValue();
    }

    private void requireText(JsonNode parent, String field, String expected) {
        String actual = requireNonBlankText(parent, field);
        if (!expected.equals(actual)) {
            throw invalid(field + " must equal " + expected);
        }
    }

    private String requireAllowedText(JsonNode parent, String field, String... allowed) {
        JsonNode value = parent.get(field);
        if (value == null) {
            return null;
        }
        String actual = requireNonBlankText(parent, field);
        for (String candidate : allowed) {
            if (candidate.equals(actual)) {
                return actual;
            }
        }
        throw invalid(field + " contains an unsupported value");
    }

    private boolean containsControlCharacter(String value) {
        return value.indexOf('\0') >= 0 || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0;
    }

    private InvalidConnectorManifestException invalid(String message) {
        return new InvalidConnectorManifestException(message);
    }
}
