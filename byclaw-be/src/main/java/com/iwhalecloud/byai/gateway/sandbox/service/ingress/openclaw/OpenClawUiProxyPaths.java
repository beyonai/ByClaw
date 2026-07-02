package com.iwhalecloud.byai.gateway.sandbox.service.ingress.openclaw;

import java.net.URI;

import org.apache.commons.lang3.StringUtils;

/**
 * OpenClaw 控制台整页代理的路径工具：集中路由前缀，并把 openclaw 原始访问地址
 * （{@code http://ip:port/path?query}）转换成对外可访问的网关代理地址
 * （{@code {webBaseUrl}/byaiService/openclaw-ui/{ip}/{port}/path?query}）。
 */
public final class OpenClawUiProxyPaths {

    /** 整页代理路由前缀（相对 context-path）。 */
    public static final String ROUTE_PREFIX = "/openclaw-ui";

    private OpenClawUiProxyPaths() {
    }

    /**
     * 把 openclaw 原始 endpoint 改写为经网关的代理地址。
     *
     * @param rawEndpoint openclaw 原始地址，如 {@code http://10.10.168.200:45421/chat?token=xxx}
     * @param webBaseUrl  Web 前端基础地址（协议+域名[+端口]），如 {@code https://example.com}；
     *                    为空时回退为相对路径（不含 host）
     * @param contextPath 网关 context-path（如 {@code /byaiService}），取自配置
     *                    {@code server.servlet.context-path}；为空按无前缀处理
     * @return 代理地址，解析失败时原样返回 rawEndpoint
     */
    public static String toProxyUrl(String rawEndpoint, String webBaseUrl, String contextPath) {
        if (StringUtils.isBlank(rawEndpoint)) {
            return rawEndpoint;
        }
        try {
            URI uri = URI.create(rawEndpoint.trim());
            String host = uri.getHost();
            int port = uri.getPort();
            if (StringUtils.isBlank(host) || port < 0) {
                return rawEndpoint;
            }
            String path = StringUtils.defaultIfBlank(uri.getRawPath(), "/");
            String query = uri.getRawQuery();
            String base = StringUtils.isBlank(webBaseUrl) ? "" : StringUtils.removeEnd(webBaseUrl.trim(), "/");
            String ctx = StringUtils.isBlank(contextPath) ? "" : StringUtils.removeEnd(contextPath.trim(), "/");
            StringBuilder url = new StringBuilder(base)
                .append(ctx).append(ROUTE_PREFIX)
                .append('/').append(host).append('/').append(port)
                .append(path.startsWith("/") ? path : "/" + path);
            if (StringUtils.isNotBlank(query)) {
                url.append('?').append(query);
            }
            return url.toString();
        }
        catch (Exception e) {
            return rawEndpoint;
        }
    }
}
