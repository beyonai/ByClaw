package com.iwhalecloud.byai.manager.application.service.token;

import java.util.Date;
import java.util.List;
import java.util.UUID;

import org.apache.commons.lang3.time.DateUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.domain.token.service.UserAccessTokenService;
import com.iwhalecloud.byai.manager.dto.token.RemoveTokenDTO;
import com.iwhalecloud.byai.manager.dto.token.TokenDTO;
import com.iwhalecloud.byai.manager.entity.token.UserAccessToken;
import com.iwhalecloud.byai.manager.qo.token.AccessTokenQo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.constants.Constants;

/**
 * @author he.duming
 * @date 2025-06-05 17:28:13
 * @description TODO
 */
@Service
public class UserAccessTokenApplicationService {

    @Autowired
    private UserAccessTokenService userAccessTokenService;

    /**
     * 用户访问令牌列表查询
     *
     * @return ResponseUtil
     */
    public PageInfo<UserAccessToken> list(AccessTokenQo accessTokenQo) {

        LambdaQueryWrapper<UserAccessToken> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(UserAccessToken::getUserId, CurrentUserHolder.getCurrentUserId());
        queryWrapper.eq(UserAccessToken::getTokenStatus, Constants.STATUS_00A);
        String keyword = accessTokenQo.getKeyword();
        if (StringUtil.isNotEmpty(keyword)) {
            queryWrapper.like(UserAccessToken::getAccessTokenName, keyword);
        }
        queryWrapper.orderByDesc(UserAccessToken::getCreateTime);

        Page<UserAccessToken> page = new Page<>(accessTokenQo.getPageNum(), accessTokenQo.getPageSize(), true);
        List<UserAccessToken> userAccessTokens = userAccessTokenService.selectList(page, queryWrapper);

        // 列表不再返回token令牌信息，仅生成时查询
        for (UserAccessToken userAccessToken : userAccessTokens) {
            userAccessToken.setAccessToken(null);
        }

        page.setRecords(userAccessTokens);

        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 创建令牌,并返回令牌信息
     *
     * @param tokenDTO 入参
     * @return String
     */
    public String createToken(TokenDTO tokenDTO) {

        String accessTokenName = tokenDTO.getAccessTokenName();
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        // 检查令牌名称是否重复
        Long count = userAccessTokenService.countAccessToken(accessTokenName, currentUserId);
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, accessTokenName + I18nUtil.get("token.name.duplicate.error"));
        }

        UserAccessToken userAccessToken = new UserAccessToken();
        userAccessToken.setAccessTokenName(accessTokenName);
        userAccessToken.setStartTime(new Date());
        userAccessToken.setEndTime(DateUtils.addYears(new Date(), 100));
        userAccessToken.setUserId(currentUserId);
        userAccessToken.setAccessToken(UUID.randomUUID().toString());
        userAccessToken.setCreateUser(currentUserId);
        userAccessToken.setTokenStatus(Constants.STATUS_00A);
        userAccessToken.setComAcctId(CurrentUserHolder.getEnterpriseId());
        userAccessTokenService.save(userAccessToken);

        return userAccessToken.getAccessToken();
    }

    /**
     * 移除用户令牌
     *
     * @param removeTokenDTO 令牌标识
     */
    public ResponseUtil removeToken(RemoveTokenDTO removeTokenDTO) {
        UserAccessToken userAccessToken = userAccessTokenService.findById(removeTokenDTO.getUserAccessTokenId());
        if (userAccessToken == null) {
            return ResponseUtil.fail(I18nUtil.get("token.info.notfound"));
        }

        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (currentUserId == null || !currentUserId.equals(userAccessToken.getUserId())) {
            return ResponseUtil.fail(I18nUtil.get("token.remove.permission.denied"));
        }

        userAccessToken.setTokenStatus(Constants.STATUS_00X);
        userAccessTokenService.update(userAccessToken);

        return ResponseUtil.success(I18nUtil.get("token.remove.success"));
    }
}
