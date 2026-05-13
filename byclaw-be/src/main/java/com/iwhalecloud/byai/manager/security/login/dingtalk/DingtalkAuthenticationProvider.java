package com.iwhalecloud.byai.manager.security.login.dingtalk;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.aliyun.dingtalkcontact_1_0.models.GetUserHeaders;
import com.aliyun.dingtalkcontact_1_0.models.GetUserResponse;
import com.aliyun.dingtalkoauth2_1_0.Client;
import com.aliyun.dingtalkoauth2_1_0.models.GetAccessTokenResponse;
import com.aliyun.dingtalkoauth2_1_0.models.GetUserTokenRequest;
import com.aliyun.dingtalkoauth2_1_0.models.GetUserTokenResponse;
import com.aliyun.tea.TeaException;
import com.aliyun.teaopenapi.models.Config;
import com.aliyun.teautil.models.RuntimeOptions;
import com.dingtalk.api.DefaultDingTalkClient;
import com.dingtalk.api.DingTalkClient;
import com.dingtalk.api.request.OapiV2UserGetRequest;
import com.dingtalk.api.request.OapiV2UserGetuserinfoRequest;
import com.dingtalk.api.response.OapiV2UserGetResponse;
import com.dingtalk.api.response.OapiV2UserGetuserinfoResponse;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.source.service.SourceSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.source.SourceSystem;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.security.exception.bean.LoginAuthenticationException;
import com.iwhalecloud.byai.common.constants.login.LoginType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.stereotype.Component;

/**
 * @author li.qinglin
 * @date 2025-05-02 14:12:45
 * @description 钉钉登录验证
 */
@Component
public class DingtalkAuthenticationProvider implements AuthenticationProvider {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkAuthenticationProvider.class);


    @Autowired
    private UserService userService;

    @Autowired
    private SourceSystemService sourceSystemService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Override
    public Authentication authenticate(Authentication authentication) throws AuthenticationException {
        String code = authentication.getPrincipal().toString();
        // 如果是1那就是工作台登录
        String loginType = authentication.getCredentials() == null ? null : authentication.getCredentials().toString();

        if (StringUtil.isEmpty(code)) {
            throw new BadCredentialsException(I18nUtil.get("dingtalkauthprovider.code.notnull"));
        }
        /*
         * 钉钉API: 如果在调用中发现返回数据中没有手机号、邮箱等信息，登录开发者后台查看是否添加了获取通讯录中手机号和邮箱的权限 需要开通权限 1. 个人手机号信息 获取用户个人信息 Contact.User.mobile
         * 2. 企业员工手机号信息 查询用户详情 fieldMobile （工作台需要 3. 通讯录个人信息读权限 获取用户个人信息 Contact.User.Read
         */
        String mobile;
        // 如果是1那就是工作台登录
        if (StringUtil.isEmpty(loginType)) {
            mobile = this.getDingtalkPhone(code);
        }
        else {
            // 钉钉工作台登录
            mobile = this.getWorkbenchesDingtalkPhone(code);
        }
        // 调用钉钉获取当前账号的手机，查询我们自己的库表是否存在
        Users users = userService.findByUserPhone(mobile);
        if (users == null) {
            throw new BadCredentialsException(I18nUtil.get("dingtalkauthprovider.auth.fail"));
        }

        // 检查用户是否有效
        String checkResult = loginApplicationService.checkUserIsValid(users);
        if (StringUtil.isNotEmpty(checkResult)) {
            throw new LoginAuthenticationException(users.getUserId(), LoginType.DINGTALK, null, checkResult);
        }

        // 4. Authentication successful
        DingtalkAuthentication token = new DingtalkAuthentication();
        token.setUsers(users);
        token.setAuthenticated(true);
        return token;

    }

    /*
     * 网页登录： 根据 authCode，调用服务端获取用户token接口，获取用户个人token
     */
    private String getUserAccessToken(String code) throws Exception {

        try {
            Config config = new Config();
            config.protocol = "https";
            config.regionId = "central";
            Client client = new Client(config);

            SourceSystem sourceSystem = sourceSystemService.findBySystemCode("dingtalk");

            String appKey = sourceSystem.getAppKey();
            String appSecret = sourceSystem.getAppSecret();

            GetUserTokenRequest getUserTokenRequest = new GetUserTokenRequest().setClientId(appKey)
                .setClientSecret(appSecret).setCode(code).setGrantType("authorization_code");

            GetUserTokenResponse response = client.getUserToken(getUserTokenRequest);
            return response.getBody().getAccessToken();
        }
        catch (TeaException err) {
            logger.error("钉钉获取access_token失败: ", err);
            throw new BadCredentialsException(I18nUtil.get("dingtalkauthprovider.access_token.fail"));
        }
    }

    /*
     * 网页登录： 根据用户个人token，调用获取用户通讯录个人信息接口，获取授权用户个人信息。
     */
    private String getUserInfo(String accessToken) throws Exception {
        try {
            Config config = new Config();
            config.protocol = "https";
            config.regionId = "central";
            com.aliyun.dingtalkcontact_1_0.Client client = new com.aliyun.dingtalkcontact_1_0.Client(config);

            GetUserHeaders headers = new GetUserHeaders();
            headers.xAcsDingtalkAccessToken = accessToken;

            GetUserResponse response = client.getUserWithOptions("me", headers, new RuntimeOptions());
            return response.getBody().getMobile();
        }
        catch (TeaException err) {
            logger.error("钉钉获取用户信息失败: ", err);
            throw new BadCredentialsException(I18nUtil.get("dingtalkauthprovider.userinfo.fail"));
        }
    }

    private String getDingtalkPhone(String code) {
        try {
            String accessToken = this.getUserAccessToken(code);
            String mobile = this.getUserInfo(accessToken);
            if (StringUtil.isEmpty(mobile)) {
                logger.error("钉钉获取的手机号码为空");
                throw new BadCredentialsException(I18nUtil.get("dingtalkauthprovider.login.fail"));
            }
            return mobile;
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BadCredentialsException(I18nUtil.get("dingtalkauthprovider.login.fail"));
        }
    }

    /* 钉钉工作台登录 获取应用的token */
    private String getWorkbenchesAccessToken() throws Exception {
        try {
            Config config = new Config();
            config.protocol = "https";
            config.regionId = "central";
            com.aliyun.dingtalkoauth2_1_0.Client client = new com.aliyun.dingtalkoauth2_1_0.Client(config);

            SourceSystem sourceSystem = sourceSystemService.findBySystemCode("dingtalk");

            String appKey = sourceSystem.getAppKey();
            String appSecret = sourceSystem.getAppSecret();

            com.aliyun.dingtalkoauth2_1_0.models.GetAccessTokenRequest getAccessTokenRequest = new com.aliyun.dingtalkoauth2_1_0.models.GetAccessTokenRequest()
                .setAppKey(appKey).setAppSecret(appSecret);

            GetAccessTokenResponse response = client.getAccessToken(getAccessTokenRequest);
            return response.getBody().getAccessToken();
        }
        catch (TeaException err) {
            logger.error("钉钉工作台获取access_token失败: ", err);
            throw new BadCredentialsException(I18nUtil.get("dingtalkauthprovider.workbench.access_token.fail"));
        }
    }

    /* 通过免登码获取用户信息接口，获取用户userid。 */
    private String getWorkbenchesUserId(String accessToken, String code) throws Exception {
        try {
            DingTalkClient client = new DefaultDingTalkClient("https://oapi.dingtalk.com/topapi/v2/user/getuserinfo");
            OapiV2UserGetuserinfoRequest req = new OapiV2UserGetuserinfoRequest();
            req.setCode(code);
            OapiV2UserGetuserinfoResponse rsp = client.execute(req, accessToken);
            return rsp.getResult().getUserid();
        }
        catch (TeaException err) {
            logger.error("钉钉工作台获取userId失败: ", err);
            throw new BadCredentialsException(I18nUtil.get("dingtalkauthprovider.workbench.userid.fail"));
        }
    }

    /* 调用查询用户详情接口，获取用户信息。 */
    private String getWorkbenchesPhone(String accessToken, String userId) throws Exception {
        try {
            DingTalkClient client = new DefaultDingTalkClient("https://oapi.dingtalk.com/topapi/v2/user/get");
            OapiV2UserGetRequest req = new OapiV2UserGetRequest();
            req.setUserid(userId);
            OapiV2UserGetResponse rsp = client.execute(req, accessToken);
            return rsp.getResult().getMobile();
        }
        catch (TeaException err) {
            logger.error("钉钉工作台获取用户信息失败: ", err);
            throw new BadCredentialsException(I18nUtil.get("dingtalkauthprovider.workbench.userinfo.fail"), err);
        }
    }

    private String getWorkbenchesDingtalkPhone(String code) {
        try {
            String accessToken = this.getWorkbenchesAccessToken();
            String userId = this.getWorkbenchesUserId(accessToken, code);
            String mobile = this.getWorkbenchesPhone(accessToken, userId);
            if (StringUtil.isEmpty(mobile)) {
                logger.error("工作台钉钉获取的手机号码为空");
                throw new BadCredentialsException(I18nUtil.get("dingtalkauthprovider.login.fail"));
            }
            return mobile;
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BadCredentialsException(I18nUtil.get("dingtalkauthprovider.login.fail"));
        }
    }

    @Override
    public boolean supports(Class<?> authentication) {
        return authentication.isAssignableFrom(DingtalkAuthentication.class);
    }
}
