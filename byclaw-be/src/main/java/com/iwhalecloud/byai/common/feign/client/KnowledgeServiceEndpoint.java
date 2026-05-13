package com.iwhalecloud.byai.common.feign.client;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 知识库服务端点定义对象。
 * 这个类本身不负责任何路由判断，只承载“本次知识库请求最终应该打到哪里”的结果数据。
 * 当系统使用百应自有知识库时，这个对象保存的是服务发现所需的 serviceName；
 * 当系统使用第三方知识库时，这个对象保存的是从导入知识库 JSON 中解析出来的 domainURL。
 * 业务调用方不需要关心判断过程，只需要根据这个对象判断是走服务发现还是走第三方直连即可。
 *
 * @author qin.guoquan
 * @date 2026-04-22 10:30:00
 */
@Getter
@AllArgsConstructor
public class KnowledgeServiceEndpoint {

    private final boolean directUrl;

    private final String serviceName;

    private final String baseUrl;

    /**
     * 构造服务发现模式端点结果。
     */
    public static KnowledgeServiceEndpoint forDiscovery(String serviceName) {
        return new KnowledgeServiceEndpoint(false, serviceName, null);
    }

    /**
     * 构造第三方直连模式端点结果。
     */
    public static KnowledgeServiceEndpoint forDirectUrl(String baseUrl) {
        return new KnowledgeServiceEndpoint(true, null, baseUrl);
    }
}
