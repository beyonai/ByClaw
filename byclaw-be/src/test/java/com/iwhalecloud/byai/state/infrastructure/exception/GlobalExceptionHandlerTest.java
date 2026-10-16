package com.iwhalecloud.byai.state.infrastructure.exception;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class GlobalExceptionHandlerTest {

    @AfterEach
    void resetLocale() {
        LocaleContextHolder.resetLocaleContext();
    }

    private GlobalExceptionHandler handlerWithMessages() {
        ResourceBundleMessageSource messages = new ResourceBundleMessageSource();
        messages.setBasename("i18n.messages");
        messages.setDefaultEncoding("UTF-8");
        messages.setFallbackToSystemLocale(false);
        GlobalExceptionHandler handler = new GlobalExceptionHandler();
        handler.setMessageSource(messages);
        return handler;
    }

    @Test
    void responseStatusException_preservesStatusAndReason() {
        GlobalExceptionHandler handler = handlerWithMessages();

        var response = handler.handleResponseStatusException(
            new ResponseStatusException(HttpStatus.CONFLICT, "task plan version conflict"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getCode()).isEqualTo(-1);
        assertThat(response.getBody().getMsg()).isEqualTo("task plan version conflict");
        assertThat(response.getBody().getData()).isNull();
    }

    @Test
    void forbiddenDomainResponseMarksPermissionDenialWithoutChangingAuthenticationFailures() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();
        var forbidden = handler.handleResponseStatusException(
            new ResponseStatusException(HttpStatus.FORBIDDEN, "enterprise access denied"));
        assertThat(forbidden.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(forbidden.getBody().getCode()).isEqualTo(-1);
        assertThat(forbidden.getBody().getData()).isEqualTo(Map.of("errorType", "PERMISSION_DENIED"));

        var unauthorized = handler.handleResponseStatusException(
            new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authentication failed"));
        assertThat(unauthorized.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(unauthorized.getBody().getData()).isNull();
    }

    @ParameterizedTest
    @CsvSource(value = {
        "zh-CN|404|resource.favorite.unavailable|该资源不可收藏或已不可用",
        "en-US|404|resource.favorite.unavailable|This resource cannot be favorited or is unavailable",
        "zh-CN|400|resource.favorite.commercialOnly|收藏功能仅在商业版本中开放",
        "en-US|400|resource.favorite.commercialOnly|Resource favorites are available in the commercial edition only",
        "zh-CN|403|resource.favorite.loginRequired|请登录后再使用收藏功能",
        "en-US|403|resource.favorite.loginRequired|Please sign in to use resource favorites",
        "zh-CN|503|resource.favorite.notReady|收藏功能暂不可用，请联系管理员完成数据库升级",
        "en-US|503|resource.favorite.notReady|Resource favorites are temporarily unavailable; please contact an administrator to complete the database upgrade"
    }, delimiter = '|')
    void responseStatusExceptionLocalizesMessageKeys(String language, int status, String key, String expected) {
        LocaleContextHolder.setLocale(java.util.Locale.forLanguageTag(language));

        var response = handlerWithMessages().handleResponseStatusException(
            new ResponseStatusException(HttpStatus.valueOf(status), key));

        assertThat(response.getStatusCode().value()).isEqualTo(status);
        assertThat(response.getBody().getCode()).isEqualTo(-1);
        assertThat(response.getBody().getMsg()).isEqualTo(expected);
        if (status == 403) {
            assertThat(response.getBody().getData()).isEqualTo(Map.of("errorType", "PERMISSION_DENIED"));
        } else {
            assertThat(response.getBody().getData()).isNull();
        }
    }

    @Test
    void springContextSuppliesTheMessageSourceToControllerAdvice() {
        LocaleContextHolder.setLocale(java.util.Locale.SIMPLIFIED_CHINESE);
        try (GenericApplicationContext context = new GenericApplicationContext()) {
            StaticMessageSource messages = new StaticMessageSource();
            messages.addMessage("resource.favorite.unavailable", java.util.Locale.SIMPLIFIED_CHINESE, "该资源不可收藏或已不可用");
            context.registerBean("messageSource", StaticMessageSource.class, () -> messages);
            context.registerBean(GlobalExceptionHandler.class);
            context.refresh();

            var response = context.getBean(GlobalExceptionHandler.class).handleResponseStatusException(
                new ResponseStatusException(HttpStatus.NOT_FOUND, "resource.favorite.unavailable"));

            assertThat(response.getBody().getMsg()).isEqualTo("该资源不可收藏或已不可用");
        }
    }
}
