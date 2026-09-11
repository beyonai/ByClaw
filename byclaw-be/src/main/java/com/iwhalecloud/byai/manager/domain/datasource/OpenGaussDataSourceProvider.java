package com.iwhalecloud.byai.manager.domain.datasource;

import com.iwhalecloud.byai.common.exception.BaseException;
import org.springframework.stereotype.Component;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

@Component
public class OpenGaussDataSourceProvider implements DataSourceTypeProvider {
    private static final Set<String> FIELDS = Set.of("host", "port", "database", "username", "schema", "sslMode");
    private static final Set<String> SSL_MODES = Set.of("disable", "require", "verify-ca", "verify-full");

    @Override
    public String type() {
        return "opengauss";
    }

    @Override
    public Map<String, Object> validate(Map<String, Object> config) {
        if (config == null || !FIELDS.containsAll(config.keySet())) {
            throw new BaseException(400, "datasource.config.field.unsupported");
        }
        Map<String, Object> result = new LinkedHashMap<>();
        String host = requiredText(config, "host", 253);
        // Store a host, never a JDBC URL or credentials embedded in a URL.
        if (host.chars().anyMatch(Character::isWhitespace) || host.matches(".*[/@?#;=].*")) {
            throw new BaseException(400, "datasource.host.invalid");
        }
        result.put("host", host);
        Object rawPort = config.getOrDefault("port", 5432);
        int port;
        try {
            port = Integer.parseInt(String.valueOf(rawPort));
        } catch (NumberFormatException e) {
            throw new BaseException(400, "datasource.port.invalid");
        }
        if (port < 1 || port > 65535) {
            throw new BaseException(400, "datasource.port.invalid");
        }
        result.put("port", port);
        result.put("database", requiredText(config, "database", 128));
        result.put("username", requiredText(config, "username", 128));
        if (config.get("schema") != null && !String.valueOf(config.get("schema")).isBlank()) {
            result.put("schema", requiredText(config, "schema", 128));
        }
        Object sslMode = config.getOrDefault("sslMode", "require");
        if (!(sslMode instanceof String) || !SSL_MODES.contains(sslMode)) {
            throw new BaseException(400, "datasource.ssl.invalid");
        }
        result.put("sslMode", sslMode);
        return result;
    }

    private String requiredText(Map<String, Object> config, String field, int maxLength) {
        Object value = config.get(field);
        if (!(value instanceof String text) || text.isBlank() || text.length() > maxLength
                || text.chars().anyMatch(Character::isISOControl)) {
            throw new BaseException(400, "datasource.config.invalid");
        }
        return text.trim();
    }
}
