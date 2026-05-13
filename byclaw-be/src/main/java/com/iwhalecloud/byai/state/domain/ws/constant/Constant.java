package com.iwhalecloud.byai.state.domain.ws.constant;

import java.util.Map;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;

import io.netty.util.AttributeKey;

public class Constant {
    private static final String USER_INFO = "userInfo";

    public static final AttributeKey<LoginInfo> ATT_USER_INFO = AttributeKey.valueOf(USER_INFO);
    public static final AttributeKey<Map<String, String>> ATT_HEADER = AttributeKey.valueOf("header");

}
