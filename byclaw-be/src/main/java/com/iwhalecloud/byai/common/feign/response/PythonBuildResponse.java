package com.iwhalecloud.byai.common.feign.response;

import lombok.Getter;
import lombok.Setter;

/**
 * Python 知识构建服务统一响应，与 {@code docs/api/api.md}「通用成功响应」字段名一致。
 */
@Getter
@Setter
public class PythonBuildResponse<T> {

    /**
     * 智能体响应成功编码
     */
    public static final String RESPONSE_SUCCESS = "0";

    /** 接口状态码，成功一般为字符串 {@code "0"} */
    private String resultCode;

    private String resultMsg;

    private T resultObject;
}
