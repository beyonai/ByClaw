package com.iwhalecloud.byai.manager.interfaces.controller.adminconsole;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.Cursor;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Restricted diagnostics console. Every endpoint is server-side adminvip guarded. */
@RestController
@RequestMapping("/admin-console")
public class AdminConsoleController {
    private static final String ADMIN = "adminvip";
    private static final Set<String> SAFE_REDIS = Set.of("GET", "MGET", "STRLEN", "TTL", "PTTL", "TYPE", "EXISTS", "SCAN", "SSCAN", "HSCAN", "ZSCAN", "HGET", "HGETALL", "HMGET", "HLEN", "HEXISTS", "SMEMBERS", "SISMEMBER", "SCARD", "LLEN", "LRANGE", "LINDEX", "ZCARD", "ZRANGE", "ZRANK", "ZSCORE", "XINFO", "XLEN", "XRANGE", "INFO", "DBSIZE", "ROLE", "TIME", "PING");

    @Autowired private RedisConnectionFactory redisConnectionFactory;

    private void guard() {
        if (!ADMIN.equalsIgnoreCase(CurrentUserHolder.getCurrentUserCode())) {
            throw new SecurityException("无权限，仅 adminvip 可访问");
        }
    }

    @PostMapping("/redis/command")
    public ResponseUtil<Map<String, Object>> redis(@RequestBody Map<String, Object> body) {
        try {
            guard();
            String command = Objects.toString(body == null ? null : body.get("command"), "").trim();
            List<String> parts = split(command);
            if (parts.isEmpty() || !SAFE_REDIS.contains(parts.get(0).toUpperCase(Locale.ROOT))) return ResponseUtil.fail("危险或不允许的 Redis 命令，系统拒绝执行");
            if (parts.size() > 100) return ResponseUtil.fail("命令参数过多");
            byte[][] args = parts.subList(1, parts.size()).stream().map(v -> v.getBytes(StandardCharsets.UTF_8)).toArray(byte[][]::new);
            RedisConnection connection = redisConnectionFactory.getConnection();
            try {
                Object result;
                if ("SCAN".equalsIgnoreCase(parts.get(0))) {
                    ScanOptions.ScanOptionsBuilder builder = ScanOptions.scanOptions().count(500);
                    for (int i = 1; i + 1 < parts.size(); i++) if ("MATCH".equalsIgnoreCase(parts.get(i))) builder.match(parts.get(i + 1));
                    List<String> keys = new ArrayList<>();
                    try (Cursor<byte[]> cursor = connection.scan(builder.build())) {
                        while (cursor.hasNext() && keys.size() < 20000) keys.add(new String(cursor.next(), StandardCharsets.UTF_8));
                    }
                    result = keys;
                } else result = connection.execute(parts.get(0), args);
                Map<String, Object> payload = new LinkedHashMap<>(); payload.put("command", parts.get(0)); payload.put("result", stringify(result)); return ResponseUtil.successResponse(payload);
            }
            finally { connection.close(); }
        } catch (SecurityException e) { return ResponseUtil.fail(e.getMessage()); }
        catch (Exception e) { return ResponseUtil.fail("Redis 查询失败：" + e.getMessage()); }
    }

    private static List<String> split(String value) { return Arrays.asList(value.split("\\s+")); }
    private static Object stringify(Object value) {
        if (value instanceof byte[] bytes) return new String(bytes, StandardCharsets.UTF_8);
        if (value instanceof Collection<?> collection) return collection.stream().map(AdminConsoleController::stringify).toList();
        if (value instanceof Map<?, ?> map) { Map<String, Object> out = new LinkedHashMap<>(); map.forEach((k, v) -> out.put(String.valueOf(stringify(k)), stringify(v))); return out; }
        return value;
    }
}
