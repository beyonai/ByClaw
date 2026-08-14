package com.iwhalecloud.byai.manager.domain.usermcp;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.Set;
import java.util.function.Supplier;

import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class McpEndpointPolicy {

    private final Set<Integer> allowedPorts;
    private static final String ALLOWED_ADDRESSES_PARAM = "BYAI_MCP_ALLOWED_ADDRESSES";

    private final Supplier<Set<String>> allowedHosts;

    @Autowired
    public McpEndpointPolicy(SystemConfigService systemConfigService) {
        this(Set.of(443), () -> parseHosts(systemConfigService.getStringParamValueByCode(ALLOWED_ADDRESSES_PARAM)));
    }

    McpEndpointPolicy(String allowedHosts) {
        this(Set.of(443), () -> parseHosts(allowedHosts));
    }

    McpEndpointPolicy(
            Set<Integer> allowedPorts,
            Supplier<Set<String>> allowedHosts) {
        this.allowedPorts = Set.copyOf(allowedPorts);
        this.allowedHosts = allowedHosts;
    }

    public URI validate(String domainUrl, String serverPath) {
        if (!StringUtils.hasText(domainUrl) || !StringUtils.hasText(serverPath)) {
            throw new IllegalArgumentException("MCP endpoint is required");
        }
        URI base = parse(domainUrl.trim());
        Set<String> approvedHosts = allowedHosts.get();
        requireSafeBase(base, approvedHosts);
        if (!serverPath.startsWith("/") || serverPath.startsWith("//")) {
            throw new IllegalArgumentException("MCP server path must be an origin-relative path");
        }
        URI path = parse(serverPath.trim());
        if (path.isAbsolute() || path.getHost() != null || path.getUserInfo() != null || path.getQuery() != null
                || path.getFragment() != null) {
            throw new IllegalArgumentException("MCP server path must not change origin or contain credentials");
        }
        URI endpoint = base.resolve(path).normalize();
        requireSafeBase(endpoint, approvedHosts);
        return endpoint;
    }

    private URI parse(String value) {
        try {
            return new URI(value);
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("Invalid MCP endpoint", e);
        }
    }

    private void requireSafeBase(URI uri, Set<String> approvedHosts) {
        if (!"https".equalsIgnoreCase(uri.getScheme()) || !StringUtils.hasText(uri.getHost())) {
            throw new IllegalArgumentException("MCP endpoint must use HTTPS with a host");
        }
        if (uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) {
            throw new IllegalArgumentException("MCP endpoint must not contain userinfo, query or fragment");
        }
        if (!approvedHosts.contains(uri.getHost().toLowerCase())) {
            throw new IllegalArgumentException("MCP endpoint host is not approved by an administrator");
        }
        int effectivePort = uri.getPort() < 0 ? 443 : uri.getPort();
        if (!allowedPorts.contains(effectivePort)) {
            throw new IllegalArgumentException("MCP endpoint port is not allowed");
        }
    }

    private static Set<String> parseHosts(String configured) {
        if (!StringUtils.hasText(configured)) {
            return Set.of();
        }
        return Arrays.stream(configured.split(","))
            .map(String::trim).map(String::toLowerCase).filter(StringUtils::hasText).collect(java.util.stream.Collectors.toSet());
    }
}
