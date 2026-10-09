package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Locale;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.common.config.I18nConfig;
import com.iwhalecloud.byai.state.domain.groupchat.dto.WorkgroupTemplateRequest;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContext;
import org.springframework.context.i18n.LocaleContextHolder;

class WorkgroupTemplateRequestTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void acceptsOtherDomainZeroAndNormalCatalogIdsSubmittedAsStrings() throws Exception {
        try (var validator = new I18nConfig().validator(new I18nConfig().messageSource())) {
            validator.afterPropertiesSet();
            for (String id : new String[] {"0", "10", "54"}) {
                assertThat(validator.validate(request("\"" + id + "\""))).isEmpty();
            }
        }
    }

    @Test
    void rejectsMissingAndNegativeCatalogWithLocalizedMessages() throws Exception {
        LocaleContext original = LocaleContextHolder.getLocaleContext();
        try (var validator = new I18nConfig().validator(new I18nConfig().messageSource())) {
            validator.afterPropertiesSet();
            LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
            assertThat(validator.validate(request("null"))).singleElement()
                .satisfies(error -> assertThat(error.getMessage()).isEqualTo("请选择资产目录"));
            assertThat(validator.validate(request("-1"))).singleElement()
                .satisfies(error -> assertThat(error.getMessage()).isEqualTo("资产目录ID不能小于0"));
            LocaleContextHolder.setLocale(Locale.US);
            assertThat(validator.validate(request("-1"))).singleElement()
                .satisfies(error -> assertThat(error.getMessage())
                    .isEqualTo("Asset catalog ID must be greater than or equal to 0"));
        }
        finally {
            LocaleContextHolder.setLocaleContext(original);
        }
    }

    @Test
    void stillRejectsZeroEmployeeResourceId() throws Exception {
        try (var validator = new I18nConfig().validator(new I18nConfig().messageSource())) {
            validator.afterPropertiesSet();
            WorkgroupTemplateRequest request = request("0");
            request.setResourceIds(java.util.List.of(0L));
            assertThat(validator.validate(request)).isNotEmpty();
        }
    }

    private WorkgroupTemplateRequest request(String catalogId) throws Exception {
        // 使用与 HAR 相同的 JSON 入参形态，验证字符串目录 ID 的反序列化与边界。
        return mapper.readValue("{\"templateName\":\"测试模板\",\"catalogId\":" + catalogId
            + ",\"summary\":\"测试摘要\",\"defaultGroupName\":\"测试组\",\"defaultGoal\":\"测试目标\","
            + "\"resourceIds\":[\"11055690\"]}", WorkgroupTemplateRequest.class);
    }
}
