package com.iwhalecloud.byai.manager.interfaces.controller.login;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.iwhalecloud.byai.manager.application.service.login.SocialApplicationService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.login.bean.LoginResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.io.IOException;

/**
 * @author he.duming
 * @date 2025-05-03 15:08:11
 * @description 第三方登陆处理类
 */
@Tag(name = "第三方登录管理", description = "第三方登录相关操作接口")
@RestController
@RequestMapping("/system/social")
public class SocialController {

    private static final Logger logger = LoggerFactory.getLogger(SocialController.class);


    @Autowired
    private SocialApplicationService socialApplicationService;

    /**
     * 获取二维码请求地址
     * 
     * @param socialType 社交账号类型
     */
    @GetMapping("/getQrCodeUrl")
    public ResponseUtil getQrCodeUrl(@RequestParam("socialType") String socialType) {
        return socialApplicationService.getQrCodeUrl(socialType);
    }

    /**
     * 社交账号登陆
     * 
     * @param socialType 社交账号类型
     * @param generateType 生成模式
     * @param response 二维码
     */
    @GetMapping("/loginBySocial")
    public void loginBySocial(@RequestParam("socialType") String socialType,
        @RequestParam(name = "generateType", required = false) String generateType, HttpServletResponse response) {
        socialApplicationService.loginBySocial(socialType, generateType, response);
    }

    /**
     * 回调方法
     * 
     * @param socialType 社交账号类型
     * @param code 授权码
     * @param state 状态字段
     * @return callback
     */
    @RequestMapping(value = "/{socialType}/callback", method = RequestMethod.GET)
    public LoginResponse callback(@PathVariable("socialType") String socialType, @RequestParam("code") String code,
        @RequestParam("state") String state) {
        return socialApplicationService.callback(socialType, code, state);
    }

    /***
     * 微信平台验证服务器地址的有效性，填写的URL需要正确响应微信发送的Token验证,给果验证成功原样返回echostr
     * 
     * @param signature 微信加密签名，signature结合了开发者填写的token参数和请求中的timestamp参数、nonce参数。
     * @param timestamp 时间戳
     * @param nonce 随机数
     * @param echostr 随机字符串
     * @param response 响应头
     * @throws IOException 异常信息
     */
    @RequestMapping(value = "/wechatMp/check", method = RequestMethod.GET)
    public void check(@RequestParam(value = "signature") String signature,
        @RequestParam(value = "timestamp") String timestamp, @RequestParam(value = "nonce") String nonce,
        @RequestParam(value = "echostr") String echostr, HttpServletResponse response) throws IOException {

        logger.info("signature=" + signature + ", timestamp=" + timestamp + ", nonce=" + nonce);

        // 注意不能用json格式返回
        response.setContentType("text/html");
        response.getWriter().print(echostr);
    }

    /**
     * 获取单系统地址
     * 
     * @return ResponseUtil
     */
    @Operation(summary = "获取单点登录地址", description = "根据条件获取不同系统的单点登录地址")
    @GetMapping("/getSSOUrl")
    public ResponseUtil getSSOUrl(@RequestParam("systemCode") String systemCode) {
        return socialApplicationService.getSSOUrl(systemCode);
    }

}
