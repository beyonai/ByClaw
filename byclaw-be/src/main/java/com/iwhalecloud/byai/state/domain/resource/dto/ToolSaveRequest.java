package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Data;

import java.util.List;

/**
 * 阶段二：用户补全描述后的保存请求 DTO
 */
@Data
public class ToolSaveRequest {

    /**
     * 工具名称
     */
    private String resourceName;

    /**
     * 工具描述
     */
    private String resourceDesc;

    /**
     * 所属目录ID
     */
    private Long catalogId;

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
     * 请求体参数列表（含用户填写的 description）
     */
    private List<ParamField> bodyParams;

    /**
     * query 参数列表（含用户填写的 description）
     */
    private List<ParamField> queryParams;

    /**
     * path 参数列表（含用户填写的 description）
     */
    private List<ParamField> pathParams;

    /**
     * 自定义 header 参数列表（含用户填写的 description）
     */
    private List<ParamField> headerParams;



}
