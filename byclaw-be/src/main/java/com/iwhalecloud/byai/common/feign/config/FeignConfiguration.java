package com.iwhalecloud.byai.common.feign.config;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import com.iwhalecloud.byai.common.feign.interceptor.BaseFeignResponseInterceptor;
import org.apache.commons.io.IOUtils;
import org.springframework.beans.factory.ObjectFactory;
import org.springframework.boot.autoconfigure.http.HttpMessageConverters;
import org.springframework.cloud.openfeign.support.ResponseEntityDecoder;
import org.springframework.cloud.openfeign.support.SpringDecoder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.http.converter.StringHttpMessageConverter;
import com.fasterxml.jackson.databind.ObjectMapper;
import feign.Response;
import feign.codec.Decoder;

@Configuration
public class FeignConfiguration {

    @Bean
    public HttpMessageConverter<?> customHttpMessageConverter() {
        MappingJackson2HttpMessageConverter jsonConverter = new MappingJackson2HttpMessageConverter();

        // Add support for various media types
        List<MediaType> supportedMediaTypes = new ArrayList<>();
        supportedMediaTypes.add(MediaType.APPLICATION_JSON);
        supportedMediaTypes.add(MediaType.TEXT_PLAIN);
        supportedMediaTypes.add(MediaType.TEXT_HTML);
        supportedMediaTypes.add(MediaType.valueOf("text/event-stream;charset=UTF-8"));
        supportedMediaTypes.add(MediaType.ALL);
        jsonConverter.setSupportedMediaTypes(supportedMediaTypes);

        return jsonConverter;
    }

    @Bean
    public HttpMessageConverter<?> stringHttpMessageConverter() {
        StringHttpMessageConverter converter = new StringHttpMessageConverter(StandardCharsets.UTF_8);
        converter.setSupportedMediaTypes(List.of(MediaType.TEXT_PLAIN, MediaType.TEXT_HTML, MediaType.ALL));
        converter.setWriteAcceptCharset(false);
        return converter;
    }

    @Bean
    public Decoder feignDecoder(ObjectFactory<HttpMessageConverters> messageConverters, ObjectMapper objectMapper,
        FeignSensitiveConfig sensitiveConfig) {
        return new FeignResponseDecoder(messageConverters, objectMapper, sensitiveConfig);
    }

    public static class FeignResponseDecoder extends BaseFeignResponseInterceptor {

        public FeignResponseDecoder(ObjectFactory<HttpMessageConverters> messageConverters, ObjectMapper objectMapper,
            FeignSensitiveConfig sensitiveConfig) {
            super(new ResponseEntityDecoder(new SpringDecoder(messageConverters)), objectMapper, sensitiveConfig);
            this.sensitiveConfig = sensitiveConfig;
        }

        @Override
        protected Object processResponse(Response response, String responseBody, Type type) throws IOException {
            // 如果是InputStream类型，使用ByteArrayInputStream来避免流关闭
            if (type == InputStream.class) {
                try (InputStream inputStream = response.body().asInputStream()) {
                    byte[] bytes = IOUtils.toByteArray(inputStream);
                    return new ByteArrayInputStream(bytes);
                }
            }
            return delegate.decode(response, type);
        }
    }
}