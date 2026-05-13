package com.iwhalecloud.byai.common.feign.interceptor;

import feign.RequestTemplate;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Enumeration;

@Component
public class FeignChatBiRequestInterceptor extends AbstractFeignRequestInterceptor {


    @Override
    protected void doIntercept(RequestTemplate template) {
        this.addDefaultHeader(template);
    }

    private void addDefaultHeader(RequestTemplate template) {
        // 内部接口调用，添加特殊属性，跳过横向越权
        RequestAttributes requestAttributes = RequestContextHolder.getRequestAttributes();
        if (requestAttributes == null) {
            return;
        }

        ServletRequestAttributes attributes = (ServletRequestAttributes) requestAttributes;
        HttpServletRequest request = attributes.getRequest();
        Enumeration<String> headerNames = request.getHeaderNames();
        if (headerNames != null) {
            while (headerNames.hasMoreElements()) {
                String name = headerNames.nextElement();
                if ("cookie".equalsIgnoreCase(name)) {
                    String values = request.getHeader(name);
                    template.header(name, values);
                }
            }
        }
    }
}
