package com.iwhalecloud.byai.manager.dto.aimodel;

import java.io.Serializable;
import java.util.List;
import java.util.Map;
import lombok.Data;

/**
 * 模型调试请求（与接口文档 debugModel 入参一致）。
 * 调试所需参数：id（可选）、input（必填）、variables（可选），以及可选调用参数 apiEndpoint、apiToken、modelCode、modelType、headers、超时/高级参数等；
 * 不包含 displayName、providerName。若同时传 apiEndpoint 与 apiToken 则直接用请求体配置调试（先试再保存），否则按 id 查库后调试。
 *
 * @author system
 */
@Data
public class ModelDebugRequest implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 模型 ID（未传 apiEndpoint+apiToken 时必填） */
    private String id;

    /** 调试输入内容（必填） */
    private String input;

    /** 可选变量（如 query、documents 等） */
    private Map<String, Object> variables;

    // ---------- 以下为可选调用参数，用于「先试再保存」：与 apiEndpoint、apiToken 一起传入时直接用请求体配置发起调试，不查库 ----------

    /** API 端点（与 apiToken 同时传入时使用请求体配置调试） */
    private String apiEndpoint;

    /** API Token（与 apiEndpoint 同时传入时使用请求体配置调试，明文） */
    private String apiToken;

    /** 模型编码（如 gpt-3.5-turbo） */
    private String modelCode;

    /** 模型类型：LLM / RERANK，默认 LLM */
    private String modelType;

    /** 自定义请求头 key-value 列表 */
    private List<Map<String, String>> headers;

    /** 连接超时秒数 */
    private Integer connectTimeoutSec;

    /** 读取超时秒数 */
    private Integer readTimeoutSec;

    /** 温度 */
    private Double temperature;

    /** 最大 token 数 */
    private Integer maxTokens;

    /** top_p */
    private Double topP;
}
