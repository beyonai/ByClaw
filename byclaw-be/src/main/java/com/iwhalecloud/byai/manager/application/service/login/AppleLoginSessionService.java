package com.iwhalecloud.byai.manager.application.service.login;

import com.iwhalecloud.byai.manager.application.service.log.LoginLogApplicationService;
import com.iwhalecloud.byai.manager.application.service.superassist.SuasSuperassistApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserApplicationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.jwt.SsoTokenService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.login.LoginType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.LoginResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.Date;

/**
 * @description 苹果登录Session服务 处理苹果登录绑定成功后的自动登录逻辑，创建session并返回登录响应
 */
@Service
public class AppleLoginSessionService {

    private static final Logger logger = LoggerFactory.getLogger(AppleLoginSessionService.class);

    @Autowired
    private UserService userService;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private UserApplicationService userApplicationService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Autowired
    private LoginLogApplicationService loginLogApplicationService;

    @Autowired
    private SuasSuperassistApplicationService suasSuperassistApplicationService;

    @Autowired
    private SsoTokenService ssoTokenService;

    /**
     * 创建苹果登录绑定成功后的登录会话 复用Spring Security登录成功后的逻辑，创建session、JWT等
     *
     * @param request HTTP请求
     * @param users 绑定的用户信息
     * @return 登录响应（包含sessionId、token等）
     */
    public LoginResponse createLoginSession(HttpServletRequest request, Users users) {
        logger.info("苹果绑定成功后创建登录会话: userId={}, userCode={}", users.getUserId(), users.getUserCode());

        // 获取或创建HttpSession
        HttpSession httpSession = request.getSession(true);

        // 构建登录信息
        LoginInfo loginInfo = loginApplicationService.getLoginInfo(users);
        loginInfo.setSessionId(httpSession.getId());
        // 设置登录类型为苹果登录
        loginInfo.setLoginType(LoginType.APPLE);
        // 检查是否为默认密码
        loginInfo.setIsDefaultPwd(userApplicationService.checkDefaultPwd(users));

        // 初始化超级助手知识库
        SuasSuperassist suasSuperassist = suasSuperassistApplicationService.createDatasetIfNotExists(loginInfo);
        loginInfo.setSessionDatasetId(suasSuperassist.getSessionDatasetId());
        loginInfo.setDefaultDigEmployeeId(suasSuperassist.getDefaultDigEmployeeId());

        // 共享session实现
        loginApplicationService.shareSession(httpSession, loginInfo);

        // 放置用户到当前线程
        CurrentUserHolder.setLoginInfo(loginInfo);

        // 构建登录响应
        LoginResponse loginResponse = new LoginResponse();
        loginResponse.setCode(LoginResponse.SUCCESS);
        loginResponse.setMsg(I18nUtil.get("login.login.successful"));
        loginResponse.setData(loginInfo);
        loginResponse.setSessionId(httpSession.getId());
        loginResponse.setToken(jwtService.createJwt(loginInfo));
        loginResponse.setRefreshToken(jwtService.generateRefreshJwt(loginInfo));
        loginResponse.setSsoToken(ssoTokenService.createSsoToken());

        // 保存登录成功日志
        loginLogApplicationService.saveSuccessLog(request, users.getUserId(), LoginType.APPLE);

        // 更新最后登录时间
        users.setLastLoginDate(new Date());
        if (suasSuperassist.getSuperassistId() != null) {
            users.setAssistantId(suasSuperassist.getSuperassistId());
        }
        userService.update(users);

        logger.info("苹果绑定成功后登录会话创建成功: userId={}, sessionId={}", users.getUserId(), httpSession.getId());

        return loginResponse;
    }

    /**
     * 检查用户是否有效
     *
     * @param users 用户信息
     * @return 如果用户无效返回错误信息，有效返回null
     */
    public String checkUserValid(Users users) {
        return loginApplicationService.checkUserIsValid(users);
    }
}
