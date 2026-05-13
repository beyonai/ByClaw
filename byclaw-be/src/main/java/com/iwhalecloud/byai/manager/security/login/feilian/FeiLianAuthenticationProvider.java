package com.iwhalecloud.byai.manager.security.login.feilian;

import java.io.IOException;

import com.iwhalecloud.byai.manager.entity.source.SourceSystem;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.security.exception.bean.LoginAuthenticationException;
import com.iwhalecloud.byai.common.constants.login.LoginType;
import com.iwhalecloud.byai.common.util.StringUtil;
import okhttp3.FormBody;
import okhttp3.RequestBody;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.stereotype.Component;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.source.service.SourceSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description 账号密码登录认证
 */
@Component
public class FeiLianAuthenticationProvider implements AuthenticationProvider {

    private static Logger logger = LoggerFactory.getLogger(FeiLianAuthenticationProvider.class);

    @Autowired
    private UserService userService;

    @Autowired
    private SourceSystemService sourceSystemService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    public FeiLianAuthenticationProvider() {
        super();
    }

    /**
     * 登陆认证
     *
     * @param authentication 认证信息
     * @return Authentication
     * @throws LoginAuthenticationException
     */
    @Override
    public Authentication authenticate(Authentication authentication) throws AuthenticationException {

        // 获取授权码
        String code = authentication.getPrincipal().toString();

        // 获取token
        SourceSystem sourceSystem = sourceSystemService.findBySystemCode(LoginType.FEI_lIAN);
        String token = this.getToken(sourceSystem, code);

        // 获取用户信息
        String userCode = this.getUserCode(sourceSystem, token);

        Users users = userService.findByUserCode(userCode);

        // 检查用户是否有效
        String checkResult = loginApplicationService.checkUserIsValid(users);
        if (StringUtil.isNotEmpty(checkResult)) {
            throw new LoginAuthenticationException(users.getUserId(), LoginType.FEI_lIAN, null, checkResult);
        }

        // 认证通过，返回token
        FeiLianAuthentication feiLianAuthentication = new FeiLianAuthentication();
        feiLianAuthentication.setUsers(users);
        feiLianAuthentication.setAuthenticated(true);
        return feiLianAuthentication;
    }

    /**
     * 获取请求的token
     * 
     * @param sourceSystem 来源系统
     * @param code 授权码
     * @return String
     */
    private String getToken(SourceSystem sourceSystem, String code) {

        // 创建客户端（可复用）
        OkHttpClient client = new OkHttpClient();

        // 构建表单参数（非链式写法）
        FormBody.Builder formBuilder = new FormBody.Builder();
        formBuilder.add("grant_type", "authorization_code");
        formBuilder.add("code", code);
        formBuilder.add("client_id", sourceSystem.getAppKey());
        formBuilder.add("redirect_uri", sourceSystem.getRedirectUri());
        formBuilder.add("client_secret", sourceSystem.getAppSecret());
        RequestBody formBody = formBuilder.build();

        Request request = new Request.Builder().url(sourceSystem.getGetTokenUrl()).header("Accept", "*/*")
            .post(formBody).build();

        // 同步执行请求
        try (Response response = client.newCall(request).execute()) {
            String responseBody = response.body().string();
            if (response.isSuccessful()) {
                JSONObject jsonObject = JSON.parseObject(responseBody);
                return jsonObject.getString("access_token");
            }
            else {
                logger.error("获取令牌失败:{}", responseBody);
            }
        }
        catch (IOException e) {
            logger.error(e.getMessage(), e);
        }

        throw new BadCredentialsException(I18nUtil.get("login.feilian.get.token.failed"));
    }

    /**
     * 获取登陆的工号
     * 
     * @param sourceSystem 系统信息
     * @param accessToken 认证token
     * @return String
     */
    private String getUserCode(SourceSystem sourceSystem, String accessToken) {

        // 创建 OkHttpClient 实例
        OkHttpClient client = new OkHttpClient();

        // 定义请求 URL（包含 access_token 参数）
        String url = sourceSystem.getUserInfoUrl();
        url = url.replace("{accessToken}", accessToken);

        // 构建请求对象
        Request.Builder requestBuilder = new Request.Builder();
        requestBuilder.url(url);

        // 添加请求头
        requestBuilder.addHeader("Accept", "*/*");
        Request request = requestBuilder.get().build();

        // 同步发送请求
        try (Response response = client.newCall(request).execute()) {
            String responseBody = response.body().string();
            if (response.isSuccessful()) {
                JSONObject jsonObject = JSON.parseObject(responseBody);
                return jsonObject.getString("user_id");
            }
            else {
                logger.error("获取用户信息失败:{}", responseBody);
            }
        }
        catch (IOException e) {
            logger.error(e.getMessage(), e);
        }

        throw new BadCredentialsException(I18nUtil.get("login.feilian.get.user.info.failed"));
    }

    /**
     * 类型的支持
     *
     * @param authentication 认证信息
     * @return supports
     */
    @Override
    public boolean supports(Class<?> authentication) {
        return authentication.isAssignableFrom(FeiLianAuthentication.class);
    }
}
