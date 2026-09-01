package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import java.net.URI;
import java.util.Map;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class WeixinOpenPlatformConfigResolver {
    private final Environment environment;

    public WeixinOpenPlatformConfigResolver(Environment environment) {
        this.environment = environment;
    }

    public WeixinOpenPlatformConfig resolveDefault() {
        return resolve(Map.of(
            "componentAppidEnv", "WECHAT_COMPONENT_APPID",
            "componentAppsecretEnv", "WECHAT_COMPONENT_APPSECRET",
            "callbackTokenEnv", "WECHAT_COMPONENT_CALLBACK_TOKEN",
            "encodingAesKeyEnv", "WECHAT_COMPONENT_ENCODING_AES_KEY",
            "redirectUriEnv", "WECHAT_COMPONENT_REDIRECT_URI"
        ));
    }

    public WeixinOpenPlatformConfig resolve(Map<String, Object> providerConfig) {
        String componentAppid = value(providerConfig, "componentAppidEnv");
        String componentAppsecret = value(providerConfig, "componentAppsecretEnv");
        String callbackToken = value(providerConfig, "callbackTokenEnv");
        String encodingAesKey = value(providerConfig, "encodingAesKeyEnv");
        String redirectUri = value(providerConfig, "redirectUriEnv");
        validateRedirectUri(redirectUri);
        return new WeixinOpenPlatformConfig(
            componentAppid, componentAppsecret, callbackToken, encodingAesKey, redirectUri);
    }

    private String value(Map<String, Object> providerConfig, String key) {
        Object name = providerConfig == null ? null : providerConfig.get(key);
        if (name == null || !StringUtils.hasText(name.toString())) {
            throw new IllegalStateException("Weixin Open Platform configuration is incomplete");
        }
        String value = environment.getProperty(name.toString());
        if (!StringUtils.hasText(value)) {
            throw new IllegalStateException("Weixin Open Platform configuration is incomplete");
        }
        return value.trim();
    }

    private void validateRedirectUri(String value) {
        try {
            URI uri = URI.create(value);
            if (!uri.isAbsolute() || !"https".equalsIgnoreCase(uri.getScheme()) || !StringUtils.hasText(uri.getHost())) {
                throw new IllegalArgumentException();
            }
        } catch (RuntimeException e) {
            throw new IllegalStateException("Weixin Open Platform redirect URI is invalid");
        }
    }
}
