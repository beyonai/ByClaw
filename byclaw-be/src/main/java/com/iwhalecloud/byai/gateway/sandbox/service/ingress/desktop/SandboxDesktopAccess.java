package com.iwhalecloud.byai.gateway.sandbox.service.ingress.desktop;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import okhttp3.HttpUrl;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriUtils;

/** Resolves a browser-visible reference against the current owner's live allocation. */
@Service
public class SandboxDesktopAccess {
    public static final String PREFIX = "/sandbox/desktop/";
    private final SandboxService sandboxes;
    private final SsSandboxRecordMapper records;
    private final Set<String> allowedOrigins;

    public SandboxDesktopAccess(SandboxService sandboxes, SsSandboxRecordMapper records,
        @Value("${sandbox.desktop.allowed-origins:${SANDBOX_DESKTOP_ALLOWED_ORIGINS:}}") String allowedOrigins) {
        this.sandboxes = sandboxes;
        this.records = records;
        this.allowedOrigins = parseAllowedOrigins(allowedOrigins);
    }

    public record Target(HttpUrl endpoint, HttpUrl url, Map<String, String> headers, String publicPrefix) {
        public Target { headers = headers == null ? Map.of() : Map.copyOf(headers); }
    }

    public static boolean eligible(SandboxInfo info, String instance) {
        Map<String, String> descriptor = info.getInstanceDescriptors() == null ? null : info.getInstanceDescriptors().get(instance);
        return descriptor == null ? List.of("vnc", "desktop").contains(instance) : "novnc".equals(descriptor.get("viewer"));
    }

    /** Projection only: runtime SSH consumers must retain their original endpoint map. */
    public static Map<String, String> navigationEndpoints(SandboxInfo info, String contextPath) {
        Map<String, String> endpoints = info.getInstanceEndpoints();
        if (endpoints == null || info.getEndpointHeaders() == null || info.getEndpointHeaders().isEmpty()) return endpoints;
        if (!identifier(info.getSandboxId()) || (Boolean.TRUE.equals(info.getIsShared()) && !identifier(info.getMappingId()))) return endpoints;
        Map<String, String> projected = new LinkedHashMap<>(endpoints);
        endpoints.forEach((instance, endpoint) -> {
            if (identifier(instance) && eligible(info, instance)) {
                HttpUrl upstream = HttpUrl.parse(Objects.toString(endpoint, ""));
                if (upstream == null) return;
                String scope = Boolean.TRUE.equals(info.getIsShared()) ? "shared/" + encode(info.getMappingId()) + "/" : "exclusive/";
                String ctx = contextPath == null || "/".equals(contextPath) ? "" : contextPath.replaceAll("/+$", "");
                String prefix = ctx + PREFIX + scope + encode(info.getSandboxId()) + "/" + encode(instance);
                String entry = htmlEntry(upstream);
                HttpUrl.Builder navigation = HttpUrl.parse("http://navigation.invalid" + prefix + (entry == null ? "/" : "/" + entry)).newBuilder();
                for (String name : List.of("sessionId", "autoconnect", "resize", "hideHeader", "view_only", "reconnect", "reconnect_delay")) {
                    String value = upstream.queryParameter(name);
                    if (value != null) navigation.addQueryParameter(name, value);
                }
                if (entry != null) {
                    String wsPath = prefix.replaceFirst("^/", "") + "/websockify";
                    String sessionId = upstream.queryParameter("sessionId");
                    if (sessionId != null) wsPath += "?sessionId=" + UriUtils.encodeQueryParam(sessionId, StandardCharsets.UTF_8);
                    navigation.addQueryParameter("path", wsPath);
                }
                HttpUrl url = navigation.build();
                projected.put(instance, url.encodedPath() + (url.encodedQuery() == null ? "" : "?" + url.encodedQuery()));
            }
        });
        return projected;
    }

    public Target resolve(HttpServletRequest request, boolean websocket) {
        LoginInfo login = CurrentUserHolder.getLoginInfo();
        HttpSession session = request.getSession(false);
        if (login == null || login.getUserCode() == null || login.getUserId() == null || login.getUserId() <= 0
            || session == null || !login.getUserCode().equals(session.getAttribute("USER_CODE"))) {
            throw denied(HttpStatus.UNAUTHORIZED);
        }
        // Preserve the existing directory's authority, including legacy Sessions without tenant membership rows.
        // A URL or header cannot replace the enterprise selected in the authenticated Session.
        if (!Objects.equals(Objects.toString(login.getEnterpriseId(), null), Objects.toString(session.getAttribute("enterpriseId"), null))) {
            throw denied(HttpStatus.UNAUTHORIZED);
        }
        String path = request.getRequestURI().substring(request.getContextPath().length());
        if (!path.startsWith(PREFIX)) throw denied(HttpStatus.NOT_FOUND);
        String[] parts = path.substring(PREFIX.length()).split("/", -1);
        boolean shared = parts.length >= 4 && "shared".equals(parts[0]);
        int idIndex = shared ? 2 : 1;
        int instanceIndex = idIndex + 1;
        if ((!shared && !"exclusive".equals(parts[0])) || parts.length <= instanceIndex
            || !identifier(decode(parts[idIndex])) || !identifier(decode(parts[instanceIndex])) || (shared && !identifier(decode(parts[1])))) {
            throw denied(HttpStatus.NOT_FOUND);
        }
        String sandboxId = decode(parts[idIndex]), instance = decode(parts[instanceIndex]), mappingId = shared ? decode(parts[1]) : null;
        String publicPrefix = request.getContextPath() + PREFIX
            + String.join("/", java.util.Arrays.copyOfRange(parts, 0, instanceIndex + 1));
        String suffix = path.substring(publicPrefix.length() - request.getContextPath().length());
        validateSuffix(suffix);
        if (websocket) {
            if (!"GET".equals(request.getMethod()) || !"/websockify".equals(suffix) || !sameOrigin(request)) throw denied(HttpStatus.FORBIDDEN);
        } else if (!List.of("GET", "HEAD").contains(request.getMethod())) {
            if (!"POST".equals(request.getMethod()) || !"/goal".equals(suffix)
                || !"1".equals(request.getHeader("x-browser-goal-control")) || !sameOrigin(request)) throw denied(HttpStatus.METHOD_NOT_ALLOWED);
        }
        List<SandboxInfo> directory = sandboxes.sandboxInfo(login.getUserCode(), sandboxId);
        SandboxInfo info = directory == null ? null : directory.stream().filter(row -> row != null
            && sandboxId.equals(row.getSandboxId()) && shared == Boolean.TRUE.equals(row.getIsShared())
            && Objects.equals(mappingId, row.getMappingId())).findFirst().orElse(null);
        if (info == null || !eligible(info, instance) || info.getInstanceEndpoints() == null
            || (info.getUserCode() != null && !login.getUserCode().equals(info.getUserCode()))) throw denied(HttpStatus.NOT_FOUND);
        if (!shared) {
            SsSandboxRecord record = records.selectLatestBySandboxId(login.getUserCode(), info.getSandboxType(), sandboxId);
            if (record == null || !"RUNNING".equals(record.getStatus())) throw denied(HttpStatus.NOT_FOUND);
        }
        HttpUrl endpoint = HttpUrl.parse(Objects.toString(info.getInstanceEndpoints().get(instance), ""));
        if (endpoint == null || !endpoint.username().isEmpty() || !endpoint.password().isEmpty() || endpoint.fragment() != null) throw denied(HttpStatus.NOT_FOUND);
        if (htmlEntry(endpoint) != null) {
            String parent = endpoint.encodedPath().substring(0, endpoint.encodedPath().lastIndexOf('/') + 1);
            endpoint = endpoint.newBuilder().encodedPath(parent).build();
        }
        String basePath = endpoint.encodedPath().replaceAll("/+$", "");
        HttpUrl.Builder target = endpoint.newBuilder().encodedPath(basePath + (suffix.isEmpty() ? "/" : suffix));
        if (request.getQueryString() != null) {
            HttpUrl query = HttpUrl.parse("http://query.invalid/?" + request.getQueryString());
            if (query == null) throw denied(HttpStatus.BAD_REQUEST);
            for (int i = 0; i < query.querySize(); i++) {
                String name = query.queryParameterName(i);
                if (!List.of("token", "beyondtoken", "beyond-token", "authorization", "cookie").contains(name.toLowerCase(java.util.Locale.ROOT))) {
                    if (endpoint.queryParameterNames().contains(name)) {
                        if ("sessionId".equals(name) && !Objects.equals(endpoint.queryParameter(name), query.queryParameterValue(i))) {
                            throw denied(HttpStatus.FORBIDDEN);
                        }
                    } else {
                        target.addQueryParameter(name, query.queryParameterValue(i));
                    }
                }
            }
        }
        return new Target(endpoint, target.build(), info.getEndpointHeaders(), publicPrefix);
    }

    private static void validateSuffix(String suffix) {
        String decoded;
        try { decoded = URLDecoder.decode(suffix, StandardCharsets.UTF_8); }
        catch (IllegalArgumentException invalid) { throw denied(HttpStatus.BAD_REQUEST); }
        if (decoded.indexOf('\0') >= 0 || decoded.indexOf('\\') >= 0 || decoded.contains("%")
            || java.util.Arrays.asList(decoded.split("/", -1)).contains("..")
            || suffix.toLowerCase(java.util.Locale.ROOT).contains("%2f")) throw denied(HttpStatus.BAD_REQUEST);
    }

    private static boolean identifier(String value) {
        return value != null && !value.isEmpty() && value.length() <= 256 && value.equals(value.trim())
            && !value.contains("/") && !value.contains("\\") && !value.equals(".") && !value.equals("..")
            && value.codePoints().noneMatch(Character::isISOControl);
    }

    private static String htmlEntry(HttpUrl endpoint) {
        String path = endpoint.encodedPath();
        return path.toLowerCase(java.util.Locale.ROOT).endsWith(".html") ? path.substring(path.lastIndexOf('/') + 1) : null;
    }

    private static String encode(String value) { return UriUtils.encodePathSegment(value, StandardCharsets.UTF_8); }

    private static String decode(String value) {
        try { return UriUtils.decode(value, StandardCharsets.UTF_8); }
        catch (IllegalArgumentException invalid) { throw denied(HttpStatus.BAD_REQUEST); }
    }

    private boolean sameOrigin(HttpServletRequest request) {
        URI origin = parseOrigin(request.getHeader("Origin"));
        if (origin == null) return false;
        String site = request.getHeader("Sec-Fetch-Site");
        // This browser-forbidden header preserves the same-origin decision through a host-rewriting proxy.
        if (site != null) return "same-origin".equals(site);
        return (origin.getScheme().equalsIgnoreCase(request.getScheme()) && origin.getHost().equalsIgnoreCase(request.getServerName())
            && originPort(origin) == request.getServerPort()) || allowedOrigins.contains(originKey(origin));
    }

    private static Set<String> parseAllowedOrigins(String value) {
        if (value == null || value.isBlank()) return Set.of();
        Set<String> origins = new HashSet<>();
        for (String entry : value.split(",", -1)) {
            URI origin = parseOrigin(entry.trim());
            if (origin == null) {
                throw new IllegalArgumentException("sandbox.desktop.allowed-origins requires complete HTTP(S) origins without paths, queries or credentials");
            }
            origins.add(originKey(origin));
        }
        return Set.copyOf(origins);
    }

    private static URI parseOrigin(String value) {
        try {
            URI origin = URI.create(Objects.toString(value, ""));
            if (!("http".equalsIgnoreCase(origin.getScheme()) || "https".equalsIgnoreCase(origin.getScheme())) || origin.getHost() == null
                || origin.getUserInfo() != null || origin.getRawQuery() != null || origin.getFragment() != null
                || (origin.getRawPath() != null && !origin.getRawPath().isEmpty()) || origin.getPort() == 0 || origin.getPort() > 65535
                || origin.getRawAuthority().endsWith(":") || origin.getRawAuthority().contains("%")) return null;
            return origin;
        } catch (IllegalArgumentException invalid) { return null; }
    }

    private static int originPort(URI origin) {
        return origin.getPort() >= 0 ? origin.getPort() : "https".equalsIgnoreCase(origin.getScheme()) ? 443 : 80;
    }

    private static String originKey(URI origin) {
        return origin.getScheme().toLowerCase(Locale.ROOT) + "://" + origin.getHost().toLowerCase(Locale.ROOT) + ":" + originPort(origin);
    }

    private static ResponseStatusException denied(HttpStatus status) {
        return new ResponseStatusException(status, "Desktop access unavailable");
    }
}
