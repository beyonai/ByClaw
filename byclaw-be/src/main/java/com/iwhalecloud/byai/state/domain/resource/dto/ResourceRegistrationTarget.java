package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Data;

import java.util.Map;

/**
 * 资源服务注册目标。
 *
 * 将资源 JSON 中的 domainName / domainURL 解析成可直接注册到网关发现中心的结构，
 * 避免导入链路里重复处理 URL 解析、服务名校验和元数据拼装。
 *
 * @author qin.guoquan
 * @date 2026-04-20 16:03:38
 */
@Data
public class ResourceRegistrationTarget {

    /**
     * 注册到发现中心的服务名，取自资源 JSON 的 domainName。
     */
    private String serviceName;

    /**
     * 资源原始服务地址，取自资源 JSON 的 domainURL。
     */
    private String serviceUrl;

    /**
     * domainURL 解析出的主机。
     */
    private String host;

    /**
     * domainURL 解析出的端口；若 URL 未显式携带端口，则按协议补默认端口。
     */
    private Integer port;

    /**
     * domainURL 解析出的路径。
     */
    private String path;

    /**
     * 需要跟随实例一并注册的扩展元数据。
     */
    private Map<String, Object> metadata;
}
