package com.iwhalecloud.byai.gateway.sandbox.service.ingress.desktop;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.openclaw.OpenClawUiHttpProxyService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class SandboxDesktopProxyController {
    private final SandboxDesktopAccess access;
    private final OpenClawUiHttpProxyService proxy;
    // Loaded once from the application-owned classpath, never from a request or sandbox.
    private final Map<String, byte[]> trustedAssets;

    public SandboxDesktopProxyController(SandboxDesktopAccess access, OpenClawUiHttpProxyService proxy) {
        this.access = access;
        this.proxy = proxy;
        this.trustedAssets = trustedAssets();
    }

    @RequestMapping({"/sandbox/desktop/exclusive/{sandboxId}/{instance}", "/sandbox/desktop/exclusive/{sandboxId}/{instance}/**",
        "/sandbox/desktop/shared/{mappingId}/{sandboxId}/{instance}", "/sandbox/desktop/shared/{mappingId}/{sandboxId}/{instance}/**"})
    public void proxy(HttpServletRequest request, HttpServletResponse response) {
        SandboxDesktopAccess.Target target = access.resolve(request, false);
        response.setHeader("X-Frame-Options", "SAMEORIGIN");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Cache-Control", "private, no-store");
        String suffix = request.getRequestURI().substring(target.publicPrefix().length());
        if ("/goal".equals(suffix)) {
            if (!"GET".equals(request.getMethod()) && !"POST".equals(request.getMethod())) {
                throw new ResponseStatusException(HttpStatus.METHOD_NOT_ALLOWED);
            }
            proxy.forwardDesktopGoal(request, response, target.url().toString(), target.headers());
            return;
        }
        boolean entry = entry(suffix), legacyRfb = "/rfb.js".equals(suffix);
        if (legacyRfb || suffix.isEmpty() || (entry && !"/".equals(suffix) && !"/index.html".equals(suffix))) {
            // Keep HTML-derived transports and ESM-relative imports inside the authorized mount.
            response.setStatus(HttpServletResponse.SC_TEMPORARY_REDIRECT);
            String query = safeViewerQuery(target);
            String location = legacyRfb ? "/core/rfb.js" : suffix.isEmpty() ? "/" : "/index.html";
            response.setHeader("Location", target.publicPrefix() + location
                + (query.isEmpty() ? "" : "?" + query));
            return;
        }
        byte[] body = trustedAssets.get(entry ? "/index.html" : suffix);
        if (body == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        response.setContentType(entry ? "text/html;charset=UTF-8" : "text/javascript;charset=UTF-8");
        response.setHeader("Content-Disposition", "inline");
        response.setHeader("Content-Security-Policy", "frame-ancestors 'self'; base-uri 'none'; object-src 'none'");
        response.setContentLength(body.length);
        if (!"HEAD".equals(request.getMethod())) {
            try { response.getOutputStream().write(body); }
            catch (IOException failure) { throw new IllegalStateException("Failed to write trusted desktop asset", failure); }
        }
    }

    private static boolean entry(String suffix) {
        if (suffix.isEmpty() || "/".equals(suffix)) return true;
        String name = org.springframework.web.util.UriUtils.decode(suffix.substring(1), java.nio.charset.StandardCharsets.UTF_8);
        return name.length() <= 256 && name.toLowerCase(java.util.Locale.ROOT).endsWith(".html")
            && !name.contains("/") && !name.contains("\\") && !name.contains("%")
            && name.codePoints().noneMatch(Character::isISOControl);
    }

    private static String safeViewerQuery(SandboxDesktopAccess.Target target) {
        okhttp3.HttpUrl.Builder safe = target.url().newBuilder().query(null);
        for (String name : java.util.List.of("sessionId", "autoconnect", "resize", "hideHeader", "view_only", "reconnect", "reconnect_delay")) {
            String value = target.url().queryParameter(name);
            if (value != null) safe.addQueryParameter(name, value);
        }
        return java.util.Objects.toString(safe.build().encodedQuery(), "");
    }

    private static Map<String, byte[]> trustedAssets() {
        Map<String, byte[]> assets = new LinkedHashMap<>();
        assets.put("/index.html", asset("novnc-index.html"));
        assets.put("/connection-bridge.js", asset("connection-bridge.mjs"));
        try {
            JsonNode manifest = new ObjectMapper().reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .readTree(asset("manifest.json"));
            if (manifest == null || !manifest.isObject() || !manifest.path("schemaVersion").isIntegralNumber()
                || !manifest.path("schemaVersion").canConvertToInt() || manifest.path("schemaVersion").intValue() != 2
                || !"v1".equals(manifest.path("artifactVersion").textValue())
                || !"core/rfb.js".equals(manifest.path("entry").textValue())
                || !manifest.path("publicAssets").isArray() || manifest.path("publicAssets").isEmpty()
                || manifest.path("publicAssets").size() > 512 || !manifest.path("files").isObject()) {
                throw new IllegalStateException("Trusted desktop viewer manifest has an invalid schema");
            }
            for (JsonNode path : manifest.path("publicAssets")) {
                String name = path.textValue();
                if (!moduleName(name) || assets.containsKey("/" + name)) {
                    throw new IllegalStateException("Trusted desktop viewer manifest has an invalid or duplicate module");
                }
                JsonNode metadata = manifest.path("files").path(name);
                if (!metadata.isObject() || !metadata.path("sha256").isTextual()
                    || !metadata.path("sha256").textValue().matches("[0-9a-f]{64}")
                    || !metadata.path("bytes").isIntegralNumber() || !metadata.path("bytes").canConvertToLong()
                    || metadata.path("bytes").longValue() < 0) {
                    throw new IllegalStateException("Trusted desktop viewer module metadata is invalid: " + name);
                }
                byte[] bytes = asset(name);
                String sha256 = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
                if (bytes.length != metadata.path("bytes").longValue() || !sha256.equals(metadata.path("sha256").textValue())) {
                    throw new IllegalStateException("Trusted desktop viewer module integrity mismatch: " + name);
                }
                assets.put("/" + name, bytes);
            }
            if (!assets.containsKey("/core/rfb.js")) {
                throw new IllegalStateException("Trusted desktop viewer manifest does not include its entry module");
            }
            return Map.copyOf(assets);
        } catch (IOException | NoSuchAlgorithmException failure) {
            throw new IllegalStateException("Failed to load trusted desktop viewer manifest", failure);
        }
    }

    private static boolean moduleName(String name) {
        return name != null && name.length() <= 256 && name.matches("(?:core|vendor)/[A-Za-z0-9_./-]+\\.js")
            && java.util.Arrays.stream(name.split("/", -1)).noneMatch(part -> part.isEmpty() || ".".equals(part) || "..".equals(part));
    }

    private static byte[] asset(String name) {
        try (var input = new ClassPathResource("desktop-viewer/v1/" + name).getInputStream()) { return input.readAllBytes(); }
        catch (IOException failure) { throw new IllegalStateException("Trusted desktop viewer asset missing: " + name, failure); }
    }
}
