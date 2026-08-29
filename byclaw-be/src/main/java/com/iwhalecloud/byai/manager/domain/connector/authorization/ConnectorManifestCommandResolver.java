package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.manifest.ConnectorManifestCanonicalizer;
import com.iwhalecloud.byai.manager.domain.connector.manifest.InvalidConnectorManifestException;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** Parses canonical Runtime Manifest commands into an immutable command catalog. */
@Component
public class ConnectorManifestCommandResolver {

    private static final Map<String, ManifestCommandCatalog.PlaceholderPolicy> DEFAULT_PLACEHOLDERS = Map.of(
        "deviceCode", ManifestCommandCatalog.PlaceholderPolicy.safeValue(512)
    );

    private final ObjectMapper objectMapper;
    private final ConnectorManifestCanonicalizer canonicalizer;
    private final Map<String, ManifestCommandCatalog.PlaceholderPolicy> placeholderPolicies;

    @Autowired
    public ConnectorManifestCommandResolver(
            ObjectMapper objectMapper,
            ConnectorManifestCanonicalizer canonicalizer) {
        this(objectMapper, canonicalizer, DEFAULT_PLACEHOLDERS);
    }

    ConnectorManifestCommandResolver(
            ObjectMapper objectMapper,
            ConnectorManifestCanonicalizer canonicalizer,
            Map<String, ManifestCommandCatalog.PlaceholderPolicy> placeholderPolicies) {
        this.objectMapper = objectMapper;
        this.canonicalizer = canonicalizer;
        this.placeholderPolicies = Map.copyOf(placeholderPolicies);
    }

    public ManifestCommandCatalog resolve(ConnectorInfo connector) {
        String canonical = canonicalizer.canonicalize(connector, connector == null ? null : connector.getRuntimeManifest());
        try {
            JsonNode runtimeNode = objectMapper.readTree(canonical).path("runtime");
            if ("oauth2".equals(runtimeNode.path("type").textValue())) {
                return ManifestCommandCatalog.withoutCommands(sha256(canonical), placeholderPolicies);
            }
            JsonNode commandsNode = runtimeNode.path("commands");
            Map<String, List<List<String>>> commands = new LinkedHashMap<>();
            commandsNode.fields().forEachRemaining(action -> {
                List<List<String>> group = new ArrayList<>();
                action.getValue().forEach(command -> {
                    List<String> argv = new ArrayList<>();
                    command.forEach(argument -> argv.add(argument.textValue()));
                    group.add(List.copyOf(argv));
                });
                commands.put(action.getKey(), List.copyOf(group));
            });
            return new ManifestCommandCatalog(commands, sha256(canonical), placeholderPolicies);
        } catch (JsonProcessingException e) {
            throw new InvalidConnectorManifestException("Invalid connector Manifest JSON", e);
        }
    }

    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }
}
