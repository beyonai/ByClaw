package com.iwhalecloud.byai.state.common.filter;


import java.io.IOException;
import java.util.List;

import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;
import com.iwhalecloud.byai.common.ecrypt.MD5Util;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.util.CollectionUtils;
import org.springframework.web.filter.OncePerRequestFilter;
import com.iwhalecloud.byai.common.config.SignAntiReplayConfig;
import com.iwhalecloud.byai.state.common.filter.request.RequestWrapper;
import com.iwhalecloud.byai.common.util.RedisUtil;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;


/**
 * 安全校验开关过滤器 ，需要进行SESSION统一认证
 */
@Component
public class SignAntiReplayFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(SignAntiReplayFilter.class);

    private static final String KEY_SEPERATOR = ":";


    public static final String HEADER_SIGNATURE = "x-signature-value";

    public static final String HEADER_NONCE = "x-signature-nonce";

    public static final String HEADER_TIMESTAMP = "x-signature-timestamp";

    @Autowired
    SignAntiReplayConfig signProperties;


    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
        throws ServletException, IOException {
        log.debug("SignAntiReplayFilter start");
        // 未开启，直接放行
        if (!signProperties.getEnabled()) {
            log.debug("SignAntiReplayFilter disable");
            filterChain.doFilter(request, response);
            return;
        }
        // 例外的地址，免登录的个别地址也得配置在这里一起噢。不然可能获取不到用户code
        String servletPath = request.getServletPath();
        if (this.matches(servletPath, signProperties.getExcludeUrlList())) {
            filterChain.doFilter(request, response);
            return;
        }
        String signature = request.getHeader(HEADER_SIGNATURE);
        String nonce = request.getHeader(HEADER_NONCE);
        String timestamp = request.getHeader(HEADER_TIMESTAMP);

        if (StringUtils.isEmpty(signature) || StringUtils.isEmpty(nonce) || StringUtils.isEmpty(timestamp)) {
            log.error("当前请求的url地址是:{}", servletPath);
            throw new BadCredentialsException(I18nUtil.get("sign.anti.replay.filter.headers.cannot.be.empty", HEADER_SIGNATURE, HEADER_NONCE, HEADER_TIMESTAMP));
        }
        log.debug("接收到签名请求： signature={}, nonce={}, timestamp={}", signature, nonce, timestamp);
        //检查时间戳
        this.checkRequestTime(Long.parseLong(timestamp));

        // redis校验重放攻击
        String cacheKey = RedisConfig.SECURITYSIGN_CACHE_PREFIX + nonce + KEY_SEPERATOR + timestamp;
        if (Boolean.FALSE.equals(RedisUtil.setIfAbsent(cacheKey, "value", signProperties.getTimeout()))) {
            throw new BadCredentialsException(I18nUtil.get("sign.anti.replay.filter.prohibit.requesting.replay"));
        }

        //校验body签名  暂时只针对get  post请求
        this.checkSignature(request, signature, nonce, timestamp);
        filterChain.doFilter(request, response);
    }

    /**
     * 检查请求时间戳是否有效
     * 使用时间窗口验证，防止重放攻击和时钟偏移攻击
     *
     * @param timestamp 客户端请求时间戳（毫秒）
     */
    protected void checkRequestTime(long timestamp) {
        long serverTime = System.currentTimeMillis();
        long timeoutMs = signProperties.getTimeout() * 1000L; // 转换为毫秒
        // 使用绝对值比较，验证时间戳是否在允许的时间窗口内
        if (Math.abs(serverTime - timestamp) > timeoutMs) {
            throw new BadCredentialsException(I18nUtil.get("sign.anti.replay.filter.signature.request.timeout"));
        }
    }

    /**
     * 查找指定字符串是否匹配指定字符串列表中的任意一个字符串
     *
     * @param str  指定字符串
     * @param strs 需要检查的字符串数组
     * @return 是否匹配
     */
    public static boolean matches(String str, List<String> strs) {
        if (StringUtils.isEmpty(str) || CollectionUtils.isEmpty(strs)) {
            return false;
        }
        for (String pattern : strs) {
            if (isMatch(pattern, str)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 判断url是否与规则配置:
     * ? 表示单个字符;
     * * 表示一层路径内的任意字符串，不可跨层级;
     * ** 表示任意层路径;
     *
     * @param pattern 匹配规则
     * @param url     需要匹配的url
     * @return
     */
    public static boolean isMatch(String pattern, String url) {
        AntPathMatcher matcher = new AntPathMatcher();
        return matcher.match(pattern, url);
    }

    /**
     * 校验签名，GET用queryString，POST(form-data这个没有)用body，POST需支持多次读取
     *
     * @param request   HttpServletRequest
     * @param signature 前端传递签名
     * @param nonce     随机串
     * @param timestamp 时间戳
     */
    private void checkSignature(HttpServletRequest request, String signature, String nonce, String timestamp) {
        String method = request.getMethod();
        String contentType = request.getContentType();
        String body = "";
        try {
            if ("POST".equalsIgnoreCase(method)) {
                body = extractPostBody(request, contentType);
                if (body == null) {
                    // form-data暂时不操作
                    return;
                }
            } else if ("GET".equalsIgnoreCase(method)) {
                body = extractGetBody(request);
            } else {
                // 其他方法暂不校验
                return;
            }
            String userCode = extractUserCode(request);
            validateSignature(userCode, nonce, timestamp, body, signature);
        } catch (BadCredentialsException e) {
            throw e;
        } catch (Exception e) {
            log.error("签名校验异常", e);
            throw new BadCredentialsException(I18nUtil.get("sign.anti.replay.filter.signature.verification.exception"), e);
        }
    }

    /**
     * 提取POST请求的body内容，仅支持JSON
     */
    private String extractPostBody(HttpServletRequest request, String contentType) throws Exception {
        if (request instanceof RequestWrapper && MediaType.APPLICATION_JSON_VALUE.equalsIgnoreCase(contentType)) {
            RequestWrapper cachedRequest = new RequestWrapper(request);
            return new String(cachedRequest.getInputStream().readAllBytes(), cachedRequest.getCharacterEncoding());
        }
        return null;
    }

    /**
     * 提取GET请求的queryString
     */
    private String extractGetBody(HttpServletRequest request) {
        return request.getQueryString() == null ? "" : request.getQueryString();
    }

    /**
     * 从session中提取userCode
     */
    private String extractUserCode(HttpServletRequest request) {
        HttpSession session = request.getSession();
        String userCode = session.getAttribute("USER_CODE") != null ? String.valueOf(session.getAttribute("USER_CODE")) : "";
        if (StringUtils.isEmpty(userCode)) {
            throw new BadCredentialsException(I18nUtil.get("sign.anti.replay.filter.signature.is.null"));
        }
        return userCode;
    }

    /**
     * 校验签名
     */
    private void validateSignature(String userCode, String nonce, String timestamp, String body, String signature) {
        String serverSign = getSignature(userCode, nonce, Long.parseLong(timestamp), body);
        if (!serverSign.equals(signature)) {
            throw new BadCredentialsException(I18nUtil.get("sign.anti.replay.filter.signature.verification.failed"));
        }
    }

    // 修正签名方法，增加body和salt参数
    protected String getSignature(String userCode, String nonce, long timestamp, String body) {
        String salt = signProperties.getSalt();
        return MD5Util.md5Hex(userCode + nonce + timestamp + (body == null ? "" : body) + salt);
    }


}
