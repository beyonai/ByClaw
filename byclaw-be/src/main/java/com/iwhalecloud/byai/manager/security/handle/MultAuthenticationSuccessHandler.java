package com.iwhalecloud.byai.manager.security.handle;

import com.alibaba.fastjson.JSON;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.login.LoginAuthKey;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.auth.AuthRedisSyncService;
import com.iwhalecloud.byai.manager.application.service.log.LoginLogApplicationService;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.superassist.SuasSuperassistApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserApplicationService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.jwt.SsoTokenService;
import com.iwhalecloud.byai.manager.security.login.apple.AppleAuthentication;
import com.iwhalecloud.byai.manager.security.login.cas.CasAuthentication;
import com.iwhalecloud.byai.manager.security.login.dingtalk.DingtalkAuthentication;
import com.iwhalecloud.byai.manager.security.login.feilian.FeiLianAuthentication;
import com.iwhalecloud.byai.manager.security.login.iwhale.IwhaleAuthentication;
import com.iwhalecloud.byai.manager.security.login.username.UsernameAuthentication;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.constants.login.LoginType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.IpUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.util.threadPoolUti.ThreadPoolUtil;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.LoginResponse;
import com.iwhalecloud.byai.common.constants.Constants;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.io.IOException;
import java.util.Date;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

/**
 * @author he.duming
 * @date 2025-04-14 19:33:29
 * @description 登陆成功处理方法
 */
@Component
public class MultAuthenticationSuccessHandler implements AuthenticationSuccessHandler {

    private final Logger logger = LoggerFactory.getLogger(MultAuthenticationSuccessHandler.class);

    @Value("${jwt.token.expired.hour:24}")
    private int tokenExpiredHour;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private UserService userService;

    @Autowired
    private SandboxService sandboxService;

    @Autowired
    private SsoTokenService ssoTokenService;

    @Autowired
    private SystemConfigService systemConfigService;

    @Autowired
    private UserApplicationService userApplicationService;

    @Autowired
    private UserFS userFS;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Autowired
    private LoginLogApplicationService loginLogApplicationService;

    @Autowired
    private SuasSuperassistApplicationService suasSuperassistApplicationService;

    @Autowired
    private AuthRedisSyncService authRedisSyncService;

    private final Executor executor = ThreadPoolUtil.getThreadPool(8, 16, 32, 60, "refresh-aimodel");

    /**
     * 登陆成功事件
     *
     * @param request 请求
     * @param response 响应
     * @param authentication 认证异常俗话上
     * @throws IOException IO异常信息
     * @throws ServletException ServletException
     */
    @Override
    public void onAuthenticationSuccess(HttpServletRequest request, HttpServletResponse response,
        Authentication authentication) throws IOException, ServletException {

        // 非正常用户访问
        Object principal = authentication.getPrincipal();
        if (!(principal instanceof Users users)) {
            String message = I18nUtil.get("login.auth.success.user.type.error");
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, message);
        }

        HttpSession httpSession = request.getSession();

        LoginInfo loginInfo = loginApplicationService.getLoginInfo(users);
        loginInfo.setSessionId(httpSession.getId());
        loginInfo.setLoginType(this.parseLoginType(authentication));
        // 是否和默认密码相同
        loginInfo.setIsDefaultPwd(userApplicationService.checkDefaultPwd(users));

        // 登陆成功响应信息
        LoginResponse loginResponse = new LoginResponse();

        // 如果是用户名密码登陆，并且是手机端的，密码相同，特殊处理
        if (LoginType.USERNAME.equalsIgnoreCase(loginInfo.getLoginType()) && IpUtil.isMobileAgent(request)
            && loginInfo.getIsDefaultPwd()) {
            loginResponse.setCode(LoginResponse.DEFAULT_PWD);
            loginResponse.setMsg(I18nUtil.get("login.default.pwd.reset"));
        }
        else {
            loginResponse.setCode(LoginResponse.SUCCESS);
            loginResponse.setMsg(I18nUtil.get("login.login.successful"));
        }

        // 初始化超级助手知识库
        SuasSuperassist suasSuperassist = suasSuperassistApplicationService.createDatasetIfNotExists(loginInfo);
        loginInfo.setSessionDatasetId(suasSuperassist.getSessionDatasetId());
        loginInfo.setDefaultDigEmployeeId(suasSuperassist.getDefaultDigEmployeeId());

        // 共享session实现
        loginApplicationService.shareSession(httpSession, loginInfo);

        // 放置用户到当前线程
        CurrentUserHolder.setLoginInfo(loginInfo);

        mountUserBucket(loginInfo.getUserCode());

        // 设置返回值
        loginResponse.setData(loginInfo);
        loginResponse.setSessionId(httpSession.getId());
        loginResponse.setToken(jwtService.createJwt(loginInfo));
        loginResponse.setRefreshToken(jwtService.generateRefreshJwt(loginInfo));
        loginResponse.setSsoToken(ssoTokenService.createSsoToken());

        logger.info("当前用户登陆信息是:{}", JSON.toJSONString(loginResponse));

        // 更新最后登陆的时间
        users.setLastLoginDate(new Date());
        if (suasSuperassist.getSuperassistId() != null) {
            users.setAssistantId(suasSuperassist.getSuperassistId());
        }
        userService.update(users);

        // 保存日志
        loginLogApplicationService.saveSuccessLog(request, users.getUserId(), loginInfo.getLoginType());

        // 异步启动用户沙箱（不阻塞登录响应）
        String sandboxUserCode = loginInfo.getUserCode();
        executor.execute(() -> {
            try {
                sandboxService.launchSandbox(sandboxUserCode, null);
                authRedisSyncService.asyncSyncUserAuthToRedis(loginInfo.getUserId());
            }
            catch (Exception e) {
                logger.warn("登录后异步启动沙箱失败，用户编码：{}", sandboxUserCode, e);
            }
        });

        // 放置用户授权信息
        this.putLoginAuth(loginResponse);

        this.writeResponse(response, loginResponse);
    }

    /**
     * 放置登陆信息
     *
     * @param loginResponse 登陆响应
     */
    private void putLoginAuth(LoginResponse loginResponse) {

        LoginInfo loginInfo = loginResponse.getData();

        // replace key
        String key = LoginAuthKey.USER_LOGIN_AUTH.replace("{userId}", String.valueOf(loginInfo.getUserId()));

        RedisUtil.hmPut(key, LoginAuthKey.HM_KEY_USER_ID, String.valueOf(loginInfo.getUserId()));
        RedisUtil.hmPut(key, LoginAuthKey.HM_KEY_USER_CODE, loginInfo.getUserCode());
        RedisUtil.hmPut(key, LoginAuthKey.HM_KEY_USERNAME, loginInfo.getUserName());
        RedisUtil.hmPut(key, LoginAuthKey.HM_KEY_SSO_TOKEN, loginResponse.getSsoToken());
        RedisUtil.hmPut(key, LoginAuthKey.HM_KEY_BEYOND_TOKEN, loginResponse.getToken());

        // put bear token
        String authorizationBearer = systemConfigService.getStringParamValueByCode("AUTHORIZATION_BEARER");
        if (StringUtil.isNotEmpty(authorizationBearer)) {
            RedisUtil.hmPut(key, LoginAuthKey.HM_KEY_WHALE_AGENT_AUTHORIZATION, authorizationBearer);
        }

        // 超时时间
        RedisUtil.expire(key, tokenExpiredHour, TimeUnit.HOURS);
    }

    private void mountUserBucket(String userCode) {
        try {
            userFS.mount();
        }
        catch (Exception e) {
            logger.error("登录后挂载用户bucket失败，系统继续登录流程, userCode={}", userCode, e);
        }
    }

    /**
     * 登陆响应
     *
     * @param response 响应头
     * @param loginResponse 响应信息
     */
    private void writeResponse(HttpServletResponse response, LoginResponse loginResponse) {
        try (ServletOutputStream outputStream = response.getOutputStream();) {
            response.setHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE);
            ObjectMapper objectMapper = new ObjectMapper();
            objectMapper.writeValue(outputStream, loginResponse);
            outputStream.flush();
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
    }

    /**
     * 获取登陆认证类型
     *
     * @param authentication 认证信息
     * @return String
     */
    private String parseLoginType(Authentication authentication) {
        if (authentication instanceof UsernameAuthentication) {
            return LoginType.USERNAME;
        }
        else if (authentication instanceof IwhaleAuthentication) {
            return LoginType.IWHALE;
        }
        else if (authentication instanceof DingtalkAuthentication) {
            return LoginType.DINGTALK;
        }
        else if (authentication instanceof CasAuthentication) {
            return LoginType.CAS;
        }
        else if (authentication instanceof FeiLianAuthentication) {
            return LoginType.FEI_lIAN;
        }
        else if (authentication instanceof AppleAuthentication) {
            return LoginType.APPLE;
        }
        return null;
    }

}
