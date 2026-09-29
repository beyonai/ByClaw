package com.iwhalecloud.byai.manager.infrastructure.wechat;

public interface WechatMiniappPhoneClient {

    /** 用微信一次性授权 code 换取微信核实的手机号。 */
    String exchangePhoneCode(String phoneCode);
}
