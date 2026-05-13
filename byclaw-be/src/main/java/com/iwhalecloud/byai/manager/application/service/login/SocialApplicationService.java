package com.iwhalecloud.byai.manager.application.service.login;

import cn.hutool.core.io.FileUtil;
import cn.hutool.extra.qrcode.QrCodeUtil;
import cn.hutool.extra.qrcode.QrConfig;
import com.alibaba.fastjson2.JSON;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import com.iwhalecloud.byai.manager.domain.source.service.SourceSystemService;
import com.iwhalecloud.byai.manager.entity.source.SourceSystem;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.login.bean.LoginResponse;
import jakarta.servlet.http.HttpServletResponse;
import me.zhyd.oauth.model.AuthCallback;
import me.zhyd.oauth.model.AuthResponse;
import me.zhyd.oauth.model.AuthUser;
import me.zhyd.oauth.request.AuthRequest;
import me.zhyd.oauth.utils.AuthStateUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.awt.Color;
import java.io.OutputStream;

/**
 * @author he.duming
 * @date 2025-05-03 15:15:31
 * @description 第三方登陆处理
 */
@Service
public class SocialApplicationService {

    private static Logger logger = LoggerFactory.getLogger(SocialApplicationService.class);

    @Autowired
    private AuthRequestFactory authRequestFactory;

    @Autowired
    private SourceSystemService sourceSystemService;

    /**
     * 获取二维码请求地址
     *
     * @param socialType 社交账号类型
     */
    public ResponseUtil getQrCodeUrl(String socialType) {
        AuthRequest authRequest = authRequestFactory.get(socialType);
        String authorizeUrl = authRequest.authorize(AuthStateUtils.createState());
        return ResponseUtil.successResponse(authorizeUrl);
    }

    /**
     * 第三方登陆
     *
     * @param socialType 社交账号类型
     * @param generateType 生成模式
     * @param response 响应流
     */
    public void loginBySocial(String socialType, String generateType, HttpServletResponse response) {

        try (OutputStream outputStream = response.getOutputStream();) {

            AuthRequest authRequest = authRequestFactory.get(socialType);

            String authorizeUrl = authRequest.authorize(AuthStateUtils.createState());

            logger.info("获取授权码authorizeUrl: {}", authorizeUrl);

            // 生成二维码的配置
            QrConfig config = new QrConfig(1000, 1000);
            // 设置前景色，这里设置为蓝色
            config.setForeColor(Color.BLUE);
            // 设置背景色，这里设置为黄色
            config.setBackColor(Color.YELLOW);
            // 设置纠错级别为H级
            config.setErrorCorrection(ErrorCorrectionLevel.H);

            if ("local".equals(generateType)) {
                // 生成二维码到指定文件
                QrCodeUtil.generate(authorizeUrl, config, FileUtil.file("E:\\qrcode.png"));
            }
            else {
                response.setContentType("image/png");
                QrCodeUtil.generate(authorizeUrl, config, "png", outputStream);
            }
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
    }

    /**
     * 回调方法
     *
     * @param socialType 社交账号类型
     * @param code 授权码
     * @param state 状态字段
     * @return callback LoginResponse
     */
    public LoginResponse callback(String socialType, String code, String state) {

        AuthRequest authRequest = authRequestFactory.get(socialType);

        AuthCallback callback = new AuthCallback();
        callback.setCode(code);
        callback.setState(state);
        AuthResponse<AuthUser> authResponse = authRequest.login(callback);

        if (authResponse.ok()) {

            AuthUser authUser = authResponse.getData();
            logger.info("当前登陆用户信息是:{}", JSON.toJSONString(authUser));

            return LoginResponse.successResponse("", null, "");

        }
        else {
            return LoginResponse.fail(I18nUtil.get("login.login.fail"));
        }
    }

    /**
     * 获取单点登陆的地址
     *
     * @param systemCode 系统编码
     * @return ResponseUtil
     */
    public ResponseUtil getSSOUrl(String systemCode) {
        SourceSystem sourceSystem = sourceSystemService.findBySystemCode(systemCode);
        String ssoUrl = sourceSystem.getSsoUrl();
        String appKey = sourceSystem.getAppKey();
        String redirectUri = sourceSystem.getRedirectUri();
        if (StringUtil.isNotEmpty(appKey)) {
            ssoUrl = ssoUrl.replace("{appKey}", appKey);
        }
        if (StringUtil.isNotEmpty(redirectUri)) {
            ssoUrl = ssoUrl.replace("{redirectUri}", redirectUri);
        }
        return ResponseUtil.successResponse(ssoUrl);
    }

}
