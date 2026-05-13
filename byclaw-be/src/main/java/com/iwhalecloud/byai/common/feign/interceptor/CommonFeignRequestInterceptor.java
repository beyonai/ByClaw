package com.iwhalecloud.byai.common.feign.interceptor;

import feign.RequestTemplate;
import org.springframework.stereotype.Component;


@Component
public class CommonFeignRequestInterceptor extends AbstractFeignRequestInterceptor {

    @Override
    protected void doIntercept(RequestTemplate template) {
        // 通用拦截器不需要额外的处理逻辑
        // 所有通用逻辑已在父类中实现
    }
} 