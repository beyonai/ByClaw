package com.iwhalecloud.byai.manager.domain.connector.authorization;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/** Resolves and validates the media projection contract declared by a connector template. */
@Component
public class MediaModelProjectionSpecResolver {

    private static final Path MODEL_ROOT = Path.of("/by/.connector-auth/.model");
    private static final Map<String, String> CAPABILITIES = Map.of(
        "image-generation-model", "IMAGE",
        "speech-generation-model", "TTS");
    private final ObjectMapper objectMapper;

    public MediaModelProjectionSpecResolver(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public boolean supports(ConnectorInfo connector) {
        return connector != null
            && connector.getConnectorCode() != null
            && connector.getConnectorCode().equals(connector.getProviderCode())
            && CAPABILITIES.containsKey(connector.getConnectorCode());
    }

    public Projection resolve(ConnectorInfo connector) {
        if (!supports(connector)) {
            throw invalid("connector");
        }
        try {
            JsonNode root = objectMapper.readTree(connector.getRuntimeManifest());
            JsonNode projection = root == null ? null : root.get("mediaModelProjection");
            if (projection == null || !projection.isObject()
                    || projection.path("schemaVersion").asInt(-1) != 1) {
                throw invalid("schemaVersion");
            }
            String expectedCapability = CAPABILITIES.get(connector.getConnectorCode());
            String capability = projection.path("capability").textValue();
            if (!expectedCapability.equals(capability)) {
                throw invalid("capability");
            }
            String rawPath = projection.path("path").textValue();
            if (!StringUtils.hasText(rawPath)) {
                throw invalid("path");
            }
            Path path = Path.of(rawPath).normalize();
            String expectedFile = "IMAGE".equals(capability) ? "image.json" : "tts.json";
            if (!path.isAbsolute() || !path.startsWith(MODEL_ROOT) || path.equals(MODEL_ROOT)
                    || path.getFileName() == null || !expectedFile.equals(path.getFileName().toString())) {
                throw invalid("path");
            }
            return new Projection(path.toString(), capability);
        } catch (InvalidPathException e) {
            throw invalid("path");
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid media model projection manifest", e);
        }
    }

    private IllegalArgumentException invalid(String field) {
        return new IllegalArgumentException("Invalid media model projection " + field);
    }

    public record Projection(String path, String modelType) {
    }
}
