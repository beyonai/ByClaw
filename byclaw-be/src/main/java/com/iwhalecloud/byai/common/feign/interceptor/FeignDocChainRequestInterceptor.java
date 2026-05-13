package com.iwhalecloud.byai.common.feign.interceptor;

import org.springframework.beans.factory.annotation.Value;
import feign.RequestInterceptor;
import feign.RequestTemplate;

public class FeignDocChainRequestInterceptor implements RequestInterceptor {

    @Value("${feign.docChain.header.X-Api-Key:}")
    private String apiKey;

    @Override
    public void apply(RequestTemplate template) {
        template.header("X-Api-Key", apiKey);
    }

}
