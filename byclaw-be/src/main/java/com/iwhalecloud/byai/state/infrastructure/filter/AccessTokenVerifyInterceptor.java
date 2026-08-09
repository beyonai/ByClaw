package com.iwhalecloud.byai.state.infrastructure.filter;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.AccessTokenFilter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.JwtTokenFilter;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.SessionFilter;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.SsoTokenFilter;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.URLFilter;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;

/**
 * 组件统一认证过滤器 内部feign请求不拦截 所有的外部请求，需要进行SESSION统一认证
 */
@Component
public class AccessTokenVerifyInterceptor implements HandlerInterceptor {

    private static final Logger logger = LoggerFactory.getLogger(AccessTokenVerifyInterceptor.class);

    private static final String FEISHU_BOT_EVENT_CALLBACK_PATH = "/feishu/bot/events";

    private static final String THIRD_PARTY_SKILL_INSTALL_PATH = "/tool/installThirdPartySkill";

    private static final String CONNECTOR_SKILL_COMPLETE_PATH =
        "/connector/authorization/skill-complete";

    @Value("${byai.access.urlpatterns:}")
    private String urlPattenrs;

    @Value("${byai.access.urlpatterns.logRequest:false}")
    private String logRequest;

    private final List<Pattern> matcherList = new ArrayList<>(10);

    @Autowired
    private URLFilter urlFilter;

    @Autowired
    private SessionFilter sessionFilter;

    @Autowired
    private JwtTokenFilter jwtTokenFilter;

    @Autowired
    private SsoTokenFilter ssoTokenFilter;

    @Autowired
    private AccessTokenFilter accessTokenFilter;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @PostConstruct
    public void init() {
        try {

            // Add Swagger URLs to ignore list
            matcherList.add(Pattern.compile("/swagger-ui.html"));
            matcherList.add(Pattern.compile("/swagger-ui/")); // To cover all swagger-ui resources
            matcherList.add(Pattern.compile("/v3/api-docs/")); // OpenAPI 3 paths
            matcherList.add(Pattern.compile("/swagger-resources/")); // Additional swagger resources
            matcherList.add(Pattern.compile("/webjars/")); // Swagger UI web jars
            matcherList.add(Pattern.compile("/openapi.json")); // Swagger UI web jars
            matcherList.add(Pattern.compile("/api-docs/")); // Swagger UI web jars
            matcherList.add(Pattern.compile("/api-docs")); // Swagger UI web jars
            matcherList.add(Pattern.compile("/api/v1/appVersion/latest")); // Swagger UI web jars
            matcherList.add(Pattern.compile("/actuator/health"));
            matcherList.add(Pattern.compile("/actuator/info"));
            matcherList.add(Pattern.compile("/actuator/metrics"));
            matcherList.add(Pattern.compile("/actuator/prometheus")); //
            matcherList.add(Pattern.compile("/api/v1/template-sessions/page")); // 模板分页开放
            matcherList.add(Pattern.compile("/api/v1/template-sessions/getTemplateTypes")); // 模板开放
            matcherList.add(Pattern.compile("/ws")); // ws 接口
            matcherList.add(Pattern.compile("/system/session/getDcSystemConfigValueByCodes")); // 登录页系统配置（免登录）
            matcherList.add(Pattern.compile("/system/staticdata/getDcSystemConfig")); // 登录页品牌配置（免登录）
            matcherList.add(Pattern.compile("/open/api/inner/.*"));
            matcherList.add(Pattern.compile("/open/api/v1/queryDigEmployeeList")); // 数字员工列表查询（免登录）
            matcherList.add(Pattern.compile("/open/api/v1/queryDigEmployeeDetail")); // 数字员工详情查询（免登录）
            matcherList.add(Pattern.compile("/open/api/v1/queryDigEmployeeSkills")); // 数字员工技能查询（免登录）
            matcherList.add(Pattern.compile("/open/api/v1/conversation/writeTxt")); // 会话文件覆盖写（免登录）
            matcherList.add(Pattern.compile("/open/api/v1/conversation/appendTxt")); // 会话文件追加写（免登录）
            matcherList.add(Pattern.compile("/open/api/v1/conversation/read")); // 会话文件按行读取（免登录）
            matcherList.add(Pattern.compile("/chat/message/share-link/access")); // 消息分享链接
            matcherList.add(Pattern.compile("/open/api/getAllUserInfoByUserCode")); // 获取用户信息
            matcherList.add(Pattern.compile("/commonFile/view")); // 文件查看（controller自行处理登录重定向）
            matcherList.add(Pattern.compile("/feishu/bot/events")); // 飞书事件回调：开放平台匿名推送，Controller 内部校验 token
            matcherList.add(Pattern.compile("/openclaw-ui")); // openclaw 控制台整页代理（用 openclaw 自带 token 鉴权，非系统登录态）

            String[] patternList = StringUtils.isNotEmpty(urlPattenrs) ? urlPattenrs.split(",") : new String[0];
            for (String regex : patternList) {
                Pattern pattern = Pattern.compile(regex);
                matcherList.add(pattern);
            }
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }

    }

    /**
     * 如果session已经存在，需要进行session的用户信息和token信息的比对 如果session里面，不存在用户信息的，需要添加用户信息 如果session 里面，存在的用户信息和token里面的一致，直接返回成功
     * 如果session 里面，存在的用户信息和token信息不一致，需要进行更新
     *
     * @param request 请求
     * @param response 响应
     * @param handler 处理
     * @return 返回
     */
    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        try {
            if (response.isCommitted()) {
                logger.warn("Response already committed, skip session check.");
                return false;
            }

            // Check if the requested URL matches any of the ignore patterns
            if (response.isCommitted()) {
                logger.warn("Response already committed, skip session check.");
                return false;
            }

            // 例外的地址
            String url = request.getRequestURL().toString();
            // 飞书开放平台回调从外部匿名推送，不会携带系统登录态。
            // 这里使用 servlet 原始路径做后缀判断，兼容 /byaiService 等 context-path/代理前缀。
            if (this.isFeishuBotEventCallback(request)) {
                return true;
            }
            if (this.isThirdPartySkillInstallRequest(request)) {
                if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
                    return true;
                }
                return this.authenticateBeyondTokenOnlyRequest(request, "第三方技能安装");
            }
            if (this.isConnectorSkillCompleteRequest(request)) {
                if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
                    return true;
                }
                return this.authenticateBeyondTokenOnlyRequest(request, "连接器技能授权同步");
            }
            if (this.checkUrlByRegex(url)) {
                return true;
            }

            if (url.contains("/session/chat/callback")) {
                return urlFilter.doFilter(request);
            }

            // 优先走session共享
            HttpSession httpSession = request.getSession(false);
            String userCode = this.getSessionString(httpSession, "USER_CODE");
            if (StringUtils.isNotEmpty(userCode)) {
                return sessionFilter.doFilter(httpSession);
            }

            // token认证
            String systemCode = request.getHeader("system-code");
            String beyondToken = request.getHeader("beyond-token");
            if (StringUtils.isNotEmpty(beyondToken)) {
                boolean res = jwtTokenFilter.doFilter(systemCode, beyondToken);
                LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
                if (res && httpSession != null && loginInfo != null) {
                    // 防御性措施，上面userCode为空则证明已经是session已经被清空，这里需要补全
                    loginApplicationService.shareSession(httpSession, loginInfo);
                }
                return res;
            }

            // 单点登陆token
            String ssoToken = request.getHeader("SSO-TOKEN");
            if (StringUtils.isNotEmpty(ssoToken)) {
                return ssoTokenFilter.doFilter(ssoToken);
            }

            // 令牌认证
            String accessToken = request.getHeader("accessToken");
            if (StringUtil.isNotEmpty(accessToken)) {
                return accessTokenFilter.doFilter(accessToken);
            }

            if ("true".equalsIgnoreCase(logRequest)) {
                logRequestInfo(request, url);
            }
            throw new RuntimeException(I18nUtil.get("access.token.verify.signature.null", url));
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            this.setLoginError(response, e.getMessage());
            return false;
        }
    }

    /**
     * 技能超市安装必须以调用方显式传入的 Beyond-Token 作为当前用户身份。
     * 即使请求同时携带门户 Cookie，也不能使用 Cookie/Session 覆盖 Token 中的用户。
     */
    private boolean authenticateBeyondTokenOnlyRequest(HttpServletRequest request, String operationName) {
        String systemCode = request.getHeader("system-code");
        String beyondToken = request.getHeader("Beyond-Token");
        if (StringUtils.isBlank(beyondToken)) {
            throw new RuntimeException(operationName + "接口必须通过 Beyond-Token 鉴权");
        }
        logger.info(
            "{}接口强制Beyond-Token鉴权，requestUri={}, systemCode={}",
            operationName, request.getRequestURI(), systemCode);
        boolean authenticated = jwtTokenFilter.doFilter(systemCode, beyondToken);
        if (!authenticated) {
            return false;
        }

        LoginInfo tokenLoginInfo = CurrentUserHolder.getLoginInfo();
        if (tokenLoginInfo == null || StringUtils.isBlank(tokenLoginInfo.getUserCode())) {
            throw new RuntimeException("Beyond-Token中缺少用户编码");
        }
        Long tokenUserId = tokenLoginInfo.getUserId();
        String tokenUserCode = tokenLoginInfo.getUserCode();

        // Beyond-Token 只负责确认调用用户身份；资源权限统一使用门户本地用户主键、角色和组织关系。
        // 这里按 Token 中的 userCode 重新加载完整 LoginInfo，不依赖对端 system-code，也不回退到 Cookie/Session。
        LoginInfo localLoginInfo = loginApplicationService.getLoginInfo(tokenUserCode);
        if (localLoginInfo == null || localLoginInfo.getUserId() == null) {
            throw new RuntimeException("Beyond-Token对应的门户用户不存在");
        }
        CurrentUserHolder.setLoginInfo(localLoginInfo);
        logger.info(
            "{}用户身份归一化完成，tokenUserId={}, tokenUserCode={}, localUserId={}, "
                + "localUserCode={}, userName={}",
            operationName, tokenUserId, tokenUserCode, localLoginInfo.getUserId(), localLoginInfo.getUserCode(),
            localLoginInfo.getUserName());
        return true;
    }

    private boolean isThirdPartySkillInstallRequest(HttpServletRequest request) {
        String requestUri = request == null ? null : request.getRequestURI();
        return StringUtils.endsWith(requestUri, THIRD_PARTY_SKILL_INSTALL_PATH)
            || StringUtils.endsWith(requestUri, THIRD_PARTY_SKILL_INSTALL_PATH + "/");
    }

    private boolean isConnectorSkillCompleteRequest(HttpServletRequest request) {
        String requestUri = request == null ? null : request.getRequestURI();
        return StringUtils.endsWith(requestUri, CONNECTOR_SKILL_COMPLETE_PATH)
            || StringUtils.endsWith(requestUri, CONNECTOR_SKILL_COMPLETE_PATH + "/");
    }

    /**
     * 从session中获取属性
     *
     * @param httpSession 会话信息
     * @param attributeName 属性名称
     * @return String
     */
    private String getSessionString(HttpSession httpSession, String attributeName) {
        if (httpSession == null) {
            return null;
        }
        Object attributeValue = httpSession.getAttribute(attributeName);
        return attributeValue != null ? attributeValue.toString() : null;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception e) {
    }

    /**
     * 错误封装处理
     *
     * @param response 响应
     * @param errMsg 错误信息
     */
    private void setLoginError(HttpServletResponse response, String errMsg) {
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setCharacterEncoding("utf-8");
        response.setContentType(MediaType.APPLICATION_JSON_VALUE + ";charset=UTF-8");
        Map<String, Object> resultObject = new HashMap<String, Object>();
        resultObject.put("resultCode", HttpStatus.UNAUTHORIZED.value());
        resultObject.put("resultMsg", errMsg);
        resultObject.put("type", 1);
        String jsonString = JSONObject.toJSONString(resultObject);
        try {
            response.getWriter().write(jsonString);
        }
        catch (IOException e) {
            logger.error(e.getMessage(), e);
        }
    }

    /**
     * 飞书事件回调必须允许匿名访问，鉴权由 {@code FeishuBotEventController} 内部基于
     * verificationToken / encryptKey 完成。这里同时检查 requestURI、servletPath 和 pathInfo，
     * 避免本地、ngrok、网关 context-path（如 /byaiService）不一致时误入系统登录鉴权。
     *
     * @param request HTTP 请求
     * @return 是否为飞书机器人事件回调
     */
    private boolean isFeishuBotEventCallback(HttpServletRequest request) {
        return endsWithFeishuBotEventPath(request.getRequestURI())
            || endsWithFeishuBotEventPath(request.getServletPath())
            || endsWithFeishuBotEventPath(request.getPathInfo());
    }

    private boolean endsWithFeishuBotEventPath(String path) {
        if (StringUtils.isBlank(path)) {
            return false;
        }
        String normalizedPath = path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
        return normalizedPath.endsWith(FEISHU_BOT_EVENT_CALLBACK_PATH);
    }

    /**
     * 根据正则匹配URL是否允许访问
     *
     * @param url 请求地址
     * @return boolean
     */
    public boolean checkUrlByRegex(String url) {
        for (Pattern pattern : matcherList) {
            Matcher matcher = pattern.matcher(url);
            if (matcher.find()) {
                return true;
            }
        }
        return false;
    }

    /**
     * 记录完整的请求信息到日志 包括多层代理的真实IP地址、请求头、用户信息等
     *
     * @param request HTTP请求对象
     * @param url 请求URL
     */
    private void logRequestInfo(HttpServletRequest request, String url) {
        try {
            StringBuilder logInfo = new StringBuilder();
            logInfo.append("\n========== 请求认证失败 - 完整请求信息 ==========\n");

            // 1. 基本信息
            logInfo.append("【请求基本信息】\n");
            logInfo.append("  请求URL: ").append(url).append("\n");
            logInfo.append("  请求URI: ").append(request.getRequestURI()).append("\n");
            logInfo.append("  请求方法: ").append(request.getMethod()).append("\n");
            logInfo.append("  查询参数: ").append(request.getQueryString() != null ? request.getQueryString() : "无")
                .append("\n");
            logInfo.append("  协议: ").append(request.getProtocol()).append("\n");
            logInfo.append("  服务器名称: ").append(request.getServerName()).append("\n");
            logInfo.append("  服务器端口: ").append(request.getServerPort()).append("\n");
            logInfo.append("  上下文路径: ").append(request.getContextPath()).append("\n");
            logInfo.append("  Servlet路径: ").append(request.getServletPath()).append("\n");

            // 2. 真实IP地址（处理多层代理）
            logInfo.append("\n【客户端IP信息（多层代理）】\n");
            String realIp = this.getRealIpAddress(request);
            logInfo.append("  真实客户端IP: ").append(realIp).append("\n");
            logInfo.append("  直接连接IP: ").append(request.getRemoteAddr()).append("\n");
            logInfo.append("  直接连接主机: ").append(request.getRemoteHost()).append("\n");
            logInfo.append("  直接连接端口: ").append(request.getRemotePort()).append("\n");

            // 3. 代理相关请求头
            logInfo.append("\n【代理相关请求头】\n");
            String forwardedFor = request.getHeader("X-Forwarded-For");
            String realIpHeader = request.getHeader("X-Real-IP");
            String forwardedProto = request.getHeader("X-Forwarded-Proto");
            String forwardedHost = request.getHeader("X-Forwarded-Host");
            String forwardedPort = request.getHeader("X-Forwarded-Port");
            String clientIp = request.getHeader("Client-IP");
            String proxyClientIp = request.getHeader("Proxy-Client-IP");
            String wlProxyClientIp = request.getHeader("WL-Proxy-Client-IP");

            logInfo.append("  X-Forwarded-For: ").append(forwardedFor != null ? forwardedFor : "无").append("\n");
            logInfo.append("  X-Real-IP: ").append(realIpHeader != null ? realIpHeader : "无").append("\n");
            logInfo.append("  X-Forwarded-Proto: ").append(forwardedProto != null ? forwardedProto : "无").append("\n");
            logInfo.append("  X-Forwarded-Host: ").append(forwardedHost != null ? forwardedHost : "无").append("\n");
            logInfo.append("  X-Forwarded-Port: ").append(forwardedPort != null ? forwardedPort : "无").append("\n");
            logInfo.append("  Client-IP: ").append(clientIp != null ? clientIp : "无").append("\n");
            logInfo.append("  Proxy-Client-IP: ").append(proxyClientIp != null ? proxyClientIp : "无").append("\n");
            logInfo.append("  WL-Proxy-Client-IP: ").append(wlProxyClientIp != null ? wlProxyClientIp : "无")
                .append("\n");

            // 4. 所有请求头信息
            logInfo.append("\n【所有请求头信息】\n");
            java.util.Enumeration<String> headerNames = request.getHeaderNames();
            if (headerNames != null) {
                while (headerNames.hasMoreElements()) {
                    String headerName = headerNames.nextElement();
                    java.util.Enumeration<String> headerValues = request.getHeaders(headerName);
                    StringBuilder headerValueStr = new StringBuilder();
                    while (headerValues.hasMoreElements()) {
                        if (headerValueStr.length() > 0) {
                            headerValueStr.append(", ");
                        }
                        headerValueStr.append(headerValues.nextElement());
                    }
                    logInfo.append("  ").append(headerName).append(": ").append(headerValueStr.toString()).append("\n");
                }
            }
            else {
                logInfo.append("  无请求头信息\n");
            }

            // 5. Session信息
            logInfo.append("\n【Session信息】\n");
            try {
                HttpSession session = request.getSession(false);
                if (session != null) {
                    logInfo.append("  Session ID: ").append(session.getId()).append("\n");
                    logInfo.append("  创建时间: ").append(new java.util.Date(session.getCreationTime())).append("\n");
                    logInfo.append("  最后访问时间: ").append(new java.util.Date(session.getLastAccessedTime())).append("\n");
                    logInfo.append("  最大空闲时间: ").append(session.getMaxInactiveInterval()).append("秒\n");

                    // Session中的所有属性
                    java.util.Enumeration<String> attributeNames = session.getAttributeNames();
                    if (attributeNames != null && attributeNames.hasMoreElements()) {
                        logInfo.append("  Session属性:\n");
                        while (attributeNames.hasMoreElements()) {
                            String attrName = attributeNames.nextElement();
                            Object attrValue = session.getAttribute(attrName);
                            // 敏感信息脱敏处理
                            String attrValueStr = this.maskSensitiveInfo(attrName, attrValue);
                            logInfo.append("    ").append(attrName).append(": ").append(attrValueStr).append("\n");
                        }
                    }
                    else {
                        logInfo.append("  Session属性: 无\n");
                    }
                }
                else {
                    logInfo.append("  无Session信息\n");
                }
            }
            catch (Exception e) {
                logInfo.append("  获取Session信息失败: ").append(e.getMessage()).append("\n");
            }

            // 6. 用户认证相关信息
            logInfo.append("\n【认证相关信息】\n");
            logInfo.append("  system-code: ")
                .append(request.getHeader("system-code") != null ? request.getHeader("system-code") : "无").append("\n");
            logInfo.append("  beyond-token: ").append(request.getHeader("beyond-token") != null ? "已提供（已脱敏）" : "无")
                .append("\n");
            logInfo.append("  SSO-TOKEN: ").append(request.getHeader("SSO-TOKEN") != null ? "已提供（已脱敏）" : "无")
                .append("\n");
            logInfo.append("  Authorization: ").append(request.getHeader("Authorization") != null ? "已提供（已脱敏）" : "无")
                .append("\n");

            // 7. 请求参数（POST参数）
            logInfo.append("\n【请求参数】\n");
            java.util.Map<String, String[]> parameterMap = request.getParameterMap();
            if (parameterMap != null && !parameterMap.isEmpty()) {
                for (java.util.Map.Entry<String, String[]> entry : parameterMap.entrySet()) {
                    String paramName = entry.getKey();
                    String[] paramValues = entry.getValue();
                    StringBuilder paramValueStr = new StringBuilder();
                    for (String paramValue : paramValues) {
                        if (paramValueStr.length() > 0) {
                            paramValueStr.append(", ");
                        }
                        // 敏感参数脱敏
                        paramValueStr.append(this.maskSensitiveInfo(paramName, paramValue));
                    }
                    logInfo.append("  ").append(paramName).append(": ").append(paramValueStr.toString()).append("\n");
                }
            }
            else {
                logInfo.append("  无请求参数\n");
            }

            logInfo.append("==========================================\n");

            logger.error(logInfo.toString());
        }
        catch (Exception e) {
            logger.error("记录请求信息时发生异常: " + e.getMessage(), e);
        }
    }

    /**
     * 获取真实客户端IP地址 处理多层代理的情况，按优先级获取：X-Forwarded-For -> X-Real-IP -> Proxy-Client-IP -> WL-Proxy-Client-IP -> Client-IP
     * -> RemoteAddr
     *
     * @param request HTTP请求对象
     * @return 真实客户端IP地址
     */
    private String getRealIpAddress(HttpServletRequest request) {
        String ip = null;

        // 1. 优先检查 X-Forwarded-For（可能包含多个IP，取第一个）
        String forwardedFor = request.getHeader("X-Forwarded-For");
        if (StringUtils.isNotEmpty(forwardedFor) && !"unknown".equalsIgnoreCase(forwardedFor)) {
            // X-Forwarded-For可能包含多个IP，格式：client, proxy1, proxy2
            int index = forwardedFor.indexOf(",");
            if (index != -1) {
                ip = forwardedFor.substring(0, index).trim();
            }
            else {
                ip = forwardedFor.trim();
            }
        }

        // 2. 检查 X-Real-IP
        if (StringUtils.isEmpty(ip) || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("X-Real-IP");
        }

        // 3. 检查 Proxy-Client-IP
        if (StringUtils.isEmpty(ip) || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("Proxy-Client-IP");
        }

        // 4. 检查 WL-Proxy-Client-IP
        if (StringUtils.isEmpty(ip) || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("WL-Proxy-Client-IP");
        }

        // 5. 检查 Client-IP
        if (StringUtils.isEmpty(ip) || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("Client-IP");
        }

        // 6. 最后使用直接连接的IP
        if (StringUtils.isEmpty(ip) || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }

        // 清理IP地址（移除端口号等）
        if (StringUtils.isNotEmpty(ip)) {
            // 处理IPv6地址
            if (ip.startsWith("[") && ip.contains("]")) {
                int endIndex = ip.indexOf("]");
                ip = ip.substring(1, endIndex);
            }
            // 处理带端口的IPv4地址
            if (ip.contains(":") && !ip.contains("::")) {
                int colonIndex = ip.lastIndexOf(":");
                // 检查是否是端口号（端口号通常是数字）
                String afterColon = ip.substring(colonIndex + 1);
                if (afterColon.matches("\\d+")) {
                    ip = ip.substring(0, colonIndex);
                }
            }
        }

        return StringUtils.isNotEmpty(ip) ? ip : "unknown";
    }

    /**
     * 敏感信息脱敏处理 对密码、token等敏感信息进行脱敏，避免在日志中明文输出
     *
     * @param key 属性名或参数名
     * @param value 属性值或参数值
     * @return 脱敏后的字符串
     */
    private String maskSensitiveInfo(String key, Object value) {
        if (value == null) {
            return "null";
        }

        String valueStr = value.toString();
        String keyLower = key.toLowerCase();

        // 判断是否为敏感字段
        boolean isSensitive = keyLower.contains("password") || keyLower.contains("pwd") || keyLower.contains("token")
            || keyLower.contains("secret") || keyLower.contains("key") || keyLower.contains("auth")
            || keyLower.contains("credential");

        if (isSensitive && StringUtils.isNotEmpty(valueStr)) {
            // 脱敏处理：保留前3位和后3位，中间用*替代
            int length = valueStr.length();
            if (length <= 6) {
                return "******";
            }
            else {
                return valueStr.substring(0, 3) + "******" + valueStr.substring(length - 3);
            }
        }

        return valueStr;
    }

}
