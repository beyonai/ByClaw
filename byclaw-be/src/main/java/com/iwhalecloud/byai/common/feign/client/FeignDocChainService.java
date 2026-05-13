package com.iwhalecloud.byai.common.feign.client;

import com.iwhalecloud.byai.common.feign.interceptor.FeignDocChainRequestInterceptor;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import java.util.Map;

/**
 * @author he.duming
 * @date 2025-08-19 10:47:38
 * @description TODO
 */

@FeignClient(name = "${feign.docChain.name:docChain}", url = "${feign.docChain.url:}",
    path = "${feign.docChain.path:}", configuration = FeignDocChainRequestInterceptor.class)
public interface FeignDocChainService {

    /**
     * 联网搜索
     * 
     * @param params 入参
     * @return Map
     */
    @RequestMapping(value = "/v1/search", method = RequestMethod.POST, produces = "application/json;charset=UTF-8",
        consumes = "application/json;charset=UTF-8")
    Map<String, Object> search(@RequestBody Map<String, Object> params);

}
