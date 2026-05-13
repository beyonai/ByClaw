package com.iwhalecloud.byai.state.common.config;

/**
 * @author he.duming
 * @date 2025-08-14 02:35:09
 * @description TODO
 */

import org.springframework.boot.autoconfigure.AutoConfigureBefore;
import org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration;
import org.springframework.context.MessageSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.support.ReloadableResourceBundleMessageSource;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.servlet.LocaleResolver;
import com.iwhalecloud.byai.common.i18n.I18nLocaleResolver;

@Configuration
@AutoConfigureBefore(WebMvcAutoConfiguration.class)
public class I18nConfig {

    /**
     * 配置国际化消息源
     * 
     * @return MessageSource
     */
    @Bean
    public MessageSource messageSource() {

        ReloadableResourceBundleMessageSource messageSource = new ReloadableResourceBundleMessageSource();

        // 设置资源文件基础路径（根据实际项目调整）
        messageSource.setBasename("classpath:i18n/messages");

        // 设置编码格式
        messageSource.setDefaultEncoding("UTF-8");

        // 关键配置：找不到key时返回key本身，不抛异常
        messageSource.setUseCodeAsDefaultMessage(true);

        // 可选：设置缓存时间（秒），开发时可设为0避免缓存
        messageSource.setCacheSeconds(3600);

        return messageSource;
    }

    /**
     * 配置LocaleResolver（根据需求选择，如AcceptHeader、Session等）
     * 
     * @return LocaleResolver
     */
    @Bean
    public LocaleResolver localeResolver() {
        return new I18nLocaleResolver();
    }

    /**
     * 为参数校验（如@Valid）集成国际化
     * 
     * @param messageSource 资源信息
     * @return LocalValidatorFactoryBean
     */
    @Bean
    public LocalValidatorFactoryBean validator(MessageSource messageSource) {
        LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
        validator.setValidationMessageSource(messageSource);
        return validator;
    }
}