package com.iwhalecloud.byai.common.feign.request.datacloud;

import lombok.Getter;
import lombok.Setter;

/**
 * 调用知识库动作请求参数。
 */
@Getter
@Setter
public class Params {

    private Long sessionId;

    /** 本体对象编码 */
    private String objectCode;

    /** 动作编码，如 write_xxx、search_xxx */
    private String actionCode;

    /** 传给动作的参数 */
    private Arguments arguments;

    /** 基础库 ID，可选 */
    private String baseId;
}
