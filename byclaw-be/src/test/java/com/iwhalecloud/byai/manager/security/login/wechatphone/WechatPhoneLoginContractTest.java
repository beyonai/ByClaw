package com.iwhalecloud.byai.manager.security.login.wechatphone;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.common.constants.login.LoginType;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.security.handle.MultAuthenticationSuccessHandler;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class WechatPhoneLoginContractTest {

    @Test
    void successHandlerRecordsTheWechatPhoneLoginType() {
        MultAuthenticationSuccessHandler handler = new MultAuthenticationSuccessHandler();
        String loginType = ReflectionTestUtils.invokeMethod(handler, "parseLoginType",
            new WechatPhoneAuthentication(new Users()));

        assertThat(loginType).isEqualTo(LoginType.WECHAT_PHONE);
    }
}
