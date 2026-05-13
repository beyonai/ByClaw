package com.iwhalecloud.byai.manager.interfaces.controller.token;

import com.iwhalecloud.byai.manager.application.service.token.UserAccessTokenApplicationService;
import com.iwhalecloud.byai.manager.entity.token.UserAccessToken;
import com.iwhalecloud.byai.manager.qo.token.AccessTokenQo;
import com.iwhalecloud.byai.manager.dto.token.RemoveTokenDTO;
import com.iwhalecloud.byai.manager.dto.token.TokenDTO;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

/**
 * @author he.duming
 * @date 2025-06-05 17:31:32
 * @description TODO
 */
@RestController
@RequestMapping("/system/userAccessToken")
public class UserAccessTokenController {

    @Autowired
    private UserAccessTokenApplicationService userAccessTokenApplicationService;

    /**
     * 用户访问令牌列表查询
     *
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "令牌管理", description = "用户访问令牌列表查询")
    @RequestMapping(value = "/list", method = RequestMethod.POST)
    public ResponseUtil list(@RequestBody AccessTokenQo accessTokenQo) {
        PageInfo<UserAccessToken> pageVO = userAccessTokenApplicationService.list(accessTokenQo);
        return ResponseUtil.successResponse(pageVO);
    }

    /**
     * 创建令牌
     * 
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "令牌管理", description = "创建令牌")
    @RequestMapping(value = "/createToken", method = RequestMethod.POST)
    public ResponseUtil createToken(@RequestBody @Validated TokenDTO tokenDTO) {

        String token = userAccessTokenApplicationService.createToken(tokenDTO);

        return ResponseUtil.successResponse(I18nUtil.get("token.create.success"), token);
    }

    /**
     * 移除用户令牌
     *
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "令牌管理", description = "移除令牌")
    @RequestMapping(value = "/removeToken", method = RequestMethod.POST)
    public ResponseUtil removeToken(@RequestBody @Validated RemoveTokenDTO removeTokenDTO) {
        return userAccessTokenApplicationService.removeToken(removeTokenDTO);
    }
}
