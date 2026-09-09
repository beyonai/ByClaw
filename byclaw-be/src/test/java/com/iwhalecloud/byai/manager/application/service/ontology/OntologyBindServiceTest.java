package com.iwhalecloud.byai.manager.application.service.ontology;

import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.util.Locale;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OntologyBindServiceTest {

    @InjectMocks
    private OntologyBindService service;

    @Mock
    private SsResourceService ssResourceService;

    @Mock
    private AuthApplicationService authApplicationService;

    private MessageSource originalMessageSource;
    private Locale originalLocale;

    @BeforeEach
    void setUpI18n() {
        originalMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        originalLocale = LocaleContextHolder.getLocale();

        ResourceBundleMessageSource messageSource = new ResourceBundleMessageSource();
        messageSource.setBasename("i18n/messages");
        messageSource.setDefaultEncoding("UTF-8");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.US);
    }

    @AfterEach
    void restoreI18n() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
        LocaleContextHolder.setLocale(originalLocale);
    }

    @Test
    void unbindResource_localizesMissingParameters() {
        assertThatThrownBy(() -> service.unbindResource(null, 200L))
            .isInstanceOf(BaseException.class)
            .hasMessage("Ontology unbind parameters are incomplete: digitalEmployeeId and relResourceId are required");
    }

    @Test
    void unbindResource_localizesInvalidDigitalEmployee() {
        SsResource resource = new SsResource();
        resource.setResourceBizType(ResourceBizType.VIEW.getCode());
        when(ssResourceService.findById(100L)).thenReturn(resource);

        assertThatThrownBy(() -> service.unbindResource(100L, 200L))
            .isInstanceOf(BaseException.class)
            .hasMessage("Digital employee resource does not exist or has an invalid resource type");
    }

    @Test
    void unbindResource_localizesManagePermissionFailure() {
        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceBizType(ResourceBizType.DIG_EMPLOYEE.getCode());
        digitalEmployee.setResourceName("Agent A");
        when(ssResourceService.findById(100L)).thenReturn(digitalEmployee);
        when(authApplicationService.hasResourceInstallTargetManagePermission(digitalEmployee)).thenReturn(false);

        assertThatThrownBy(() -> service.unbindResource(100L, 200L))
            .isInstanceOf(BaseException.class)
            .hasMessage("You do not have management permission on digital employee [Agent A], "
                + "cannot unbind ontology resources");
    }
}
