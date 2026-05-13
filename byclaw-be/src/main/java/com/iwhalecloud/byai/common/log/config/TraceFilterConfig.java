package com.iwhalecloud.byai.common.log.config;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.iwhalecloud.byai.common.log.filter.TraceFilter;

/**
 * 追踪过滤器配置类
 * 确保 TraceFilter 在所有 HTTP 请求前执行
 *
 * @author system
 */
@Configuration
public class TraceFilterConfig {

    /**
     * 注册追踪过滤器
     * 该过滤器用于为每个请求生成唯一的请求ID，用于日志追踪
     *
     * @param traceFilter TraceFilter 实例
     * @return FilterRegistrationBean
     */
    @Bean
    public FilterRegistrationBean<TraceFilter> traceFilterRegistrationBean(TraceFilter traceFilter) {
        FilterRegistrationBean<TraceFilter> filterRegistrationBean = new FilterRegistrationBean<>();

        // 设置过滤器实例
        filterRegistrationBean.setFilter(traceFilter);

        // 设置过滤器优先级，在字符编码过滤器之后执行
        filterRegistrationBean.setOrder(2);

        // 设置过滤器启用状态
        filterRegistrationBean.setEnabled(true);

        // 设置拦截所有请求路径
        filterRegistrationBean.addUrlPatterns("/*");

        return filterRegistrationBean;
    }
}

