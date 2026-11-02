package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import static org.assertj.core.api.Assertions.assertThat;

class EmployeePublicationMessagesTest extends I18nTestSupport {
    @Test
    void historicalSnapshotWarningsUseViewerLanguageWithoutChangingCustomContent() {
        LocaleContextHolder.setLocale(Locale.US);
        assertThat(EmployeePublicationMessages.localize("创建者已无资源使用权限"))
            .isEqualTo("The creator no longer has permission to use this resource");
        assertThat(EmployeePublicationMessages.localize("不带入企业员工")).isEqualTo("Excluded from the enterprise employee");
        assertThat(EmployeePublicationMessages.localize("employee.publication.originalUsers")).isEqualTo("Previously authorized users");
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
        assertThat(EmployeePublicationMessages.localize("Previously authorized users")).isEqualTo("原有授权用户");
        assertThat(EmployeePublicationMessages.localize("自定义资源：客户资料")).isEqualTo("自定义资源：客户资料");
        assertThat(EmployeePublicationMessages.localize(null)).isNull();
    }

    @Test
    void publicationValidationRetainsItsExceptionTypeAndChangesLanguage() {
        var employee = new com.iwhalecloud.byai.manager.entity.resource.SsResource();
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> EmployeePublicationApplicationService.sanitize(null, employee))
            .isInstanceOf(com.iwhalecloud.byai.common.exception.BaseException.class)
            .hasMessage("请提供员工配置");
        LocaleContextHolder.setLocale(Locale.US);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> EmployeePublicationApplicationService.sanitize(null, employee))
            .isInstanceOf(com.iwhalecloud.byai.common.exception.BaseException.class)
            .hasMessage("Provide the employee configuration");
    }
}
