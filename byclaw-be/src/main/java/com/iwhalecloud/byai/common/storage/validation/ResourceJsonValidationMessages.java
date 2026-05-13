package com.iwhalecloud.byai.common.storage.validation;

import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.stereotype.Component;

/**
 * 资源 JSON 写入校验的国际化消息入口。
 */
@Component
public class ResourceJsonValidationMessages {

    private final MessageSource messageSource;

    public ResourceJsonValidationMessages(MessageSource messageSource) {
        this.messageSource = messageSource;
    }

    public String get(String key, Object... args) {
        return messageSource.getMessage(key, args, key, LocaleContextHolder.getLocale());
    }
}
