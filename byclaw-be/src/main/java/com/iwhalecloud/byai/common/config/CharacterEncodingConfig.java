package com.iwhalecloud.byai.common.config;

import com.baomidou.mybatisplus.core.toolkit.Constants;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.filter.CharacterEncodingFilter;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CharacterEncodingConfig implements WebMvcConfigurer {

    @Bean
    public FilterRegistrationBean getCharacterEncodingFilter() {

        // 创建字符集编码过滤器
        CharacterEncodingFilter characterEncodingFilter = new CharacterEncodingFilter();
        // 设置强制使用指定的字符集编码
        characterEncodingFilter.setForceEncoding(true);
        // 设置指定的字符集编码
        characterEncodingFilter.setEncoding(Constants.UTF_8);

        FilterRegistrationBean<CharacterEncodingFilter> filterRegistrationBean = new FilterRegistrationBean<>();

        // 明确设置字符编码过滤器为最高优先级
        filterRegistrationBean.setOrder(0);

        // 设置字符集编码过滤器
        filterRegistrationBean.setFilter(characterEncodingFilter);

        // 设置字符集编码过滤器的路径
        filterRegistrationBean.addUrlPatterns("/*");
        return filterRegistrationBean;
    }

}
