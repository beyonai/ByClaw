package com.iwhalecloud.byai.state.infrastructure.filter.sub;

import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.common.share.helper.ShareCacheUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.apache.poi.util.StringUtil;
import org.springframework.stereotype.Component;

/**
 * @author he.duming
 * @date 2025-09-08 15:52:31
 * @description TODO
 */
@Component
public class URLFilter extends BaseTokenFilter {

    /**
     * 认证处理
     *
     * @param request 请求
     */
    public boolean doFilter(HttpServletRequest request) {

        String userId = request.getParameter("userId");
        if (StringUtil.isBlank(userId)) {
            return false;
        }

        ShareBfmUser shareBfmUser = ShareCacheUtil.getShareBfmUser(Long.valueOf(userId));

        // 设置到当前线程中去
        LoginInfo userInfo = super.findOrBuildUerInfo(shareBfmUser.getUserCode());
        // userInfo.setAccessType("URL-TOKEN");
        // CurrentSessionUser.setUserInfo(userInfo);
        CurrentUserHolder.setLoginInfo(userInfo);

        return true;
    }
}
