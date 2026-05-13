package com.iwhalecloud.byai.manager.interfaces.controller.login;

import com.iwhalecloud.byai.common.jwt.SsoTokenService;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.login.CaptchaService;
import com.iwhalecloud.byai.manager.domain.login.service.LoginService;
import com.iwhalecloud.byai.manager.dto.auth.SmsCaptchaRequest;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import java.util.Map;

@RestController
@RequestMapping("/system/session")
public class LoginController {

    public static final Logger LOGGER = LoggerFactory.getLogger(LoginController.class);

    @Autowired
    private LoginService loginService;

    @Autowired
    private SsoTokenService ssoTokenService;

    @Autowired
    private CaptchaService captchaService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    /**
     * 获取当前用户信息
     */
    @RequestMapping(value = "/currentUser", method = RequestMethod.GET)
    public ResponseUtil<LoginInfo> currentUser(HttpServletRequest request) {
        return loginApplicationService.currentUser(request);
    }

    /**
     * 退出登录
     */
    @RequestMapping(value = "/logout", method = RequestMethod.GET)
    public ResponseUtil logout(HttpServletRequest request) {
        return loginApplicationService.logout(request);
    }

    /**
     * 获取系统配置登录类型
     */
    @RequestMapping(value = "/getLoginType", method = RequestMethod.POST)
    public ResponseUtil getLoginType() {
        return loginService.getLoginType();
    }

    /**
     * 创建单点认证令牌
     */
    @RequestMapping(value = "/createIwhaleToken", method = RequestMethod.POST)
    public ResponseUtil createIwhaleToken() {
        String ssoToken = ssoTokenService.createSsoToken();
        return ResponseUtil.successResponse(ssoToken);
    }

    /**
     * 获取图形验证?
     */
    @GetMapping("/captcha")
    public void getCaptcha(HttpSession session, HttpServletResponse response) {
        captchaService.generateImageCaptcha(session, response);
    }

    /**
     * 发送短信验证码
     */
    @PostMapping("/sms/send")
    public ResponseUtil sendSmsCode(@Valid @RequestBody SmsCaptchaRequest request, HttpServletRequest httpRequest) {
        try {
            captchaService.sendSmsCode(request, httpRequest);
            return ResponseUtil.successResponse();
        }
        catch (Exception e) {
            LOGGER.error("sendSmsCode error", e);
            return ResponseUtil.fail(e.getMessage());
        }
    }

    /**
     * 获取环境变量值默认给不需要登录
     * 
     * @param params 入参
     * @return ResponseUtil
     */
    @PostMapping("/getDcSystemConfigValueByCode")
    public ResponseUtil getDcSystemConfigValueByCode(@Valid @RequestBody Map<String, Object> params) {
        String value = loginApplicationService.getDcSystemConfigValueByCode(params);
        return ResponseUtil.successResponse("OK", value);
    }

    @PostMapping("/getDcSystemConfigValueByCodes")
    public ResponseUtil getDcSystemConfigValueByCodes(@Valid @RequestBody Map<String, Object> params) {
        Map<String, Object> value = loginApplicationService.getDcSystemConfigValueByCodes(params);
        return ResponseUtil.successResponse("OK", value);
    }

}
