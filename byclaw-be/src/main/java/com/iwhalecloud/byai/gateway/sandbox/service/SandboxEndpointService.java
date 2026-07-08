package com.iwhalecloud.byai.gateway.sandbox.service;

import java.lang.reflect.Array;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.Map;

import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import org.apache.commons.lang3.StringUtils;
import com.iwhalecloud.byai.gateway.sandbox.support.SandboxEndpointRecordSupport;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import okhttp3.Request;

@Service
public class SandboxEndpointService {
  private final SsSandboxRecordMapper sandboxRecordMapper;
  private final SandboxLaunchContextFactory sandboxLaunchContextFactory;

  public SandboxEndpointService(
      @Lazy SsSandboxRecordMapper sandboxRecordMapper,
      @Lazy SandboxLaunchContextFactory sandboxLaunchContextFactory) {
    this.sandboxRecordMapper = sandboxRecordMapper;
    this.sandboxLaunchContextFactory = sandboxLaunchContextFactory;
  }

  public String resolveSandboxHttpUrl(String userCode, Long resourceId, String routePath, Map<String, ?> searchQuery) {
    SandboxLaunchRouting routing = sandboxLaunchContextFactory.resolveRouting(resourceId, userCode);
    SsSandboxRecord existingRecord = sandboxRecordMapper.selectActiveByUserAndResource(userCode,
        routing.getSandboxType(), routing.getEffectiveResourceId());
    if (existingRecord == null) {
      return null;
    }
    String endpoint = existingRecord.getEndpoint();
    if (StringUtils.isBlank(endpoint)) {
      return null;
    }
    String rawEndpoint = SandboxEndpointRecordSupport.resolveInstanceEndpoint(endpoint,
        SandboxEndpointRecordSupport.OPENCLAW_INSTANCE);
    if (StringUtils.isBlank(rawEndpoint)) {
      return null;
    }
    try {
      URI uri = URI.create(rawEndpoint.trim());
      String path = appendRoutePath(removeTrailingChatPath(uri.getRawPath()), routePath);
      String query = appendSearchQuery(uri.getRawQuery(), searchQuery);
      return buildUrl(uri, path, query);
    } catch (Exception e) {
      return null;
    }
  }

  public Request.Builder newAuthorizedRequestBuilder(String sandboxHttpUrl) {
    Request.Builder requestBuilder = new Request.Builder().url(sandboxHttpUrl);
    String token = extractQueryParam(sandboxHttpUrl, "token");
    if (StringUtils.isNotBlank(token)) {
      requestBuilder.header("Authorization", "Bearer " + token);
    }
    return requestBuilder;
  }

  public Request.Builder newAuthorizedRequestBuilder(String userCode, Long resourceId, String routePath,
      Map<String, ?> searchQuery) {
    String sandboxHttpUrl = resolveSandboxHttpUrl(userCode, resourceId, routePath, searchQuery);
    if (StringUtils.isBlank(sandboxHttpUrl)) {
      return null;
    }
    return newAuthorizedRequestBuilder(sandboxHttpUrl);
  }

  private String removeTrailingChatPath(String rawPath) {
    String path = StringUtils.defaultString(rawPath);
    if (path.endsWith("/chat")) {
      return path.substring(0, path.length() - "/chat".length());
    }
    return path;
  }

  private String appendRoutePath(String basePath, String routePath) {
    String base = StringUtils.defaultString(basePath);
    String route = StringUtils.defaultString(routePath).trim();
    if (StringUtils.isBlank(route)) {
      return base;
    }
    if (StringUtils.isBlank(base)) {
      return route.startsWith("/") ? route : "/" + route;
    }
    return StringUtils.removeEnd(base, "/") + "/" + StringUtils.removeStart(route, "/");
  }

  private String appendSearchQuery(String rawQuery, Map<String, ?> searchQuery) {
    String encodedSearchQuery = encodeSearchQuery(searchQuery);
    if (StringUtils.isBlank(encodedSearchQuery)) {
      return rawQuery;
    }
    if (StringUtils.isBlank(rawQuery)) {
      return encodedSearchQuery;
    }
    return rawQuery + "&" + encodedSearchQuery;
  }

  private String encodeSearchQuery(Map<String, ?> searchQuery) {
    if (searchQuery == null || searchQuery.isEmpty()) {
      return null;
    }
    StringBuilder query = new StringBuilder();
    searchQuery.forEach((key, value) -> appendQueryValue(query, key, value));
    return query.toString();
  }

  private void appendQueryValue(StringBuilder query, String key, Object value) {
    if (StringUtils.isBlank(key) || value == null) {
      return;
    }
    if (value instanceof Collection<?> values) {
      values.forEach(item -> appendQueryParam(query, key, item));
      return;
    }
    if (value.getClass().isArray()) {
      int length = Array.getLength(value);
      for (int i = 0; i < length; i++) {
        appendQueryParam(query, key, Array.get(value, i));
      }
      return;
    }
    appendQueryParam(query, key, value);
  }

  private void appendQueryParam(StringBuilder query, String key, Object value) {
    if (value == null) {
      return;
    }
    if (!query.isEmpty()) {
      query.append('&');
    }
    query.append(encodeQueryPart(key)).append('=').append(encodeQueryPart(value.toString()));
  }

  private String encodeQueryPart(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }

  private String buildUrl(URI uri, String rawPath, String rawQuery) {
    StringBuilder url = new StringBuilder();
    if (StringUtils.isNotBlank(uri.getScheme())) {
      url.append(uri.getScheme()).append(':');
    }
    if (StringUtils.isNotBlank(uri.getRawAuthority())) {
      url.append("//").append(uri.getRawAuthority());
    }
    if (StringUtils.isNotBlank(rawPath)) {
      url.append(rawPath.startsWith("/") ? rawPath : "/" + rawPath);
    }
    if (StringUtils.isNotBlank(rawQuery)) {
      url.append('?').append(rawQuery);
    }
    if (StringUtils.isNotBlank(uri.getRawFragment())) {
      url.append('#').append(uri.getRawFragment());
    }
    return url.toString();
  }

  private String extractQueryParam(String url, String name) {
    if (StringUtils.isBlank(url) || StringUtils.isBlank(name)) {
      return null;
    }
    try {
      String rawQuery = URI.create(url).getRawQuery();
      if (StringUtils.isBlank(rawQuery)) {
        return null;
      }
      for (String pair : rawQuery.split("&")) {
        String[] parts = pair.split("=", 2);
        if (parts.length == 2 && name.equals(URLDecoder.decode(parts[0], StandardCharsets.UTF_8))) {
          return URLDecoder.decode(parts[1], StandardCharsets.UTF_8);
        }
      }
    } catch (IllegalArgumentException e) {
      return null;
    }
    return null;
  }
}
