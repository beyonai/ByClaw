package com.iwhalecloud.byai.manager.application.service.app;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.dto.users.AppRefreshTokenLoginRequest;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.jwt.SsoTokenService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import java.util.Map;

/**
 * APP端认证应用服务
 * 
 * @author AI Assistant &#064;date 2025-01-XX
 */
@Service
public class AppAuthApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(AppAuthApplicationService.class);


    @Autowired
    private JwtService jwtService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Autowired
    private SsoTokenService ssoTokenService;

    /**
     * 通过RefreshToken进行静默登录
     *
     * @param request 刷新Token登录请求
     * @return ResponseUtil<LoginResponse>
     */
    public ResponseUtil<?> refreshTokenLogin(AppRefreshTokenLoginRequest request) {

        String refreshToken = request.getRefreshToken();

        // 验证RefreshToken并获取用户信息
        LoginInfo loginInfo = jwtService.verifyJwt(refreshToken, LoginInfo.class);
        if (loginInfo == null) {
            logger.warn("RefreshToken验证失败或已过期，refreshToken: " + refreshToken);
            return ResponseUtil.fail("RefreshToken已过期或无效，请重新登录");
        }

        // 重新获取完整的用户登录信息
        LoginInfo fullLoginInfo = loginApplicationService.getLoginInfo(loginInfo.getUserId());
        if (fullLoginInfo == null) {
            logger.warn("用户不存在，userId: " + loginInfo.getUserId());
            return ResponseUtil.fail("用户不存在");
        }

        // 获取HttpServletRequest和HttpSession
        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attributes == null) {
            logger.warn("无法获取HttpServletRequest");
            return ResponseUtil.fail("系统错误：无法获取请求上下文");
        }
        HttpServletRequest httpRequest = attributes.getRequest();
        HttpSession httpSession = httpRequest.getSession(true);

        // 设置登录类型（从原始loginInfo中获取，如果为空则使用默认值）
        if (loginInfo.getLoginType() != null) {
            fullLoginInfo.setLoginType(loginInfo.getLoginType());
        }
        else {
            fullLoginInfo.setLoginType("REFRESH_TOKEN");
        }

        // 设置sessionId
        fullLoginInfo.setSessionId(httpSession.getId());

        // 共享session
        loginApplicationService.shareSession(httpSession, fullLoginInfo);

        // 设置当前用户信息（用于创建ssoToken）
        CurrentUserHolder.setLoginInfo(fullLoginInfo);

        // 生成新的Token和RefreshToken
        String newToken = jwtService.createJwt(fullLoginInfo);
        String newRefreshToken = jwtService.generateRefreshJwt(fullLoginInfo);

        // 创建ssoToken
        String ssoToken = ssoTokenService.createSsoToken();

        // 构建登录响应数据（将LoginInfo字段和token字段合并到同一个Map中）
        // 先将LoginInfo转换为Map
        String loginInfoJson = JSON.toJSONString(fullLoginInfo);
        Map<String, Object> responseData = JSON.parseObject(loginInfoJson, Map.class);

        // 添加token相关字段
        responseData.put("sessionId", httpSession.getId());
        responseData.put("token", newToken);
        responseData.put("refreshToken", newRefreshToken);
        responseData.put("ssoToken", ssoToken);

        logger.info("RefreshToken登录成功，userId: {}", fullLoginInfo.getUserId());

        return ResponseUtil.successResponse(responseData);

    }

}
