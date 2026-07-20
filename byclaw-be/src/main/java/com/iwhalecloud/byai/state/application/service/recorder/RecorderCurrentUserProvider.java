package com.iwhalecloud.byai.state.application.service.recorder;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;

@Component
public class RecorderCurrentUserProvider {

    public RecorderOwner requireCurrent() {
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        String userCode = CurrentUserHolder.getCurrentUserCode();
        Long userId;
        try {
            userId = CurrentUserHolder.getCurrentUserId();
        } catch (NullPointerException exception) {
            throw authenticationRequired();
        }
        if (loginInfo == null || userId == null || userId <= 0 || userCode == null || userCode.isBlank()) {
            throw authenticationRequired();
        }
        return new RecorderOwner(userId, userCode);
    }

    private RecorderSaveException authenticationRequired() {
        return new RecorderSaveException("authentication_required", "Recorder save requires an authenticated user");
    }
}
