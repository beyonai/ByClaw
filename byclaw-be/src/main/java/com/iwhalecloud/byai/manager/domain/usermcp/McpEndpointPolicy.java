package com.iwhalecloud.byai.manager.domain.usermcp;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;

import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class McpEndpointPolicy {

    private final AddressResolver resolver;
    private final Set<Integer> allowedPorts;
    private static final String ALLOWED_ADDRESSES_PARAM = "BYAI_MCP_ALLOWED_ADDRESSES";

    private final Supplier<Set<String>> allowedHosts;
    private final boolean requireIpLiteral;

    @Autowired
    public McpEndpointPolicy(SystemConfigService systemConfigService) {
        this(host -> Arrays.asList(InetAddress.getAllByName(host)), Set.of(443),
            () -> parseHosts(systemConfigService.getStringParamValueByCode(ALLOWED_ADDRESSES_PARAM)), true);
    }

    McpEndpointPolicy(String allowedHosts) {
        this(host -> Arrays.asList(InetAddress.getAllByName(host)), Set.of(443),
            () -> parseHosts(allowedHosts), true);
    }

    McpEndpointPolicy(AddressResolver resolver, Set<Integer> allowedPorts) {
        this(resolver, allowedPorts, Set.of("mcp.example.com"));
    }

    McpEndpointPolicy(AddressResolver resolver, Set<Integer> allowedPorts, Set<String> allowedHosts) {
        this(resolver, allowedPorts, () -> Set.copyOf(allowedHosts), false);
    }

    McpEndpointPolicy(
            AddressResolver resolver,
            Set<Integer> allowedPorts,
            Supplier<Set<String>> allowedHosts,
            boolean requireIpLiteral) {
        this.resolver = resolver;
        this.allowedPorts = Set.copyOf(allowedPorts);
        this.allowedHosts = allowedHosts;
        this.requireIpLiteral = requireIpLiteral;
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
        resolvePublicAddresses(endpoint.getHost());
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
        if (requireIpLiteral && !isIpLiteral(uri.getHost())) {
            throw new IllegalArgumentException("MCP endpoint must use an approved public IP literal");
        }
        int effectivePort = uri.getPort() < 0 ? 443 : uri.getPort();
        if (!allowedPorts.contains(effectivePort)) {
            throw new IllegalArgumentException("MCP endpoint port is not allowed");
        }
    }

    private void resolvePublicAddresses(String host) {
        List<InetAddress> addresses;
        try {
            addresses = resolver.resolve(host);
        } catch (UnknownHostException e) {
            throw new IllegalArgumentException("MCP endpoint host cannot be resolved", e);
        }
        if (addresses == null || addresses.isEmpty() || addresses.stream().anyMatch(this::isBlocked)) {
            throw new IllegalArgumentException("MCP endpoint resolves to a blocked address");
        }
    }

    private boolean isBlocked(InetAddress address) {
        if (address == null || address.isAnyLocalAddress() || address.isLoopbackAddress()
                || address.isLinkLocalAddress() || address.isSiteLocalAddress() || address.isMulticastAddress()) {
            return true;
        }
        byte[] bytes = address.getAddress();
        if (address instanceof Inet4Address) {
            int first = Byte.toUnsignedInt(bytes[0]);
            int second = Byte.toUnsignedInt(bytes[1]);
            int third = Byte.toUnsignedInt(bytes[2]);
            return first == 0 || first >= 224
                || (first == 100 && second >= 64 && second <= 127)
                || (first == 192 && second == 0 && third == 0)
                || (first == 192 && second == 0 && third == 2)
                || (first == 198 && (second == 18 || second == 19))
                || (first == 198 && second == 51 && third == 100)
                || (first == 203 && second == 0 && third == 113);
        }
        if (address instanceof Inet6Address) {
            if (isIpv4Mapped(bytes)) {
                try {
                    return isBlocked(InetAddress.getByAddress(Arrays.copyOfRange(bytes, 12, 16)));
                } catch (UnknownHostException e) {
                    return true;
                }
            }
            int first = Byte.toUnsignedInt(bytes[0]);
            int second = Byte.toUnsignedInt(bytes[1]);
            return (first & 0xfe) == 0xfc
                || (first == 0x20 && second == 0x01 && Byte.toUnsignedInt(bytes[2]) == 0x0d
                    && Byte.toUnsignedInt(bytes[3]) == 0xb8);
        }
        return true;
    }

    private boolean isIpv4Mapped(byte[] bytes) {
        if (bytes.length != 16 || Byte.toUnsignedInt(bytes[10]) != 0xff || Byte.toUnsignedInt(bytes[11]) != 0xff) {
            return false;
        }
        for (int i = 0; i < 10; i++) {
            if (bytes[i] != 0) {
                return false;
            }
        }
        return true;
    }

    private static Set<String> parseHosts(String configured) {
        if (!StringUtils.hasText(configured)) {
            return Set.of();
        }
        return Arrays.stream(configured.split(","))
            .map(String::trim).map(String::toLowerCase).filter(StringUtils::hasText).collect(java.util.stream.Collectors.toSet());
    }

    private static boolean isIpLiteral(String host) {
        if (!StringUtils.hasText(host)) {
            return false;
        }
        String normalized = host.startsWith("[") && host.endsWith("]") ? host.substring(1, host.length() - 1) : host;
        if (normalized.contains(":")) {
            return normalized.matches("[0-9a-fA-F:.%]+")
                && (!normalized.contains(".") || normalized.toLowerCase().contains("::ffff:"));
        }
        String[] parts = normalized.split("\\.", -1);
        if (parts.length != 4) {
            return false;
        }
        try {
            return Arrays.stream(parts).mapToInt(Integer::parseInt).allMatch(value -> value >= 0 && value <= 255);
        } catch (NumberFormatException e) {
            return false;
        }
    }

    @FunctionalInterface
    interface AddressResolver {
        List<InetAddress> resolve(String host) throws UnknownHostException;
    }
}
