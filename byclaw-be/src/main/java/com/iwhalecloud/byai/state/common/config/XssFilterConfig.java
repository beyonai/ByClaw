package com.iwhalecloud.byai.state.common.config;

import java.util.HashMap;
import java.util.Map;
import com.iwhalecloud.byai.state.common.filter.xss.XssFilter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConditionalOnProperty(prefix = "spring.xss", name = "enable", matchIfMissing = false)
public class XssFilterConfig {

    private static Logger logger = LoggerFactory.getLogger(XssFilterConfig.class);

    @Value("${xss.ignore:xss}")
    private String urlPattenrs;

    /**
     * xss过滤拦截器
     */
    @Bean
    public FilterRegistrationBean xssFilterRegistrationBean() {

        logger.info("Open xss check");

        FilterRegistrationBean<XssFilter> filterRegistrationBean = new FilterRegistrationBean<>();

        // 设置拦截器统一拦截
        filterRegistrationBean.setFilter(new XssFilter());

        // 优先级仅次于字符编码
        filterRegistrationBean.setOrder(1);
        filterRegistrationBean.setEnabled(true);
        filterRegistrationBean.addUrlPatterns("/*");

        Map<String, String> initParameters = new HashMap<>(2);
        // excludes用于配置不需要参数过滤的请求url
        initParameters.put("excludes", urlPattenrs);
        filterRegistrationBean.setInitParameters(initParameters);

        return filterRegistrationBean;
    }
}
