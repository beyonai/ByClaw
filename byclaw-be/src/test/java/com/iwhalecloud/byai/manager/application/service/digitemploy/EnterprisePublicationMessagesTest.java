package com.iwhalecloud.byai.manager.application.service.digitemploy;

import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.ResourceBundleMessageSource;
import static org.assertj.core.api.Assertions.assertThat;

class EnterprisePublicationMessagesTest {
    @Test
    void employeeAndSkillPublicationMessagesUseEnterpriseWordingInEveryBundle() {
        ResourceBundleMessageSource messages = new ResourceBundleMessageSource();
        messages.setBasename("i18n/messages");
        messages.setDefaultEncoding("UTF-8");
        messages.setFallbackToSystemLocale(false);
        List<String> keys = List.of(
            "employee.publication.enterprise.copy.required",
            "employee.publication.owner.change.forbidden",
            "byclaw.skill.enterprise.no.permission",
            "byclaw.skill.enterprise.failed",
            "byclaw.skill.publication.package.unreadable",
            "byclaw.skill.publication.manifest.invalid",
            "byclaw.skill.publication.personal.knowledge",
            "byclaw.skill.publication.personal.tool",
            "byclaw.skill.publication.dependencies.blocked",
            "byclaw.skill.publication.personal.resource"
        );
        // 检查真实翻译资源，避免后端失败提示仍使用旧发布入口名称。
        for (Locale locale : List.of(Locale.ROOT, Locale.SIMPLIFIED_CHINESE, Locale.US)) {
            String publicationTarget = Locale.US.equals(locale) ? "to enterprise" : "发布到企业";
            for (String key : keys) {
                assertThat(messages.getMessage(key, null, locale)).contains(publicationTarget);
            }
        }
    }
}
