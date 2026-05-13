package com.iwhalecloud.byai.common.feign.interceptor;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.jwt.SsoTokenService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.feign.config.FeignSensitiveConfig;
import com.iwhalecloud.byai.common.feign.util.MaskSensitiveUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.exception.ByAiArgumentException;
import feign.RequestInterceptor;
import feign.RequestTemplate;
import org.springframework.http.HttpHeaders;
import java.util.Collection;
import java.util.Map;

public abstract class AbstractFeignRequestInterceptor implements RequestInterceptor {

    private static final Logger logger = LoggerFactory.getLogger(AbstractFeignRequestInterceptor.class);


    @Autowired
    protected ObjectMapper objectMapper;

    @Autowired
    protected FeignSensitiveConfig sensitiveConfig;

    @Autowired
    private SsoTokenService ssoTokenService;

    @Autowired
    private JwtService jwtService;

    @Override
    public void apply(RequestTemplate template) {
        try {
            // 1. 记录请求信息 - 包含URL、请求头和请求体的详细日志记录
            logRequest(template);

            // 2. 参数格式校验 - 确保请求格式符合规范
            validateRequestFormat(template);

            // 3. 子类特定处理 - 执行具体拦截器的业务逻辑
            doIntercept(template);

        }
        catch (Exception e) {
            // 使用异常处理工具类记录异常日志，确保异常信息被完整保存
            logger.error("Failed to process Feign request: {}", e.getMessage());
            throw e;
        }
    }

    /**
     * 子类实现的具体拦截处理逻辑
     * 
     * @param template Feign请求模板，包含请求的所有信息
     * @throws RuntimeException 当拦截处理过程中发生错误时抛出
     */
    protected abstract void doIntercept(RequestTemplate template);

    /**
     * 记录Feign请求的详细日志信息
     * 
     * @param template Feign请求模板 包含以下信息： 1. 请求URL 2. 请求头信息（进行脱敏处理） 3. 请求体内容（进行脱敏处理）
     */
    protected void logRequest(RequestTemplate template) {
        try {
            String headers = objectMapper.writeValueAsString(template.headers());
            String body = new String(template.body() != null ? template.body() : new byte[0],
                java.nio.charset.StandardCharsets.UTF_8);

            // 对请求信息进行脱敏处理，保护敏感数据
            headers = MaskSensitiveUtil.maskSensitiveInfo(headers, sensitiveConfig);
            body = MaskSensitiveUtil.maskSensitiveInfo(body, sensitiveConfig);

            // 分别记录请求的各个部分，便于问题定位
            logger.debug(" Feign Request - URL: {}", template.feignTarget().url() + template.path());
            logger.debug(" Feign Request - Headers: {}", headers);
            logger.debug(" Feign Request - Body: {}", body);
        }
        catch (Exception e) {
            logger.warn("Failed to log Feign request", e);
        }
    }

    /**
     * 验证请求格式是否符合规范
     * 
     * @param template Feign请求模板
     * @throws ByAiArgumentException 当请求格式不符合规范时抛出
     */
    protected void validateRequestFormat(RequestTemplate template) {
        // 基础参数校验
        if (StringUtils.isBlank(template.url())) {
            throw new BaseException(I18nUtil.get("feign.request.url.invalid"));
        }

        // 请求体校验
        validateRequestBody(template);

        // 校验请求头格式
        validateHeaders(template);
    }

    private static void validateHeaders(RequestTemplate template) {
        template.headers().forEach((key, values) -> {
            if (values != null && !values.isEmpty()) {
                for (String value : values) {
                    if (StringUtils.isBlank(value)) {
                        throw new ByAiArgumentException(I18nUtil.get("feign.request.header.value.blank", key));
                    }
                }
            }
        });
    }

    private void validateRequestBody(RequestTemplate template) {
        if (template.body() != null && template.body().length > 0) {
            try {
                // 检查是否为multipart/form-data请求，如果是则跳过JSON验证
                String contentType = getContentType(template);
                if (contentType != null && contentType.contains("multipart/form-data")) {
                    return; // 跳过JSON验证
                }

                if (objectMapper != null) {
                    // 尝试解析JSON，验证格式
                    objectMapper.readTree(template.body());
                }
            }
            catch (Exception e) {
                logger.warn("[Feign Request] Request body JSON validation failed", e);
            }
        }
    }

    /**
     * 获取请求的Content-Type
     * 
     * @param template Feign请求模板
     * @return Content-Type头的值，或null
     */
    private String getContentType(RequestTemplate template) {
        if (template == null || template.headers() == null) {
            return null;
        }

        // 获取Content-Type头的值
        for (Map.Entry<String, Collection<String>> entry : template.headers().entrySet()) {
            if ("content-type".equalsIgnoreCase(entry.getKey())) {
                Collection<String> values = entry.getValue();
                if (values != null && !values.isEmpty()) {
                    return values.iterator().next();
                }
            }
        }
        return null;
    }

    /***
     * 根据用户信息生成cookie等请求头
     * 
     * @param requestTemplate 请求信息
     */
    protected void generateCookie(RequestTemplate requestTemplate) {

        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        requestTemplate.header(HttpHeaders.COOKIE, CurrentUserHolder.getSessionId());
        requestTemplate.header("Sso-Token", ssoTokenService.createSsoToken());
        requestTemplate.header("Beyond-Token", jwtService.createJwt(loginInfo));
        requestTemplate.header("System-Code", "BYAI");
    }

    /**
     * Cookie的添加
     *
     * @param template feign的template
     * @param request 请求头
     */
    protected void addCookie(RequestTemplate template, HttpServletRequest request) {

        // 增加语言传递
        template.header("Language", request.getHeader("Language"));

        // 如果是钉钉sso认证获取从门户生成的token信息
        String sessionId = CurrentUserHolder.getSessionId();
        if (StringUtil.isNotEmpty(sessionId)) {
            logger.info("SESSION:{}", sessionId);
            template.header("Cookie", String.format("SESSION=%s; PORTAL-SESSION=%s", sessionId, sessionId));
        }
        else if (StringUtil.isNotEmpty(request.getHeader("Beyond-Token"))) {
            template.header("Beyond-Token", request.getHeader("Beyond-Token"));
        }
        else {
            template.header(HttpHeaders.COOKIE, request.getHeader(HttpHeaders.COOKIE));
        }
    }

}