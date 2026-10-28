package com.iwhalecloud.byai.common.integration.security;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Autowired;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import static com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException.DiagnosticReason.AUTHENTICATION_ERROR;
import static com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException.DiagnosticReason.CLIENT_NOT_CONFIGURED;
import static com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException.DiagnosticReason.CLIENT_SECRET_INVALID;
import static com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException.DiagnosticReason.CLOCK_SKEW_INVALID;
import static com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException.DiagnosticReason.HEADER_INVALID;
import static com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException.DiagnosticReason.HEADER_MISSING;
import static com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException.DiagnosticReason.INTEGRATION_DISABLED;
import static com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException.DiagnosticReason.NONCE_REPLAYED;
import static com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException.DiagnosticReason.NONCE_STORE_UNAVAILABLE;
import static com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException.DiagnosticReason.ROUTE_NOT_ALLOWED;
import static com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException.DiagnosticReason.SIGNATURE_MISMATCH;
import static com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException.DiagnosticReason.TIMESTAMP_OUT_OF_WINDOW;

/** Verifies exact transmitted path/query and body before reserving a shared nonce. */
@Component
public class InternalServiceAuthenticator {
    private final InternalServiceSecurityProperties properties;
    private final InternalServiceNonceStore nonces;
    private final Clock clock;
    @Autowired
    public InternalServiceAuthenticator(InternalServiceSecurityProperties properties, InternalServiceNonceStore nonces) {
        this(properties, nonces, Clock.systemUTC());
    }
    InternalServiceAuthenticator(InternalServiceSecurityProperties properties, InternalServiceNonceStore nonces, Clock clock) {
        this.properties = properties; this.nonces = nonces; this.clock = clock;
    }
    public InternalServicePrincipal authenticate(HttpServletRequest request, byte[] body) {
        try {
            if (!properties.isEnabled()) throw denied(INTEGRATION_DISABLED);
            String id = header(request, "Client-Id"), timestamp = header(request, "Timestamp"), nonce = header(request, "Nonce");
            String signature = header(request, "Signature");
            if (!id.matches("[A-Za-z0-9_-]{1,100}") || !timestamp.matches("[0-9]{1,12}")
                || !nonce.matches("[A-Za-z0-9_-]{16,128}") || !signature.matches("[0-9a-f]{64}")) throw denied(HEADER_INVALID);
            long seconds = Long.parseLong(timestamp), now = clock.instant().getEpochSecond(), skew = properties.getMaxSkewSeconds();
            if (skew < 1 || skew > 3600) throw denied(CLOCK_SKEW_INVALID);
            if (seconds < now - skew || seconds > now + skew) throw denied(TIMESTAMP_OUT_OF_WINDOW);
            var client = properties.getClients().get(id);
            if (client == null) throw denied(CLIENT_NOT_CONFIGURED);
            if (client.getSecret() == null || client.getSecret().isBlank()
                || client.getSecret().getBytes(StandardCharsets.UTF_8).length < 32) throw denied(CLIENT_SECRET_INVALID);
            String expected = sign(client.getSecret(), canonical(request, body));
            if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.US_ASCII), signature.getBytes(StandardCharsets.US_ASCII))) throw denied(SIGNATURE_MISMATCH);
            var principal = new InternalServicePrincipal(id, client.getSourceSystem(), client.getScopes(), client.getEnterpriseIds(), client.isAllTenants());
            String scope = InternalServiceRoutes.scope(request.getMethod(), request.getRequestURI().substring(request.getContextPath().length()));
            if (scope == null) throw denied(ROUTE_NOT_ALLOWED);
            principal.requireScope(scope);
            String path = request.getRequestURI().substring(request.getContextPath().length());
            if (path.startsWith("/internal/v1/tenants/")) principal.requireTenant(path.split("/")[4]);
            boolean reserved;
            try {
                reserved = nonces.reserve(id + ":" + nonce, Duration.ofSeconds(2 * skew + 1));
            } catch (RuntimeException exception) {
                // Redis failures remain fail-closed; connection details must never become diagnostic text.
                throw denied(NONCE_STORE_UNAVAILABLE);
            }
            if (!reserved) throw denied(NONCE_REPLAYED);
            return principal;
        } catch (InternalServiceSecurityException e) { throw e; }
        catch (Exception e) { throw denied(AUTHENTICATION_ERROR); }
    }
    private static String header(HttpServletRequest request, String suffix) {
        var values = request.getHeaders("X-ByClaw-" + suffix);
        if (values == null || !values.hasMoreElements()) throw denied(HEADER_MISSING);
        String value = values.nextElement();
        if (values.hasMoreElements() || value == null || value.contains("\n") || value.contains("\r")) throw denied(HEADER_INVALID);
        return value;
    }
    public static String canonical(HttpServletRequest request, byte[] body) {
        try {
            String query = request.getQueryString();
            return "BYCLAW-HMAC-SHA256-V1\n" + request.getMethod() + "\n" + request.getRequestURI() + "\n"
                + (query == null ? "" : query) + "\n"
                + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body)) + "\n"
                + header(request, "Timestamp") + "\n" + header(request, "Nonce") + "\n" + header(request, "Client-Id");
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    public static String sign(String secret, String canonical) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException("HMAC unavailable", e); }
    }
    private static InternalServiceSecurityException denied(InternalServiceSecurityException.DiagnosticReason reason) {
        return new InternalServiceSecurityException(401, "SERVICE_AUTH_INVALID", reason);
    }
}
