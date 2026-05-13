package com.iwhalecloud.byai.common.feign.response;

import lombok.Getter;
import lombok.Setter;

/**
 * 沙箱服务统一响应对象
 */
@Getter
@Setter
public class SandboxResponse<T> {

    public static final int RESPONSE_SUCCESS = 200;
    public static final int RESPONSE_ERROR = 500;

    /**
     * 响应状态码
     */
    private int code;

    /**
     * 响应数据
     */
    private T data;

    /**
     * 响应消息
     */
    private String message;

    public boolean isSuccess() {
        return RESPONSE_SUCCESS == this.code;
    }

    public static <T> SandboxResponse<T> success(T data) {
        SandboxResponse<T> resp = new SandboxResponse<>();
        resp.setCode(RESPONSE_SUCCESS);
        resp.setData(data);
        resp.setMessage("success");
        return resp;
    }

    public static <T> SandboxResponse<T> error(String message) {
        SandboxResponse<T> resp = new SandboxResponse<>();
        resp.setCode(RESPONSE_ERROR);
        resp.setMessage(message);
        return resp;
    }

}
