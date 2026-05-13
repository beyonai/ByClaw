package com.iwhalecloud.byai.manager.security.config;

import com.iwhalecloud.byai.manager.security.exception.GlobalSecurityExceptionHandler;
import com.iwhalecloud.byai.manager.security.exception.MultAccessDeniedExceptionHandler;
import com.iwhalecloud.byai.manager.security.exception.MultAuthenticationEntryPoint;
import com.iwhalecloud.byai.manager.security.handle.MultAuthenticationFailureHandler;
import com.iwhalecloud.byai.manager.security.handle.MultAuthenticationSuccessHandler;
import com.iwhalecloud.byai.manager.security.login.apple.AppleAuthenticationFilter;
import com.iwhalecloud.byai.manager.security.login.apple.AppleAuthenticationProvider;
import com.iwhalecloud.byai.manager.security.login.cas.CasAuthenticationFilter;
import com.iwhalecloud.byai.manager.security.login.cas.CasAuthenticationProvider;
import com.iwhalecloud.byai.manager.security.login.dingtalk.DingtalkAuthenticationFilter;
import com.iwhalecloud.byai.manager.security.login.dingtalk.DingtalkAuthenticationProvider;
import com.iwhalecloud.byai.manager.security.login.feilian.FeiLianAuthenticationFilter;
import com.iwhalecloud.byai.manager.security.login.feilian.FeiLianAuthenticationProvider;
import com.iwhalecloud.byai.manager.security.login.iwhale.IwhaleAuthenticationFilter;
import com.iwhalecloud.byai.manager.security.login.iwhale.IwhaleAuthenticationProvider;
import com.iwhalecloud.byai.manager.security.login.phone.PhoneAuthenticationFilter;
import com.iwhalecloud.byai.manager.security.login.phone.PhoneAuthenticationProvider;
import com.iwhalecloud.byai.manager.security.login.phone.PhoneRegisterAuthenticationFilter;
import com.iwhalecloud.byai.manager.security.login.phone.PhoneRegisterAuthenticationProvider;
import com.iwhalecloud.byai.manager.security.login.sso.SSOAuthenticationFilter;
import com.iwhalecloud.byai.manager.security.login.sso.SSOAuthenticationProvider;
import com.iwhalecloud.byai.manager.security.login.username.UsernameAuthenticationFilter;
import com.iwhalecloud.byai.manager.security.login.username.UsernameAuthenticationProvider;
import com.iwhalecloud.byai.state.common.filter.GlobalI18nFilter;
import com.iwhalecloud.byai.state.common.filter.SignAntiReplayFilter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.savedrequest.NullRequestCache;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description spring-security安全认证配置
 */

@Configuration
@EnableWebSecurity
public class WebSecurityConfig {

    @Autowired
    private SignAntiReplayFilter signAntiReplayFilter;

    @Autowired
    private GlobalI18nFilter globalI18nFilter;

    @Autowired
    private MultAuthenticationSuccessHandler multAuthenticationSuccessHandler;

    @Autowired
    private MultAuthenticationFailureHandler multAuthenticationFailureHandler;

    @Autowired
    private MultAuthenticationEntryPoint MultAuthenticationEntryPoint;

    @Autowired
    private MultAccessDeniedExceptionHandler multAccessDeniedExceptionHandler;

    @Autowired
    private GlobalSecurityExceptionHandler globalSecurityExceptionHandler;

    @Autowired
    private UsernameAuthenticationProvider usernameAuthenticationProvider;

    @Autowired
    private PhoneAuthenticationProvider phoneAuthenticationProvider;

    @Autowired
    private PhoneRegisterAuthenticationProvider phoneRegisterAuthenticationProvider;

    @Autowired
    private IwhaleAuthenticationProvider iwhaleAuthenticationProvider;

    @Autowired
    private DingtalkAuthenticationProvider dingtalkAuthenticationProvider;

    @Autowired
    private SSOAuthenticationProvider ssoAuthenticationProvider;

    @Autowired
    private FeiLianAuthenticationProvider feiLianAuthenticationProvider;

    @Autowired
    private CasAuthenticationProvider casAuthenticationProvider;

    @Autowired
    private AppleAuthenticationProvider appleAuthenticationProvider;

    /**
     * 密码加密使用的编码器
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /**
     * 登陆拦截链
     *
     * @param http http请求
     * @return SecurityFilterChain
     */
    @Bean
    public SecurityFilterChain loginFilterChain(HttpSecurity http) {
        try {
            // 一些公共拦截配置
            this.commonHttpSetting(http);

            // 使用securityMatcher限定当前配置作用的路径,其他所有请求拦截
            http.securityMatcher("/system/session/loginByUsername", "/system/session/loginByPhone",
                "/system/session/registerByPhone", "/system/social/iwhaleCallback", "/system/social/dingtalkCallback",
                "/system/session/loginBySso", "/system/social/feiLianCallback", "/system/social/casCallback", "/system/social/appleLogin")
                .authorizeHttpRequests(authorize -> authorize.anyRequest().permitAll());

            PathPatternRequestMatcher.Builder pathPattern = PathPatternRequestMatcher.withDefaults();

            // 用户名密码登陆
            UsernameAuthenticationFilter usernameLoginFilter = new UsernameAuthenticationFilter(
                pathPattern.matcher(HttpMethod.POST, "/system/session/loginByUsername"),
                new ProviderManager(List.of(usernameAuthenticationProvider)), multAuthenticationSuccessHandler,
                multAuthenticationFailureHandler);

            // 手机号+验证码登录
            PhoneAuthenticationFilter phoneAuthenticationFilter = new PhoneAuthenticationFilter(
                pathPattern.matcher(HttpMethod.POST, "/system/session/loginByPhone"),
                new ProviderManager(List.of(phoneAuthenticationProvider)), multAuthenticationSuccessHandler,
                multAuthenticationFailureHandler);

            PhoneRegisterAuthenticationFilter phoneRegisterAuthenticationFilter = new PhoneRegisterAuthenticationFilter(
                pathPattern.matcher(HttpMethod.POST, "/system/session/registerByPhone"),
                new ProviderManager(List.of(phoneRegisterAuthenticationProvider)), multAuthenticationSuccessHandler,
                multAuthenticationFailureHandler);

            // 鲸加登陆
            IwhaleAuthenticationFilter iwhaleAuthenticationFilter = new IwhaleAuthenticationFilter(
                pathPattern.matcher(HttpMethod.GET, "/system/social/iwhaleCallback"),
                new ProviderManager(List.of(iwhaleAuthenticationProvider)), multAuthenticationSuccessHandler,
                multAuthenticationFailureHandler);

            // 钉钉登陆
            DingtalkAuthenticationFilter dingtalkAuthenticationFilter = new DingtalkAuthenticationFilter(
                pathPattern.matcher(HttpMethod.GET, "/system/social/dingtalkCallback"),
                new ProviderManager(List.of(dingtalkAuthenticationProvider)), multAuthenticationSuccessHandler,
                multAuthenticationFailureHandler);

            // 单点登陆
            SSOAuthenticationFilter ssoAuthenticationFilter = new SSOAuthenticationFilter(
                pathPattern.matcher(HttpMethod.GET, "/system/session/loginBySso"),
                new ProviderManager(List.of(ssoAuthenticationProvider)), multAuthenticationSuccessHandler,
                multAuthenticationFailureHandler);

            // 飞连oauth2
            FeiLianAuthenticationFilter feiLianAuthenticationFilter = new FeiLianAuthenticationFilter(
                pathPattern.matcher(HttpMethod.GET, "/system/social/feiLianCallback"),
                new ProviderManager(List.of(feiLianAuthenticationProvider)), multAuthenticationSuccessHandler,
                multAuthenticationFailureHandler);

            // CAS登陆
            CasAuthenticationFilter casAuthenticationFilter = new CasAuthenticationFilter(
                pathPattern.matcher(HttpMethod.GET, "/system/social/casCallback"),
                new ProviderManager(List.of(casAuthenticationProvider)), multAuthenticationSuccessHandler,
                multAuthenticationFailureHandler);

            // 苹果登录
            AppleAuthenticationFilter appleAuthenticationFilter = new AppleAuthenticationFilter(
                pathPattern.matcher(HttpMethod.POST, "/system/social/appleLogin"),
                new ProviderManager(List.of(appleAuthenticationProvider)), multAuthenticationSuccessHandler,
                multAuthenticationFailureHandler);

            // 全局国际化Filter，必须加在最前面
            http.addFilterBefore(globalI18nFilter, UsernamePasswordAuthenticationFilter.class);

            // 用户名+密码登陆
            http.addFilterBefore(usernameLoginFilter, UsernamePasswordAuthenticationFilter.class);

            // 手机注册
            http.addFilterBefore(phoneRegisterAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

            // 手机验证码
            http.addFilterBefore(phoneAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

            // 鲸加登陆
            http.addFilterBefore(iwhaleAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

            // 钉钉登陆
            http.addFilterBefore(dingtalkAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

            // ssoToken登陆
            http.addFilterBefore(ssoAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

            // 飞连
            http.addFilterBefore(feiLianAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

            // CAS
            http.addFilterBefore(casAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

            // 苹果登录
            http.addFilterBefore(appleAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

            return http.build();
        } catch (Exception e) {
            throw new IllegalStateException("登录过滤链配置失败", e);
        }
    }

    /**
     * OAuth2授权服务器拦截链 部分端点需要认证，部分端点开放访问
     *
     * @param http http请求
     * @return SecurityFilterChain
     */
    @Bean
    public SecurityFilterChain oauth2FilterChain(HttpSecurity http) {
        try {
            // 一些公共拦截配置
            this.commonHttpSetting(http);

            // OAuth2端点的精细化访问控制
            http.securityMatcher("/oauth2/**").authorizeHttpRequests(authorize -> {
                // 所有OAuth2端点暂时都允许访问（不获取用户信息）
                authorize.anyRequest().permitAll();
            });

            return http.build();
        } catch (Exception e) {
            throw new IllegalStateException("OAuth2过滤链配置失败", e);
        }
    }

    /**
     * 禁用不必要的默认filter，处理异常响应内容
     *
     * @param http 请求
     */
    private void commonHttpSetting(HttpSecurity http) {
        try {
            // 表单登录/登出、session管理、csrf防护等默认配置，如果不disable。会默认创建默认filter
            http.formLogin(AbstractHttpConfigurer::disable).httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable).sessionManagement(AbstractHttpConfigurer::disable)
                .csrf(AbstractHttpConfigurer::disable)
                // requestCache用于重定向，前后端分析项目无需重定向，requestCache也用不上
                .requestCache(cache -> cache.requestCache(new NullRequestCache()))
                // 无需给用户一个匿名身份
                .anonymous(AbstractHttpConfigurer::disable);

            // 处理 SpringSecurity 异常响应结果
            http.exceptionHandling(exceptionHandling -> {
                exceptionHandling
                    // 认证失败异常
                    .authenticationEntryPoint(MultAuthenticationEntryPoint)
                    // 鉴权失败异常
                    .accessDeniedHandler(multAccessDeniedExceptionHandler);
            });

            // 其他未知异常. 尽量提前加载。
            http.addFilterBefore(globalSecurityExceptionHandler, SecurityContextHolderFilter.class);
        } catch (Exception e) {
            throw new IllegalStateException("安全公共配置失败", e);
        }
    }

}
