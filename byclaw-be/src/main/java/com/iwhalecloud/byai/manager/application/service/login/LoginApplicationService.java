package com.iwhalecloud.byai.manager.application.service.login;

import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;

import org.apache.commons.collections.MapUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.login.ShareSessionKey;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.JwtUserInfo;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UserStation;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.util.threadPoolUti.ThreadPoolUtil;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthRedisSyncService;
import com.iwhalecloud.byai.manager.application.service.user.UserApplicationService;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.log.service.LoginLogService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.domain.station.service.StationService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.customer.ByaiCustomerLeads;
import com.iwhalecloud.byai.manager.entity.station.Station;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.customer.ByaiCustomerLeadsMapper;
import io.jsonwebtoken.lang.Collections;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

/**
 * @author he.duming
 * @date 2025-05-04 17:05:09
 * @description TODO
 */
@Service
public class LoginApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(LoginApplicationService.class);

    /**
     * 默认开放查询的key值,多个用逗号隔开
     */
    @Value("${open.dc.query.keys:ENV,beyondLogo,beyondTitle,beyondFavicon,beyondAssistant}")
    private String openKeys;

    @Autowired
    private UserService userService;

    @Autowired
    private LoginLogService loginLogService;

    @Autowired
    private OrganizationService organizationService;

    @Autowired
    private EnterpriseInfoService enterpriseInfoService;

    @Autowired
    private PrivilegeGrantService privilegeGrantService;

    @Autowired
    private SuasSuperassistService suasSuperassistService;

    @Autowired
    private StationService stationService;

    @Autowired
    private SystemConfigService systemConfigService;

    @Autowired
    private ByaiCustomerLeadsMapper byaiCustomerLeadsMapper;

    @Autowired
    private UserApplicationService userApplicationService;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private SandboxService sandboxService;

    @Autowired
    private AuthRedisSyncService authRedisSyncService;

    private final Executor asyncExecutor = ThreadPoolUtil.getThreadPool(4, 8, 32, 60, "async-user-login-job");

    /**
     * 根据用户标识获取用户登陆信息
     *
     * @param userId 用户标识
     * @return LoginInfo
     */
    public LoginInfo getLoginInfo(Long userId) {
        Users users = userService.findById(userId);
        return this.getLoginInfo(users);
    }

    /**
     * 根据用户标识获取用户登陆信息
     *
     * @param userCode 用户编码
     * @return LoginInfo
     */
    public LoginInfo getLoginInfo(String userCode) {
        Users users = userService.findByUserCode(userCode);
        return this.getLoginInfo(users);
    }

    /**
     * 根据用户获取登陆信息
     *
     * @param users 用户信息
     * @return LoginInfo
     */
    public LoginInfo getLoginInfo(Users users) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(users.getUserId());
        loginInfo.setUserCode(users.getUserCode());
        loginInfo.setUserName(users.getUserName());
        loginInfo.setAssistantId(users.getAssistantId());
        loginInfo.setPhone(users.getPhone());
        loginInfo.setEmail(users.getEmail());
        loginInfo.setRegisterType(users.getRegisterType());
        loginInfo.setEnterpriseId(enterpriseInfoService.getEnterpriseId());
        loginInfo.setComAcctId(loginInfo.getEnterpriseId());
        loginInfo.setUsersOrganizations(organizationService.findUsersOrganizationByUserId(users.getUserId()));
        // 管理组织
        loginInfo.setUserManageOrgs(privilegeGrantService.findUserManageOrg(users.getUserId()));
        SuasSuperassist suasSuperassist = suasSuperassistService.findByUserId(users.getUserId());
        loginInfo.setDefaultDigEmployeeId(suasSuperassist != null ? suasSuperassist.getDefaultDigEmployeeId() : null);
        // 查询驻地
        if (users.getStationId() != null) {
            Station station = stationService.getById(users.getStationId());
            if (station != null) {
                UserStation userStation = new UserStation();
                BeanUtils.copyProperties(station, userStation);
                loginInfo.setUserStation(userStation);
            }
        }
        loginInfo.setIsRetented(getRetented(users.getPhone()));
        return loginInfo;
    }

    /**
     * 实时查询用户手机是否注册过
     *
     * @param phone 手机号码
     * @return boolean
     */
    private boolean getRetented(String phone) {
        if (phone == null) {
            return false;
        }
        LambdaQueryWrapper<ByaiCustomerLeads> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiCustomerLeads::getPhone, phone);
        Long count = byaiCustomerLeadsMapper.selectCount(queryWrapper);
        return count > 0;
    }

    /**
     * 设置session共享
     *
     * @param session session信息
     * @param loginInfo 登陆用户信息
     */
    public void shareSession(HttpSession session, LoginInfo loginInfo) {

        session.setAttribute("userId", loginInfo.getUserId());
        session.setAttribute("userCode", loginInfo.getUserCode());
        session.setAttribute("userName", loginInfo.getUserName());
        session.setAttribute("assistantId", loginInfo.getAssistantId());
        session.setAttribute("sessionDatasetId", loginInfo.getSessionDatasetId());
        session.setAttribute("defaultDigEmployeeId", loginInfo.getDefaultDigEmployeeId());
        session.setAttribute("enterpriseId", loginInfo.getEnterpriseId());
        session.setAttribute("loginType", loginInfo.getLoginType());
        session.setAttribute("usersOrganizations", JSON.toJSONString(loginInfo.getUsersOrganizations()));
        session.setAttribute("userStation", JSON.toJSONString(loginInfo.getUserStation()));
        session.setAttribute("registerType", loginInfo.getRegisterType());

        // 封装原来门户参数
        Map<String, Object> shareCurrentUser = this.buildShareCurrentUserObjectMap(loginInfo);
        session.setAttribute(ShareSessionKey.USER_CODE, loginInfo.getUserCode());
        session.setAttribute(ShareSessionKey.SHARE_CURRENT_USER, JSON.toJSONString(shareCurrentUser));
        session.setAttribute(ShareSessionKey.SHARE_USERS_ORGANIZATIONS,
            JSON.toJSONString(loginInfo.getUsersOrganizations()));
        session.setAttribute(ShareSessionKey.SHARE_CURRENT_MANAGE_ORG,
            JSON.toJSONString(loginInfo.getUserManageOrgs()));
    }

    /**
     * @param loginInfo 登陆用户信息
     * @return Map
     */
    public Map<String, Object> buildShareCurrentUserObjectMap(LoginInfo loginInfo) {
        Map<String, Object> shareCurrentUser = new HashMap<>(10);
        shareCurrentUser.put("userId", loginInfo.getUserId());
        shareCurrentUser.put("userCode", loginInfo.getUserCode());
        shareCurrentUser.put("userName", loginInfo.getUserName());
        shareCurrentUser.put("email", loginInfo.getEmail());
        shareCurrentUser.put("enterpriseId", loginInfo.getEnterpriseId());
        shareCurrentUser.put("comAcctId", loginInfo.getEnterpriseId());
        shareCurrentUser.put("phone", loginInfo.getPhone());
        return shareCurrentUser;
    }

    /**
     * 获取当前用户信息
     *
     * @param request 请求
     * @return ResponseUtil
     */
    public ResponseUtil<LoginInfo> currentUser(HttpServletRequest request) {

        HttpSession httpSession = request.getSession();
        String userCode = this.getSessionString(httpSession, "userCode");
        String beyondToken = request.getHeader("Beyond-Token");

        // 优先获取session登陆
        if (StringUtil.isNotEmpty(userCode)) {

            logger.info("当前用户登录信息是:{}", userCode);

            String shareCurrentUser = httpSession.getAttribute(ShareSessionKey.SHARE_CURRENT_USER) + "";
            LoginInfo loginInfo = JSON.parseObject(shareCurrentUser, LoginInfo.class);
            loginInfo.setAssistantId(this.getSessionLong(httpSession, "assistantId"));
            loginInfo.setSessionDatasetId(this.getSessionLong(httpSession, "sessionDatasetId"));
            loginInfo.setDefaultDigEmployeeId(this.getSessionLong(httpSession, "defaultDigEmployeeId"));
            loginInfo.setLoginType(this.getSessionString(httpSession, "loginType"));
            loginInfo.setEnterpriseId(this.getSessionLong(httpSession, "enterpriseId"));
            loginInfo.setSessionId(httpSession.getId());
            loginInfo.setIsRetented(getRetented(loginInfo.getPhone()));
            loginInfo.setRegisterType(this.getSessionInteger(httpSession, "registerType"));

            // 检查用户密码是否是默认密码
            Users users = userService.findById(loginInfo.getUserId());
            loginInfo.setIsDefaultPwd(userApplicationService.checkDefaultPwd(users));

            // 用户关联组织
            String usersOrganizationsJson = this.getSessionString(httpSession, "usersOrganizations");
            loginInfo.setUsersOrganizations(JSON.parseArray(usersOrganizationsJson, UsersOrganization.class));

            String userStationJson = this.getSessionString(httpSession, "userStation");
            if (userStationJson != null) {
                loginInfo.setUserStation(JSON.parseObject(userStationJson, UserStation.class));
            }

            // 初始化超级助
            SuasSuperassist suasSuperassist = suasSuperassistService.findByUserId(loginInfo.getUserId());
            loginInfo.setSessionDatasetId(suasSuperassist != null ? suasSuperassist.getSessionDatasetId() : null);

            // 异步启动用户沙箱（不阻塞接口响应）
            doAsyncJobAfterLogin(loginInfo.getUserCode(), loginInfo.getUserId());

            return ResponseUtil.successResponse("Ok", loginInfo);
        }
        else if (StringUtil.isNotEmpty(beyondToken)) {

            JwtUserInfo jwtUserInfo = jwtService.verifyJwt(beyondToken, JwtUserInfo.class);

            logger.info("当前用户登录jwt信息是:{}", JSON.toJSONString(jwtUserInfo));

            LoginInfo loginInfo = this.getLoginInfo(jwtUserInfo.getUserCode());
            SuasSuperassist suasSuperassist = suasSuperassistService.findByUserId(loginInfo.getUserId());
            loginInfo.setSessionDatasetId(suasSuperassist != null ? suasSuperassist.getSessionDatasetId() : null);

            // 异步启动用户沙箱（不阻塞接口响应）
            doAsyncJobAfterLogin(loginInfo.getUserCode(), loginInfo.getUserId());

            return ResponseUtil.successResponse("Ok", loginInfo);
        }
        else {
            return ResponseUtil.fail(I18nUtil.get("login.user.not.logged.in"));
        }
    }

    /**
     * 异步启动用户沙箱，不阻塞当前请求
     *
     * @param userCode 用户编码
     */
    private void doAsyncJobAfterLogin(String userCode, Long userId) {
        if (StringUtil.isEmpty(userCode)) {
            return;
        }
        asyncExecutor.execute(() -> {
            try {
                sandboxService.ensureSandboxReady(userCode, -1L, null);
                authRedisSyncService.asyncSyncUserAuthToRedis(userId);
            }
            catch (Exception e) {
                logger.warn("异步启动用户沙箱失败，用户编码：{}", userCode, e);
            }
        });
    }

    /**
     * 从session中获取属性
     *
     * @param httpSession 会话信息
     * @param attributeName 属性名称
     * @return String
     */
    private String getSessionString(HttpSession httpSession, String attributeName) {
        Object attributeValue = httpSession.getAttribute(attributeName);
        return attributeValue != null ? attributeValue.toString() : null;
    }

    private Integer getSessionInteger(HttpSession httpSession, String attributeName) {
        Object attributeValue = httpSession.getAttribute(attributeName);
        return attributeValue != null ? Integer.valueOf(attributeValue.toString()) : null;
    }

    /**
     * 从session中获取属性
     *
     * @param httpSession 会话信息
     * @param attributeName 属性名称
     * @return Long
     */
    private Long getSessionLong(HttpSession httpSession, String attributeName) {
        String attributeValue = this.getSessionString(httpSession, attributeName);
        return StringUtil.isNotEmpty(attributeValue) ? Long.parseLong(attributeValue) : null;
    }

    /**
     * 退出登录
     *
     * @param request 请求信息
     * @return ResponseUtil
     */
    public ResponseUtil logout(HttpServletRequest request) {
        HttpSession session = request.getSession();
        if (session == null) {
            return ResponseUtil.fail(I18nUtil.get("login.user.not.logged.in.logout"));
        }

        Long userId = CurrentUserHolder.getCurrentUserId();
        String activeKey = Constants.USER_ACTIVE_PREFIX + userId;
        RedisUtil.removeKey(activeKey);

        // 移除用在线用户
        RedisUtil.removeSet(Constants.ONLINE_USERS_SET_KEY, String.valueOf(userId));

        // 记录登陆退出时间
        loginLogService.updateLogoutTimeBySessionId(session.getId());

        session.invalidate();

        return ResponseUtil.success(I18nUtil.get("login.logout.success"));
    }

    /**
     * 检查用户是否有效
     *
     * @param users 用户信息
     * @return String
     */
    public String checkUserIsValid(Users users) {

        // 用户名或者密码错误
        if (users == null) {
            return I18nUtil.get("login.password.user.error");
        }

        // 用户是否锁定
        if (Constants.YES_VALUE_Y.equalsIgnoreCase(users.getIsLocked())) {
            return I18nUtil.get("login.login.lock");
        }

        // 用户是否过期
        Date userExpDate = users.getUserExpDate();
        if (userExpDate != null && userExpDate.before(new Date())) {
            return "User Expire!";
        }

        // 用户是否禁用
        if (UserState.DISABLED.equalsIgnoreCase(users.getState())) {
            return "User Disabled!";
        }

        return null;
    }

    /**
     * 获取环境变量值默认值,不需要登陆,如果不是查询允许配置的key，默认返回NONE;
     *
     * @param params 入参
     * @return ResponseUtil
     */
    public String getDcSystemConfigValueByCode(Map<String, Object> params) {

        String paramCode = MapParamUtil.getStringValue(params, "paramCode");

        if (StringUtil.isEmpty(paramCode)) {
            logger.error("当key查询入参paramCode为空!");
            return "NONE";
        }

        List<String> splitOpenKeys = Arrays.asList(openKeys.split(","));
        if (splitOpenKeys.contains(paramCode)) {
            return systemConfigService.getStringParamValueByCode(paramCode);
        }
        else {
            logger.error("当key查询入参paramCode={}无权限!", paramCode);
            return "NONE";
        }
    }

    public Map<String, Object> getDcSystemConfigValueByCodes(Map<String, Object> params) {
        Map<String, Object> res = new HashMap<>();
        List<String> paramCodes = (List<String>) MapUtils.getObject(params, "paramCodes");

        if (Collections.isEmpty(paramCodes)) {
            logger.error("当key查询入参paramCode为空!");
            return res;
        }

        List<String> splitOpenKeys = Arrays.asList(openKeys.split(","));
        boolean isContains = new HashSet<>(splitOpenKeys).containsAll(paramCodes);
        if (isContains) {
            return systemConfigService.findParamValueMapByCodes(paramCodes);
        }
        else {
            logger.error("当key查询入参paramCode={}无权限!", paramCodes);
            return res;
        }
    }
}
