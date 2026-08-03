package com.iwhalecloud.byai.manager.domain.connector.manifest;

import java.nio.charset.StandardCharsets;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

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
            validateRoot(root, connector.getConnectorCode());
            return objectMapper.writeValueAsString(canonicalNode(root));
        } catch (InvalidConnectorManifestException e) {
            throw e;
        } catch (JsonProcessingException | RuntimeException e) {
            throw new InvalidConnectorManifestException("Invalid connector Manifest JSON", e);
        }
    }

    private void validateRoot(JsonNode root, String connectorCode) {
        requireObject(root, "Manifest root");
        rejectSensitiveFields(root);
        requireText(root, "schemaVersion", SCHEMA_VERSION);
        requireText(root, "id", connectorCode);
        requireNonBlankText(root, "version");

        JsonNode runtime = requireObject(root.get("runtime"), "runtime");
        requireText(runtime, "type", "cli");
        JsonNode commands = requireObject(runtime.get("commands"), "runtime.commands");
        if (commands.isEmpty()) {
            throw invalid("runtime.commands must not be empty");
        }
        Iterator<Map.Entry<String, JsonNode>> commandFields = commands.fields();
        while (commandFields.hasNext()) {
            Map.Entry<String, JsonNode> field = commandFields.next();
            JsonNode command = field.getValue();
            if (!command.isArray() || command.isEmpty()) {
                throw invalid("runtime.commands." + field.getKey() + " must be a non-empty argument array");
            }
            for (JsonNode argument : command) {
                if (!argument.isTextual() || !StringUtils.hasText(argument.textValue())
                        || containsControlCharacter(argument.textValue())) {
                    throw invalid("runtime.commands." + field.getKey() + " contains an invalid argument");
                }
            }
        }

        JsonNode authStorage = requireObject(root.get("authStorage"), "authStorage");
        requireText(authStorage, "mode", "native-home");
        String nativePath = requireNonBlankText(authStorage, "nativePath");
        validateNativePath(nativePath);
        JsonNode environment = requireObject(authStorage.get("environment"), "authStorage.environment");
        Iterator<Map.Entry<String, JsonNode>> environmentFields = environment.fields();
        while (environmentFields.hasNext()) {
            Map.Entry<String, JsonNode> field = environmentFields.next();
            if (!field.getValue().isTextual() || !StringUtils.hasText(field.getValue().textValue())) {
                throw invalid("authStorage.environment values must be non-blank strings");
            }
        }

        JsonNode skill = requireObject(root.get("skill"), "skill");
        requireNonBlankText(skill, "code");
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

    private void validateNativePath(String value) {
        try {
            Path path = Path.of(value);
            if (!path.isAbsolute() || !path.normalize().startsWith(CONNECTOR_AUTH_ROOT)
                    || path.normalize().equals(CONNECTOR_AUTH_ROOT)) {
                throw invalid("authStorage.nativePath must be under /by/.connector-auth/");
            }
        } catch (InvalidPathException e) {
            throw invalid("authStorage.nativePath is invalid");
        }
    }

    private JsonNode canonicalNode(JsonNode node) {
        if (node.isObject()) {
            ObjectNode object = objectMapper.createObjectNode();
            List<Map.Entry<String, JsonNode>> fields = new ArrayList<>();
            node.fields().forEachRemaining(fields::add);
            fields.sort(Comparator.comparing(Map.Entry::getKey));
            fields.forEach(field -> object.set(field.getKey(), canonicalNode(field.getValue())));
            return object;
        }
        if (node.isArray()) {
            ArrayNode array = objectMapper.createArrayNode();
            node.forEach(item -> array.add(canonicalNode(item)));
            return array;
        }
        return node.deepCopy();
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

    private boolean containsControlCharacter(String value) {
        return value.indexOf('\0') >= 0 || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0;
    }

    private InvalidConnectorManifestException invalid(String message) {
        return new InvalidConnectorManifestException(message);
    }
}
