package com.iwhalecloud.byai.manager.application.service.digitemploy;

import java.util.Locale;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import static org.assertj.core.api.Assertions.assertThat;

class EmployeePublicationNamesTest {
    @AfterEach void cleanup() { LocaleContextHolder.resetLocaleContext(); }
    @Test void chineseAndEnglishNamesUseLocalizedSuffixOnlyOnce() {
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
        assertThat(EmployeePublicationNames.enterpriseName("客服", null)).isEqualTo("客服(企业)");
        assertThat(EmployeePublicationNames.enterpriseName("客服(企业)", null)).isEqualTo("客服(企业)");
        LocaleContextHolder.setLocale(Locale.US);
        assertThat(EmployeePublicationNames.enterpriseName("Support", null)).isEqualTo("Support (Enterprise)");
        assertThat(EmployeePublicationNames.enterpriseName("Support (Enterprise)", null)).isEqualTo("Support (Enterprise)");
    }
    @Test void reviewersLanguageDoesNotChangeNamingLanguage() {
        LocaleContextHolder.setLocale(Locale.US);
        assertThat(EmployeePublicationNames.enterpriseName("新名字", "旧名字(企业)")).isEqualTo("新名字(企业)");
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
        assertThat(EmployeePublicationNames.enterpriseName("Updated", "Support (Enterprise)")).isEqualTo("Updated (Enterprise)");
    }
}
