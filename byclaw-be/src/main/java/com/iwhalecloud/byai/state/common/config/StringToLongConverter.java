package com.iwhalecloud.byai.state.common.config;

import org.springframework.core.convert.converter.Converter;
import org.springframework.stereotype.Component;

/**
 * 处理get请求中含有undefined转为null
 */
@Component
public class StringToLongConverter implements Converter<String, Long> {
    @Override
    public Long convert(String source) {
        if (source == null || "undefined".equals(source)) {
            return null;
        }
        try {
            return Long.valueOf(source);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}