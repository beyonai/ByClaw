package com.iwhalecloud.byai.common.feign.response;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-03-05 16:24:03
 * @description TODO
 */
@Getter
@Setter
public class PythonToolResponse<T> {

    public static final int SUCCESS = 0;

    private int code;

    private String msg;

    private T data;
}
