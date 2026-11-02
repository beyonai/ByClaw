package com.iwhalecloud.byai.state.domain.resource.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Mirrors the standard resource JSON, never an import request or a ZIP, into Redis. */
@Service
@RequiredArgsConstructor
public class ResourceJsonCacheService {
    private static final Logger LOG = LoggerFactory.getLogger(ResourceJsonCacheService.class);
    private static final Set<String> TYPES = Set.of("SKILL", "TOOL", "TOOLKIT", "MCP", "MCP_TOOL", "AGENT",
        "OBJECT", "VIEW", "SCENE", "KG_DOC", "KG_QA", "KG_TERM", "KG_DB");
    private static final Pattern STANDARD_JSON = Pattern.compile("([A-Z_]+)_([0-9]+)\\.json");
    private final StringRedisTemplate redis;

    public void publishedFile(String directory, String fileName, byte[] content) {
        Matcher match = STANDARD_JSON.matcher(fileName);
        if (match.matches() && standardDirectory(match.group(1)).equals(directory)) putAfterCommit(match.group(1), Long.parseLong(match.group(2)),
            new String(content, StandardCharsets.UTF_8));
    }

    public void deletedFile(String relativePath) {
        String fileName = relativePath.substring(relativePath.lastIndexOf('/') + 1);
        Matcher match = STANDARD_JSON.matcher(fileName);
        if (match.matches() && relativePath.equals(standardDirectory(match.group(1)) + "/" + fileName)) {
            removeAfterCommit(match.group(1), Long.parseLong(match.group(2)));
        }
    }

    private String standardDirectory(String type) {
        return type.startsWith("KG_") ? "doc" : type.toLowerCase(Locale.ROOT);
    }

    public void putAfterCommit(String type, long id, String json) {
        String key = key(type, id);
        if (key == null) return;
        // Validate the shape, but preserve the exact standard JSON contract and number representation.
        boolean valid = false;
        try {
            valid = json != null && !json.isBlank() && JSON.parse(json) instanceof JSONObject;
        } catch (RuntimeException ignored) {
            LOG.warn("Invalid standard resource JSON; evicting cache, key={}", key);
        }
        if (!valid) {
            removeAfterCommit(type, id);
            return;
        }
        afterCommit(key, () -> redis.opsForValue().set(key, json));
    }

    public void removeAfterCommit(String type, long id) {
        String key = key(type, id);
        if (key != null) afterCommit(key, () -> redis.delete(key));
    }

    private String key(String type, long id) {
        String normalized = type == null ? "" : type.trim().toUpperCase(Locale.ROOT);
        return id > 0 && TYPES.contains(normalized) ? normalized + "_" + id : null;
    }

    private void afterCommit(String key, Runnable action) {
        Runnable safeAction = () -> {
            try {
                action.run();
            } catch (RuntimeException e) {
                // The database has committed. A Redis outage must not turn a successful save into a false rollback.
                LOG.warn("Resource JSON cache sync failed, key={}; startup backfill can retry", key, e);
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()
            && TransactionSynchronizationManager.isActualTransactionActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { safeAction.run(); }
            });
        } else {
            safeAction.run();
        }
    }
}
