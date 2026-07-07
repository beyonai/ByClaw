package com.iwhalecloud.byai.state.domain.resource.service;

import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ResourceImportOwnerTypeValidatorTest {

    private MessageSource originalMessageSource;

    @BeforeEach
    void setUp() {
        originalMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("resource.owner.type.enterprise", Locale.SIMPLIFIED_CHINESE, "企业");
        messageSource.addMessage("resource.owner.type.personal", Locale.SIMPLIFIED_CHINESE, "个人");
        messageSource.addMessage("resource.label.knowledge", Locale.SIMPLIFIED_CHINESE, "知识");
        messageSource.addMessage("resource.label.object", Locale.SIMPLIFIED_CHINESE, "对象");
        messageSource.addMessage("resource.label.view", Locale.SIMPLIFIED_CHINESE, "视图");
        messageSource.addMessage("resource.label.tool", Locale.SIMPLIFIED_CHINESE, "工具");
        messageSource.addMessage("resource.import.owner.type.mismatch", Locale.SIMPLIFIED_CHINESE,
            "已有相同编码（{0}）的{1}是在{2}的{3}下，请到{2}的{3}下导入或修改");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
    }

    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void validate_allowsSameOwnerTypeWhenUpdatingSameCode() {
        SsResource existing = buildResource(OwnerType.ENTERPRISE, ResourceBizType.KG_DOC.getCode());

        assertThatCode(() -> ResourceImportOwnerTypeValidator.validate(existing, OwnerType.ENTERPRISE, "R001",
            "导入知识", ResourceBizType.KG_DOC.getCode())).doesNotThrowAnyException();
    }

    @Test
    void validate_rejectsDifferentOwnerTypeBeforeOverwrite() {
        SsResource existing = buildResource(OwnerType.ENTERPRISE, ResourceBizType.KG_DOC.getCode());

        assertThatThrownBy(() -> ResourceImportOwnerTypeValidator.validate(existing, OwnerType.PERSONAL, "R001",
            "导入知识", ResourceBizType.KG_DOC.getCode()))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("已有相同编码（R001）的存量资源是在企业的知识下，请到企业的知识下导入或修改");
    }

    private SsResource buildResource(String ownerType, String resourceBizType) {
        SsResource resource = new SsResource();
        resource.setResourceCode("R001");
        resource.setResourceName("存量资源");
        resource.setOwnerType(ownerType);
        resource.setResourceBizType(resourceBizType);
        return resource;
    }
}
