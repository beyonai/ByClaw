package com.iwhalecloud.byai.gateway.sandbox.service.ingress.vnc;

import java.util.Map;
import java.util.HashMap;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeResolver;
import okhttp3.HttpUrl;

/** Only server-declared endpoints of the logged-in user's exact sandbox may be proxied. */
@Service
public class SandboxVncTargetResolver {
    public static final String PREFIX = "/sandbox/vnc/";
    private final SandboxService sandboxes;
    private final SandboxIngressRuntimeResolver runtime;

    public SandboxVncTargetResolver(SandboxService sandboxes, SandboxIngressRuntimeResolver runtime) {
        this.sandboxes = sandboxes;
        this.runtime = runtime;
    }

    public record Target(HttpUrl url, Map<String, String> headers) {}

    public static Map<String, String> viewerEndpoints(SandboxInfo sandbox) {
        Map<String, String> endpoints = new HashMap<>();
        if (sandbox.getInstanceEndpoints() == null) return endpoints;
        endpoints.putAll(sandbox.getInstanceEndpoints());
        for (String instance : List.of("vnc", "desktop")) {
            if (endpoints.containsKey(instance) && sandbox.getSandboxId() != null) {
                String path = "/byaiService" + PREFIX + sandbox.getSandboxId() + "/" + instance + "/";
                // noVNC builds its websocket path from this parameter, not from the document directory.
                endpoints.put(instance, path + "?path=" + path.substring(1) + "websockify");
            }
        }
        return endpoints;
    }

    public Target resolve(String path, String query) {
        String user = CurrentUserHolder.getCurrentUserCode();
        if (user == null || user.isBlank()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        if (!path.startsWith(PREFIX)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        String[] parts = path.substring(PREFIX.length()).split("/", 3);
        if (parts.length < 2 || !parts[0].matches("[A-Za-z0-9_-]{1,160}")
            || !List.of("vnc", "desktop").contains(parts[1])) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        String suffix = parts.length == 3 ? parts[2] : "";
        // Reject encoded separators/dot-segments before URL normalization can escape a proxy base path.
        for (String segment : suffix.split("/", -1)) {
            String decoded = java.net.URLDecoder.decode(segment, java.nio.charset.StandardCharsets.UTF_8);
            if (decoded.equals(".") || decoded.equals("..") || decoded.contains("/")
                || decoded.contains("\\") || decoded.contains("%") || decoded.indexOf(0) >= 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
            }
        }
        List<SandboxInfo> owned = sandboxes.sandboxInfo(user);
        if (owned != null) for (SandboxInfo sandbox : owned) {
            if (sandbox == null || !parts[0].equals(sandbox.getSandboxId())) continue;
            String endpoint = sandbox.getInstanceEndpoints() == null ? null : sandbox.getInstanceEndpoints().get(parts[1]);
            if (endpoint == null || endpoint.isBlank()) continue;
            HttpUrl url = runtime.resolve().buildTargetUrl(endpoint, "/" + suffix, null);
            HttpUrl.Builder builder = url.newBuilder();
            // The declared endpoint owns authentication; browser parameters cannot override it.
            HttpUrl incoming = HttpUrl.parse("http://request.invalid/?" + (query == null ? "" : query));
            for (String key : incoming.queryParameterNames()) {
                if (!key.equals("sessionId") || url.queryParameterNames().contains(key)) continue;
                for (String value : incoming.queryParameterValues(key)) builder.addQueryParameter(key, value);
            }
            HttpUrl targetUrl = builder.build();
            var requestBuilder = new okhttp3.Request.Builder().url(targetUrl);
            runtime.resolve().customizeRequest(requestBuilder,
                new com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRequestContext(
                    com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressInstanceType.NOVNC,
                    parts[1], user, endpoint, "GET", "/" + suffix, query, targetUrl, null,
                    CurrentUserHolder.getLoginInfo(), Map.of()));
            Map<String, String> headers = new HashMap<>();
            for (String name : requestBuilder.build().headers().names()) {
                headers.put(name, requestBuilder.build().header(name));
            }
            if (sandbox.getEndpointHeaders() != null) headers.putAll(sandbox.getEndpointHeaders());
            return new Target(targetUrl, Map.copyOf(headers));
        }
        throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }
}
