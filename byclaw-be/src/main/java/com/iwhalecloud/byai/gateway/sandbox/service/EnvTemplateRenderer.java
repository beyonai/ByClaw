package com.iwhalecloud.byai.gateway.sandbox.service;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Render env file templates.
 *
 * Supported placeholders:
 * - ${userInfo.<key>}
 * - ${envVars.<key>} or ${env.<key>}
 */
public class EnvTemplateRenderer {

    private static final Logger log = LoggerFactory.getLogger(EnvTemplateRenderer.class);
    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{([^}]+)}");

    public String render(String template,
                           Map<String, Object> userInfo,
                           Map<String, String> envVars) {
        if (template == null) {
            return "";
        }

        Matcher matcher = PLACEHOLDER.matcher(template);
        StringBuffer sb = new StringBuffer();
        while (matcher.find()) {
            String expr = matcher.group(1).trim();
            String replacement = resolve(expr, userInfo, envVars);
            matcher.appendReplacement(sb, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    private String resolve(String expr,
                             Map<String, Object> userInfo,
                             Map<String, String> envVars) {
        if (expr.startsWith("userInfo.")) {
            String key = expr.substring("userInfo.".length());
            Object value = userInfo != null ? userInfo.get(key) : null;
            if (value == null) {
                log.warn("Missing userInfo key in env template: {}", key);
                return "";
            }
            return value.toString();
        }

        if (expr.startsWith("envVars.")) {
            String key = expr.substring("envVars.".length());
            String value = envVars != null ? envVars.get(key) : null;
            if (value == null) {
                // keep empty to avoid breaking launch due to optional env template vars
                return "";
            }
            return value;
        }

        if (expr.startsWith("env.")) {
            String key = expr.substring("env.".length());
            String value = envVars != null ? envVars.get(key) : null;
            if (value == null) {
                return "";
            }
            return value;
        }

        String value = envVars != null ? envVars.get(expr) : null;
        if (StringUtils.isNotEmpty(value)) {
            return value;
        }

        // unknown placeholder -> empty
        log.warn("Unknown env template placeholder: {}", expr);
        return "";
    }
}

