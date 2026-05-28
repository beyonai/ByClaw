package com.iwhalecloud.byai.common.feign.response;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-05-25 18:39:36
 * @description TODO
 */
@Getter
@Setter
public class DataCloudResponse<T> {

    /**
     * 智能体响应成功编码
     */
    public static final Integer RESPONSE_SUCCESS = 0;

    /** 接口状态码，成功一般为字符串 {@code "0"} */
    private int code;

    private String message;

    private T data;
}
