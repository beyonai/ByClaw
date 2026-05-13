package com.iwhalecloud.byai.common.feign.client;

import java.util.Map;

import com.iwhalecloud.byai.common.feign.interceptor.FeignAiWriterRequestInterceptor;
import feign.Response;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

/**
 * 慧笔服务 Feign 客户端，封装文稿/PPT 导出接口。
 */
@FeignClient(name = "${feign.aiwriter.name:aiwriter}", url = "${feign.aiwriter.url:}",
    path = "${feign.aiwriter.path:/aiwrite-web}", contextId = "aiWriterServiceClient",
    configuration = FeignAiWriterRequestInterceptor.class)
public interface FeignAiWriterService {

    /**
     * PPT 导出接口。
     *
     * @param request 包含 topCont、svcCont 的请求体
     * @return 文件流响应
     */
    @RequestMapping(value = "/aiPptDoc/htmlToPpt", method = RequestMethod.POST,
        consumes = MediaType.APPLICATION_JSON_VALUE)
    Response exportPpt(@RequestBody Map<String, Object> request);

    /**
     * 文稿导出接口。
     *
     * @param request 包含 topCont、svcCont 的请求体
     * @return 文件流响应
     */
    @RequestMapping(value = "/aiDoc/exportDoc", method = RequestMethod.POST,
        consumes = MediaType.APPLICATION_JSON_VALUE)
    Response exportDoc(@RequestBody Map<String, Object> request);
}
