package com.iwhalecloud.byai.state.common.enums;

/**
 * @program: dap-backend
 * @description: 统一日志编码枚举
 * @author: weiyao
 * @create: 2022-07-22 11:14
 **/
public enum CommonErrorCodeEnum {



    // 系统异常
    ERROR_CODE_90120("90120"),

    // 业务异常
    ERROR_CODE_10120("10120");


    private String code;

    private String msg;

    CommonErrorCodeEnum(String code) {
        this.code = code;
    }

    CommonErrorCodeEnum(String code, String msg) {
        this.code = code;
        this.msg = msg;
    }

    public String getCode() {
        return code;
    }

    public String getMsg() {
        return msg;
    }
}
