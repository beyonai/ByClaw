package com.iwhalecloud.byai.manager.interfaces.controller.login;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import jakarta.servlet.http.HttpServletResponse;
import me.zhyd.oauth.config.AuthConfig;
import me.zhyd.oauth.model.AuthCallback;
import me.zhyd.oauth.model.AuthResponse;
import me.zhyd.oauth.model.AuthUser;
import me.zhyd.oauth.request.AuthRequest;
import me.zhyd.oauth.request.AuthWeChatOpenRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.io.IOException;

/**
 * @author he.duming
 * @date 2025-05-03 00:32:33
 * @description TODO
 */

@RestController
@RequestMapping("/system/weixin")
public class WeiXinController {

    private static final Logger logger = LoggerFactory.getLogger(WeiXinController.class);


    /**
     * 微信测试
     * 
     * @param signature
     * @param timestamp
     * @param nonce
     * @param echostr
     * @return
     */
    @RequestMapping(value = "/check", method = RequestMethod.GET)
    public void check(@RequestParam(value = "signature") String signature,
        @RequestParam(value = "timestamp") String timestamp, @RequestParam(value = "nonce") String nonce,
        @RequestParam(value = "echostr") String echostr, HttpServletResponse response) throws IOException {

        logger.info("timestamp=" + timestamp + ", nonce=" + nonce + ", echostr=" + echostr);

        response.setContentType("text/html");
        response.getWriter().print(echostr);

    }

    @GetMapping("/authorize")
    public String authorize() {
        AuthRequest authRequest = this.getAuthRequest();
        return authRequest.authorize();
    }

    @RequestMapping(value = "/loginByWeiXin", method = RequestMethod.GET)
    public void loginByWeiXin(@RequestParam(value = "code") String code) throws IOException {

        AuthRequest authRequest = this.getAuthRequest();
        AuthCallback callback = new AuthCallback();
        callback.setCode(code);
        AuthResponse<AuthUser> login = authRequest.login(callback);
        AuthUser authUser = login.getData();
        logger.info("loginByWeiXin:{}", authUser.toString());
    }

    private AuthRequest getAuthRequest() {
        AuthConfig authConfig = AuthConfig.builder().clientId("your_client_id").clientSecret("your_client_secret")
            .redirectUri("your_redirect_uri").build();
        return new AuthWeChatOpenRequest(authConfig);
    }
}
