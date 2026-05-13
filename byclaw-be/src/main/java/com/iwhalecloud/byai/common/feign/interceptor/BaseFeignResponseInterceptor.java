package com.iwhalecloud.byai.common.feign.interceptor;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.feign.config.FeignSensitiveConfig;
import com.iwhalecloud.byai.common.feign.util.MaskSensitiveUtil;
import feign.FeignException;
import feign.Response;
import feign.codec.Decoder;
import java.io.IOException;
import java.lang.reflect.Type;
import org.apache.commons.io.IOUtils;

/**
 * Feign响应拦截器基类
 */
public abstract class BaseFeignResponseInterceptor implements Decoder {

    private static final Logger logger = LoggerFactory.getLogger(BaseFeignResponseInterceptor.class);


    protected final ObjectMapper objectMapper;

    protected final Decoder delegate;

    protected FeignSensitiveConfig sensitiveConfig;

    public BaseFeignResponseInterceptor(Decoder delegate, ObjectMapper objectMapper,
        FeignSensitiveConfig sensitiveConfig) {
        this.delegate = delegate;
        this.objectMapper = objectMapper;
        this.sensitiveConfig = sensitiveConfig;
    }

    @Override
    public Object decode(Response response, Type type) throws IOException, FeignException {
        if (response.body() == null) {
            return null;
        }

        // 如果是文件下载或报告下载,暂不做处理，否则报错
        String url = response.request().url();
        if (url != null && (url.contains("download") || url.contains("report"))) {
            return delegate.decode(response, type);
        }

        String responseBody = null;
        byte[] bodyBytes = null;
        try {
            // 读取响应体并保存字节数组
            bodyBytes = IOUtils.toByteArray(response.body().asInputStream());
            responseBody = new String(bodyBytes, java.nio.charset.StandardCharsets.UTF_8);

            // 记录响应日志
            logResponse(response, responseBody);

            // 校验响应格式
            validateResponseFormat(response, responseBody);

            // 创建新的Response对象，使用新的InputStream
            Response newResponse = response.toBuilder().body(bodyBytes).build();

            // 使用子类的processResponse方法处理响应
            return processResponse(newResponse, responseBody, type);

        }
        catch (Exception e) {
            // 使用异常处理工具类记录异常日志
            logger.error("Failed to process Feign response: {}", e.getMessage());
            // 抛出异常 aop记录异常日志
            throw e;
        }
    }

    private void logResponse(Response response, String responseBody) {
        try {
            String headers = objectMapper.writeValueAsString(response.headers());

            // 对响应信息进行脱敏处理
            headers = MaskSensitiveUtil.maskSensitiveInfo(headers, sensitiveConfig);
            String maskedBody = MaskSensitiveUtil.maskSensitiveInfo(responseBody, sensitiveConfig);

            // 分别记录响应的各个部分
            logger.debug("Feign Response - Status: {}", response.status());
            logger.debug("Feign Response - Headers: {}", headers);
            logger.debug("Feign Response - Body: {}", maskedBody);
        }
        catch (Exception e) {
            logger.warn("Failed to log Feign response", e);
        }
    }

    private void validateResponseFormat(Response response, String responseBody) {
        // 1. 校验状态码
        validateUrl(response);

        // 2. 校验响应头
        // validateResponse(response);

        // 3. 校验响应体格式
        validateHeaders(responseBody);
    }

    private void validateHeaders(String responseBody) {
        if (responseBody != null) {
            try {
                objectMapper.readTree(responseBody);
            }
            catch (Exception e) {
                logger.debug("Response body is not valid JSON: {}", e.getMessage());
                throw new IllegalStateException(I18nUtil.get("feign.response.body.format.invalid"), e);
            }
        }
    }

    private static void validateUrl(Response response) {
        int status = response.status();
        if (status < 200 || status >= 300) {
            throw new IllegalStateException(I18nUtil.get("feign.response.status.code.invalid", status));
        }
    }

    protected abstract Object processResponse(Response response, String responseBody, Type type) throws IOException;
}