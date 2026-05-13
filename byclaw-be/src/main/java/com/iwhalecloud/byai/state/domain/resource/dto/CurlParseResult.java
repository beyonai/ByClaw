package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Data;

import java.util.List;

/**
 * 阶段一：curl 解析预览结果 DTO（不入库）
 */
@Data
public class CurlParseResult {

    /**
     * 工具名称（自动生成，用户可修改）
     */
    private String resourceName;

    /**
     * 工具描述（初始为空，用户填写）
     */
    private String resourceDesc;

    /**
     * HTTP 方法
     */
    private String method;

    /**
     * 请求地址（不含 query 参数）
     */
    private String url;

    /**
     * 原始完整地址（含 query 参数）
     */
    private String urlOri;

    /**
     * 原始 curl 命令
     */
    private String curlRaw;

    /**
     * 请求体参数列表
     */
    private List<ParamField> bodyParams;

    /**
     * query 参数列表
     */
    private List<ParamField> queryParams;

    /**
     * path 参数列表
     */
    private List<ParamField> pathParams;

    /**
     * 自定义 header 参数列表（已过滤标准 HTTP header）
     */
    private List<ParamField> headerParams;


}
