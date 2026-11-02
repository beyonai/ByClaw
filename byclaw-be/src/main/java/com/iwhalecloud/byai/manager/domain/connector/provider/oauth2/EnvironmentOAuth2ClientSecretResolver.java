package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class EnvironmentOAuth2ClientSecretResolver implements OAuth2ClientSecretResolver {
    private final Environment environment;

    public EnvironmentOAuth2ClientSecretResolver(Environment environment) {
        this.environment = environment;
    }

    @Override
    public String resolve(String environmentName) {
        if (!StringUtils.hasText(environmentName) || !environmentName.matches("[A-Z_][A-Z0-9_]{0,127}")) {
            throw new IllegalArgumentException(I18nUtil.get("connector.oauth.secretEnvInvalid"));
        }
        String value = environment.getProperty(environmentName);
        if (!StringUtils.hasText(value)) {
            throw new IllegalStateException(I18nUtil.get("connector.oauth.secretMissing"));
        }
        return value;
    }
}
