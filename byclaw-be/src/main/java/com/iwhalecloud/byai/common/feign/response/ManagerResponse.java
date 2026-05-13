package com.iwhalecloud.byai.common.feign.response;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-02-28 22:44:58
 * @description TODO
 */
@Getter
@Setter
public class ManagerResponse<T> {

    public static final int SUCCESS = 0;

    private int code;

    private String msg;

    private T data;
}
