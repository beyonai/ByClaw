package com.iwhalecloud.byai.gateway.sandbox.platform;

import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.util.Date;

/** Immutable startup key snapshot; request headers/claims never select a key. */
public final class PlatformBridgeTokens {
    private final Key key;
    private final JwtParser parser;
    private final int expirationHours;

    public PlatformBridgeTokens(String secret, int expirationHours) {
        if (secret == null
                || secret.trim().isEmpty()
                || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException(
                    "BYAI_PLATFORM app_secret must contain at least 256 bits of UTF-8 key material");
        }
        if (expirationHours <= 0) {
            throw new IllegalArgumentException("JWT expiration hours must be positive");
        }
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.parser = Jwts.parserBuilder().setSigningKey(key).build();
        this.expirationHours = expirationHours;
    }

    public Claims verify(String token) {
        if (token == null || token.trim().isEmpty() || token.startsWith("Bearer ")) {
            throw new MalformedJwtException("Invalid beyond-token");
        }
        Jws<Claims> parsed = parser.parseClaimsJws(token);
        if (!SignatureAlgorithm.HS256.getValue().equals(parsed.getHeader().getAlgorithm())
                || parsed.getBody().getExpiration() == null) {
            throw new UnsupportedJwtException("HS256 and exp are required");
        }
        return parsed.getBody();
    }
    /** For platform-initiated internal calls; there is deliberately no HTTP token endpoint. */
    public String createToken() {
        long now = System.currentTimeMillis();
        long expires =
                Math.addExact(now, java.util.concurrent.TimeUnit.HOURS.toMillis(expirationHours));
        return Jwts.builder()
                .claim("systemCode", "BYAI_PLATFORM")
                .setIssuedAt(new Date(now))
                .setExpiration(new Date(expires))
                .signWith(key, SignatureAlgorithm.HS256)
                .compact();
    }
}
