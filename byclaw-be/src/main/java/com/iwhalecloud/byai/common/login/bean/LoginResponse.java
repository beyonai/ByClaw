package com.iwhalecloud.byai.common.login.bean;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class LoginResponse {

    /**
     * 成功
     */
    public static final int SUCCESS = 0;

    /**
     * 通用失败
     */
    public static final int FAIL = -1;

    /**
     * 访问人数据超过限制
     */
    public static final int OVER_LIMIT = 999;

    /**
     * 设置了和默认密码相同的密码，提示修改
     */
    public static final int DEFAULT_PWD = -2;

    private int code = 0;

    private String msg;

    private LoginInfo data;

    private String sessionId;

    /**
     * 百应的beyont-token
     */
    private String token;

    /**
     * 百应的beyont-token刷新认证
     */
    private String refreshToken;

    /**
     * 鲸加登陆生成的token
     */
    private String ssoToken;

    /**
     * 无参构造器
     */
    public LoginResponse() {

    }

    public LoginResponse(int code, String msg, LoginInfo data, String sessionId) {
        this.code = code;
        this.msg = msg;
        this.data = data;
        this.sessionId = sessionId;
    }

    /**
     * 请求失败
     * 
     * @param msg 返回消息
     * @return LoginResponse
     */
    public static LoginResponse fail(String msg) {
        return new LoginResponse(FAIL, msg, null, null);
    }

    /**
     * 响应失败自定义编码
     * 
     * @param code 编码
     * @param msg 响应信息
     * @return LoginResponse
     */
    public static LoginResponse fail(int code, String msg) {
        return new LoginResponse(code, msg, null, null);
    }

    /**
     * 成功响应
     *
     * @param msg 响应描述
     * @param data 响应返回参数
     * @return ResponseUtil
     */
    public static LoginResponse successResponse(String msg, LoginInfo data, String sessionId) {
        return new LoginResponse(SUCCESS, msg, data, sessionId);
    }

}
