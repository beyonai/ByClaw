package com.iwhalecloud.byai.common.util;

import lombok.Getter;

import java.net.MalformedURLException;
import java.net.URL;

/**
 * @author zht
 * @version 1.0
 * @date 2025/8/30
 */
public class UrlParserUtils {


    /**
     * Extracts service information and URI from a URL.
     *
     * @param urlString the URL string to parse
     * @return an UrlInfo object containing service information and URI
     * @throws MalformedURLException if the URL is invalid
     */
    public static UrlInfo parseUrl(String urlString) throws MalformedURLException {
        URL url = new URL(urlString);

        // Extract service information (protocol, host, port)
        StringBuilder serviceInfo = new StringBuilder();
        serviceInfo.append(url.getProtocol()).append("://").append(url.getHost());

        if (url.getPort() != -1) {
            serviceInfo.append(":").append(url.getPort());
        }

        // Extract URI (path, query, fragment)
        StringBuilder uri = new StringBuilder();
        if (url.getPath() != null && !url.getPath().isEmpty()) {
            uri.append(url.getPath());
        } else {
            uri.append("/");
        }

        if (url.getQuery() != null) {
            uri.append("?").append(url.getQuery());
        }

        if (url.getRef() != null) {
            uri.append("#").append(url.getRef());
        }

        return new UrlInfo(serviceInfo.toString(), uri.toString());
    }


    /**
     * A class to hold both service information and URI.
     */
    @Getter
    public static class UrlInfo {
        private final String serviceInfo;
        private final String uri;

        public UrlInfo(String serviceInfo, String uri) {
            this.serviceInfo = serviceInfo;
            this.uri = uri;
        }

        @Override
        public String toString() {
            return "UrlInfo{" +
                    "serviceInfo='" + serviceInfo + '\'' +
                    ", uri='" + uri + '\'' +
                    '}';
        }
    }

}
