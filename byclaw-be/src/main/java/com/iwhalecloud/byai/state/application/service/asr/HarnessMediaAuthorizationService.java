package com.iwhalecloud.byai.state.application.service.asr;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.iwhalecloud.byai.common.constants.login.LoginAuthKey;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.RedisUtil;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Harness authenticates against the current shared user credential, including cookie-authenticated BE callers. */
@Service
public class HarnessMediaAuthorizationService {
    public String currentToken() {
        if (CurrentUserHolder.getLoginInfo() == null || CurrentUserHolder.getCurrentUserId() == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, I18nUtil.get("voice.authentication.required"));
        }
        String key = LoginAuthKey.USER_LOGIN_AUTH.replace("{userId}", CurrentUserHolder.getCurrentUserId().toString());
        String token = RedisUtil.hmGet(key, LoginAuthKey.HM_KEY_BEYOND_TOKEN);
        if (token == null || token.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, I18nUtil.get("voice.authentication.unavailable"));
        }
        return token;
    }
}
