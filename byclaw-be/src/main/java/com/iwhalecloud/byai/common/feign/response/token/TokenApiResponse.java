package com.iwhalecloud.byai.common.feign.response.token;

import lombok.Getter;
import lombok.Setter;

/**
 * Token API 统一响应结构。
 */
@Getter
@Setter
public class TokenApiResponse<T> {

    private Boolean success;

    private String message;

    private T data;

    public boolean isSuccess() {
        return Boolean.TRUE.equals(success);
    }
}
