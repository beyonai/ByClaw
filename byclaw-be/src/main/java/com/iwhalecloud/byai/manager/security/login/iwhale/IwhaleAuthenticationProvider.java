package com.iwhalecloud.byai.manager.security.login.iwhale;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.auth0.jwt.JWT;
import com.auth0.jwt.interfaces.Claim;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.source.service.SourceSystemService;
import com.iwhalecloud.byai.manager.entity.source.SourceSystem;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.security.exception.bean.LoginAuthenticationException;
import com.iwhalecloud.byai.common.constants.login.LoginType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.login.bean.WhaleTokenUser;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import java.util.Map;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description 账号密码登录认证
 */
@Component
public class IwhaleAuthenticationProvider implements AuthenticationProvider {

    private static final Logger logger = LoggerFactory.getLogger(IwhaleAuthenticationProvider.class);


    @Autowired
    private UserService userService;

    @Autowired
    private SourceSystemService sourceSystemService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    public IwhaleAuthenticationProvider() {
        super();
    }

    /**
     * 登陆认证
     * 
     * @param authentication 认证信息
     * @return Authentication
     * @throws AuthenticationException
     */
    @Override
    public Authentication authenticate(Authentication authentication) throws AuthenticationException {

        // 获取授权码
        String code = authentication.getPrincipal().toString();
        if (StringUtil.isEmpty(code)) {
            throw new BadCredentialsException(I18nUtil.get("login.code.notnull"));
        }

        WhaleTokenUser whaleTokenUser = this.getWhaleTokenUser(code);

        Users users = userService.findByUserCode(whaleTokenUser.getUserCode());

        // 检查用户是否有效
        String checkResult = loginApplicationService.checkUserIsValid(users);
        if (StringUtil.isNotEmpty(checkResult)) {
            throw new LoginAuthenticationException(users.getUserId(), LoginType.IWHALE, null, checkResult);
        }

        // 认证通过，返回token
        IwhaleAuthentication token = new IwhaleAuthentication();
        token.setUsers(users);
        token.setAuthenticated(true);

        return token;
    }

    /**
     * 根据验证码获取鲸+登陆信息
     * 
     * @param code 验证码
     * @return WhaleTokenUser
     */
    private WhaleTokenUser getWhaleTokenUser(String code) {

        SourceSystem sourceSystem = sourceSystemService.findBySystemCode("iwhale");

        String appKey = sourceSystem.getAppKey();
        String appSecret = sourceSystem.getAppSecret();

        String tokenUrl = sourceSystem.getGetTokenUrl();

        tokenUrl = tokenUrl.replace("{code}", code).replace("{appKey}", appKey).replace("{appSecret}", appSecret);

        logger.info("获取token地址是:{}", tokenUrl);

        // 创建 OkHttpClient 实例
        OkHttpClient client = new OkHttpClient();

        // 构建请求
        Request request = new Request.Builder().url(tokenUrl).build();

        try (Response response = client.newCall(request).execute()) {

            // 检查响应是否成功
            if (!response.isSuccessful()) {
                throw new BadCredentialsException(I18nUtil.get("login.token.fail"));
            }

            // 获取响应数据
            JSONObject jsonObject = JSON.parseObject(response.body().string());
            String token = jsonObject.getString("token");

            DecodedJWT decode = JWT.decode(token);

            Map<String, Claim> claims = decode.getClaims();
            WhaleTokenUser whaleTokenUser = this.buildWhaleTokenUser(claims);

            logger.info("当前鲸加单点登陆用户信息是:{}", JSON.toJSONString(whaleTokenUser));

            return whaleTokenUser;

        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BadCredentialsException(I18nUtil.get("iwhaleauthprovider.login.fail"));
        }
    }

    /**
     * 用户信息
     *
     * @param claims 请求
     * @return WhaleTokenUser
     */
    private WhaleTokenUser buildWhaleTokenUser(Map<String, Claim> claims) {
        WhaleTokenUser whaleTokenUser = new WhaleTokenUser();
        whaleTokenUser.setId(this.getLong(claims.get("id")));
        whaleTokenUser.setUserCode(this.getString(claims.get("code")));
        whaleTokenUser.setName(this.getString(claims.get("name")));
        whaleTokenUser.setBelong(this.getString(claims.get("belong")));
        whaleTokenUser.setMail(this.getString(claims.get("mail")));
        whaleTokenUser.setIss(this.getString(claims.get("iss")));
        whaleTokenUser.setStation(this.getString(claims.get("station")));
        whaleTokenUser.setJob(this.getString(claims.get("jog")));
        whaleTokenUser.setDept(this.getString(claims.get("dept")));
        whaleTokenUser.setUserImg(this.getString(claims.get("userImg")));
        whaleTokenUser.setRefreshToken(this.getString(claims.get("refreshToken")));
        return whaleTokenUser;
    }

    /**
     * 获取整数
     *
     * @param claim 类型
     * @return Long
     */
    private Long getLong(Claim claim) {
        return claim != null ? claim.asLong() : null;
    }

    /**
     * 获取字符串
     *
     * @param claim
     * @return String
     */
    private String getString(Claim claim) {
        return claim != null ? claim.asString() : null;
    }

    /**
     * 类型的支持
     * 
     * @param authentication 认证信息
     * @return supports
     */
    @Override
    public boolean supports(Class<?> authentication) {
        return authentication.isAssignableFrom(IwhaleAuthentication.class);
    }
}
