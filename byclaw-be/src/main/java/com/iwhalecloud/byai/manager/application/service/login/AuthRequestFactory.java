package com.iwhalecloud.byai.manager.application.service.login;

import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import me.zhyd.oauth.config.AuthConfig;
import me.zhyd.oauth.request.AuthDingTalkAccountRequest;
import me.zhyd.oauth.request.AuthRequest;
import me.zhyd.oauth.request.AuthWeChatMpRequest;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-05-03 15:39:57
 * @description TODO
 */
@Service
public class AuthRequestFactory {

    /**
     * 获取单个的request
     *
     * @param socialType 社交账号类型
     * @return AuthRequest
     */
    public AuthRequest get(String socialType) {

        AuthConfig.AuthConfigBuilder builder = AuthConfig.builder();

        // 根据类型匹配
        switch (socialType) {
            case "wechatMp":
                // todo
            case "dingtalkAccount":
                // todo
            default:

        }
        throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("login.authconfig.notfound"));
    }
}
