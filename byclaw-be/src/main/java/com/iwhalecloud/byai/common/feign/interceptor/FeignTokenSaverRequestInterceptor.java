package com.iwhalecloud.byai.common.feign.interceptor;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelQuota;
import com.iwhalecloud.byai.manager.dto.aimodel.TokenSaver;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.springframework.beans.factory.annotation.Autowired;
import feign.RequestTemplate;

/**
 * Token API 认证拦截器，注入 Authorization 与 New-Api-User 请求头。
 */
public class FeignTokenSaverRequestInterceptor extends AbstractFeignRequestInterceptor {

    private static final String HEADER_AUTHORIZATION = "Authorization";

    private static final String HEADER_NEW_API_USER = "New-Api-User";

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Override
    protected void doIntercept(RequestTemplate requestTemplate) {

        String modelQuotaJson = byaiSystemConfigService.findByParamCode("MODEL_QUOTA");
        if (StringUtil.isEmpty(modelQuotaJson)) {
            return;
        }

        ModelQuota modelQuota = JSON.parseObject(modelQuotaJson, ModelQuota.class);

        TokenSaver tokenSaver = modelQuota.getTokenSaver();
        if (tokenSaver == null) {
            return;
        }

        // 动态url地址
        String feignUrl = tokenSaver.getFeignUrl();
        if (StringUtil.isNotEmpty(feignUrl)) {
            requestTemplate.target(feignUrl);
        }

        String accessToken = tokenSaver.getAccessToken();
        String newApiUser = tokenSaver.getNewApiUser();

        requestTemplate.header("Content-Type", "application/json");
        requestTemplate.header(HEADER_AUTHORIZATION, "Bearer ".concat(accessToken));
        requestTemplate.header(HEADER_NEW_API_USER, newApiUser);
    }

}
