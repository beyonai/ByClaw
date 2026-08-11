package com.iwhalecloud.byai.state.domain.sys.service;

import java.util.Locale;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import jakarta.annotation.PostConstruct;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Resolves customer-facing business terminology without changing internal resource identifiers.
 *
 * @author qin.guoquan
 * @date 2026-08-11 17:09:38
 */
@Service
public class BusinessTerminologyService {

    public static final String CONFIG_CODE = "DIGITAL_EMPLOYEE_TERMINOLOGY";

    private static final Logger LOGGER = LoggerFactory.getLogger(BusinessTerminologyService.class);
    private static final String DEFAULT_ZH_SINGULAR = "数字员工";
    private static final String DEFAULT_ZH_PLURAL = "数字员工";
    private static final String DEFAULT_ZH_ENTRY = "员工";
    private static final String DEFAULT_ZH_MARKET = "员工市场";
    private static final String DEFAULT_EN_SINGULAR = "Digital Employee";
    private static final String DEFAULT_EN_PLURAL = "Digital Employees";
    private static final long CACHE_TTL_MILLIS = 5_000L;

    private volatile TerminologyConfig cachedConfig = TerminologyConfig.defaults();
    private volatile long cacheExpiresAt;

    @Autowired
    private ByaiSystemConfigService systemConfigService;

    @PostConstruct
    public void registerI18nTransformer() {
        I18nUtil.registerMessageTransformer(this::replaceDigitalEmployeeTerms);
    }

    public String digitalEmployee() {
        return resolveConfig().zhSingular();
    }

    public String digitalEmployees() {
        return resolveConfig().zhPlural();
    }

    public String employeeEntry() {
        return resolveConfig().zhEntry();
    }

    public String employeeMarket() {
        return resolveConfig().zhMarket();
    }

    /**
     * Replaces only unambiguous customer-facing terms. A standalone “员工” is deliberately not
     * replaced because it can refer to a real enterprise employee.
     */
    public String replaceDigitalEmployeeTerms(String text) {
        if (StringUtils.isEmpty(text)) {
            return text;
        }

        TerminologyConfig config = resolveConfig();
        String enSingular = config.enSingular();
        String enPlural = config.enPlural();
        String enSingularLower = enSingular.toLowerCase(Locale.ENGLISH);
        return text
            .replace(DEFAULT_ZH_MARKET, config.zhMarket())
            .replace(DEFAULT_ZH_SINGULAR, config.zhSingular())
            .replace("A Digital Employee", capitalizeFirst(withIndefiniteArticle(enSingular)))
            .replace("a Digital Employee", withIndefiniteArticle(enSingular))
            .replace("A digital employee", capitalizeFirst(withIndefiniteArticle(enSingularLower)))
            .replace("a digital employee", withIndefiniteArticle(enSingularLower))
            .replace(DEFAULT_EN_PLURAL, enPlural)
            .replace("Digital employees", enPlural)
            .replace(DEFAULT_EN_SINGULAR, enSingular)
            .replace("Digital employee", enSingular)
            .replace(DEFAULT_EN_PLURAL.toLowerCase(Locale.ENGLISH), enPlural.toLowerCase(Locale.ENGLISH))
            .replace(DEFAULT_EN_SINGULAR.toLowerCase(Locale.ENGLISH), enSingularLower);
    }

    private TerminologyConfig resolveConfig() {
        long now = System.currentTimeMillis();
        if (now < cacheExpiresAt) {
            return cachedConfig;
        }

        synchronized (this) {
            now = System.currentTimeMillis();
            if (now < cacheExpiresAt) {
                return cachedConfig;
            }

            cachedConfig = loadConfig();
            cacheExpiresAt = now + CACHE_TTL_MILLIS;
            return cachedConfig;
        }
    }

    private TerminologyConfig loadConfig() {
        try {
            String raw = systemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE);
            if (StringUtils.isBlank(raw)) {
                return TerminologyConfig.defaults();
            }
            JSONObject root = JSON.parseObject(raw);
            JSONObject zhConfig = root == null ? null : root.getJSONObject("zh-CN");
            JSONObject enConfig = root == null ? null : root.getJSONObject("en-US");
            return new TerminologyConfig(
                getValue(zhConfig, "singular", DEFAULT_ZH_SINGULAR),
                getValue(zhConfig, "plural", DEFAULT_ZH_PLURAL),
                getValue(zhConfig, "entry", DEFAULT_ZH_ENTRY),
                getValue(zhConfig, "market", DEFAULT_ZH_MARKET),
                getValue(enConfig, "singular", DEFAULT_EN_SINGULAR),
                getValue(enConfig, "plural", DEFAULT_EN_PLURAL));
        }
        catch (RuntimeException exception) {
            LOGGER.warn("Unable to load business terminology config, paramCode={}, reason={}", CONFIG_CODE,
                exception.getMessage());
            return TerminologyConfig.defaults();
        }
    }

    private String withIndefiniteArticle(String term) {
        char first = Character.toLowerCase(term.charAt(0));
        return "aeiou".indexOf(first) >= 0 ? "an " + term : "a " + term;
    }

    private String capitalizeFirst(String value) {
        return Character.toUpperCase(value.charAt(0)) + value.substring(1);
    }

    private String getValue(JSONObject localeConfig, String field, String defaultValue) {
        String configured = localeConfig == null ? null : localeConfig.getString(field);
        String normalized = StringUtils.trim(configured);
        if (StringUtils.isBlank(normalized) || normalized.length() > 40) {
            return defaultValue;
        }
        return normalized.chars().noneMatch(character -> "{}<>\r\n".indexOf(character) >= 0)
            ? normalized : defaultValue;
    }

    private record TerminologyConfig(String zhSingular, String zhPlural, String zhEntry, String zhMarket,
                                     String enSingular, String enPlural) {

        private static TerminologyConfig defaults() {
            return new TerminologyConfig(DEFAULT_ZH_SINGULAR, DEFAULT_ZH_PLURAL, DEFAULT_ZH_ENTRY, DEFAULT_ZH_MARKET,
                DEFAULT_EN_SINGULAR, DEFAULT_EN_PLURAL);
        }
    }
}
