package com.iwhalecloud.byai.manager.domain.login.service;

import com.iwhalecloud.byai.common.util.StringUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.constants.Constants;

/**
 * 登录服务实现
 */
@Service
public class LoginService {

    @Autowired
    private SystemConfigService systemConfigService;

    /**
     * 获取登录类型
     *
     * @return ResponseUtil
     */
    public ResponseUtil<String> getLoginType() {
        String loginType = systemConfigService.getStringParamValueByCode(Constants.LOGIN_TYPE);
        if (StringUtil.isNotEmpty(loginType)) {
            return ResponseUtil.successResponse(loginType, loginType);
        }
        return ResponseUtil.successResponse();
    }
}
