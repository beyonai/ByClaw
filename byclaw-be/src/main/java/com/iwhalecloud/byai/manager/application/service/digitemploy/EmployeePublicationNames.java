package com.iwhalecloud.byai.manager.application.service.digitemploy;

import java.util.List;
import java.util.Locale;
import java.util.ResourceBundle;
import org.apache.commons.lang3.StringUtils;
import org.springframework.context.i18n.LocaleContextHolder;

/** 名称是持久化业务数据：按首次申请语言加后缀，审核语言不改变已确定的名称。 */
final class EmployeePublicationNames {
    private EmployeePublicationNames() { }

    static String enterpriseName(String name, String previousName) {
        if (StringUtils.isBlank(name)) return name;
        String value = name.strip();
        String zh = suffix(Locale.SIMPLIFIED_CHINESE);
        String en = suffix(Locale.US);
        if (List.of(zh, en).stream().anyMatch(value::endsWith)) return value;
        String suffix = StringUtils.endsWith(previousName, en) ? en : StringUtils.endsWith(previousName, zh) ? zh
            : suffix("en".equals(LocaleContextHolder.getLocale().getLanguage()) ? Locale.US : Locale.SIMPLIFIED_CHINESE);
        return value + suffix;
    }

    private static String suffix(Locale locale) {
        return ResourceBundle.getBundle("i18n.messages", locale).getString("employee.publication.enterprise.suffix");
    }
}
