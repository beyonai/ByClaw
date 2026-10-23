package com.iwhalecloud.byai.manager.domain.operations;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** 独立服务令牌，不接受浏览器 Cookie 或普通用户 Token。
 * @author Codex
 * @since 2026-10-23
 */
@Component
public class OperationsAuthentication {
    public static final String PATH = "/internal/v1/platform-operations";
    public static final String HEADER = "X-Hacu-Operations-Token";

    @Value("${hacu.operations.token:${HACU_OPERATIONS_TOKEN:}}")
    private String token;

    /** 未配置强令牌时端点关闭，比较不提前暴露匹配前缀。 */
    public boolean accepts(String supplied) {
        return token != null && token.length() >= 32 && token.length() <= 512
            && supplied != null && supplied.length() <= 512
            && MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),
                supplied.getBytes(StandardCharsets.UTF_8));
    }
}

