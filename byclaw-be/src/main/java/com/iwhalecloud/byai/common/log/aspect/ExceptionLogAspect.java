package com.iwhalecloud.byai.common.log.aspect;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;

import com.iwhalecloud.byai.common.log.util.RequestContextUtil;
import com.iwhalecloud.byai.manager.domain.log.service.LogExceptionInfoService;
import com.iwhalecloud.byai.manager.entity.log.LogExceptionInfo;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import com.iwhalecloud.byai.common.log.exception.ChaiBiRuntimeExcepion;
import com.iwhalecloud.byai.common.log.exception.DigitalHumanRuntimeExcepion;
import com.iwhalecloud.byai.common.log.exception.DocchainRuntimeException;
import com.iwhalecloud.byai.common.log.exception.KnowledgeRuntimeExcepion;
import com.iwhalecloud.byai.common.log.exception.PythonRuntimeException;
import com.iwhalecloud.byai.common.log.exception.ServiceCode;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;

/**
 * 异常日志切面类 用于拦截Controller层的异常并记录到数据库 通过@ConditionalOnProperty注解实现条件启用，可通过配置文件控制是否启用
 */
@Aspect
@Component
@Slf4j
@ConditionalOnProperty(prefix = "exception.log", name = "enabled", havingValue = "true", matchIfMissing = true)
public class ExceptionLogAspect {

    @Autowired
    private LogExceptionInfoService logExceptionInfoService;

    /**
     * 系统编码，从配置文件中注入
     */
    @Value("${exception.log.sysCode:}")
    String sysCode;

    /**
     * 默认错误码
     */
    String defaultErrorCode = "10000";

    /**
     * 环绕通知，拦截所有Controller层的方法 当方法抛出异常时，记录异常信息并重新抛出
     *
     * @param point 连接点
     * @return 原方法的返回值
     * @throws Throwable 原方法抛出的异常
     */
    @Around("@annotation(org.springframework.web.bind.annotation.RequestMapping) || "
        + "@annotation(org.springframework.web.bind.annotation.GetMapping) || "
        + "@annotation(org.springframework.web.bind.annotation.PostMapping)")
    public Object around(ProceedingJoinPoint point) throws Throwable {
        Object result = null;
        try {
            result = point.proceed();
            return result;
        }
        catch (Exception e) {
            // 记录异常日志
            saveExceptionLog(point, e);
            throw e;
        }
    }

    /**
     * 保存异常日志到数据库 收集异常信息、请求信息、方法信息等
     *
     * @param point 连接点
     * @param e 异常对象
     */
    private void saveExceptionLog(ProceedingJoinPoint point, Exception e) {
        try {
            Long requestId = getRequestId();
            LogExceptionInfo logExceptionInfo = new LogExceptionInfo();

            // 设置请求ID（使用UUID生成）
            logExceptionInfo.setRequestId(requestId);

            // 设置系统编码
            logExceptionInfo.setSysCode(sysCode);

            // 设置异常信息（消息和堆栈）
            logExceptionInfo.setErrorMsg(e.getMessage());
            logExceptionInfo.setErrorStack(getStackTrace(e));

            // 设置类名和方法名
            MethodSignature signature = (MethodSignature) point.getSignature();
            logExceptionInfo.setClassName(signature.getDeclaringTypeName());
            logExceptionInfo.setMethodName(signature.getName());

            // 设置线程信息
            logExceptionInfo.setThreadName(Thread.currentThread().getName());

            // 设置请求信息（IP、URL、请求头、请求体）
            ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder
                .getRequestAttributes();
            if (attributes != null) {
                HttpServletRequest request = attributes.getRequest();
                logExceptionInfo.setHostIp(getIpAddress(request));
                logExceptionInfo.setRequestUrl(request.getRequestURL().toString());
                logExceptionInfo.setRequestHeader(getRequestHeaders(request));
                logExceptionInfo.setRequestBody(getRequestBody(point));
                logExceptionInfo.setSessionId(request.getRequestedSessionId());

            }

            // 设置异常类型和错误码
            logExceptionInfo.setErrorModule(getErrorType(e));
            logExceptionInfo.setErrorCode(getErrorCode(e));

            // 保存日志到数据库
            logExceptionInfoService.save(logExceptionInfo);

        }
        catch (Exception ex) {
            log.error("记录异常日志失败", ex);
        }
    }

    /**
     * 获取请求ID 统一使用 RequestContextUtil 获取，支持 HTTP 和 WebSocket 两种场景
     *
     * @return 请求ID
     */
    private Long getRequestId() {
        // 使用统一工具类获取 REQUEST_ID
        // TraceFilter 或 WebSocketHandler 已在入口设置
        return RequestContextUtil.getRequestIdOrGenerate();
    }

    /**
     * 获取异常的堆栈信息
     *
     * @param e 异常对象
     * @return 堆栈信息的字符串表示
     */
    private String getStackTrace(Exception e) {
        if (e instanceof PythonRuntimeException) {
            return ((PythonRuntimeException) e).getTraceback();
        }
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        e.printStackTrace(pw);
        return sw.toString();
    }

    /**
     * 获取请求的IP地址 优先从X-Forwarded-For等代理头获取，如果获取不到则使用远程地址
     *
     * @param request HTTP请求对象
     * @return IP地址
     */
    private String getIpAddress(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("Proxy-Client-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("WL-Proxy-Client-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }
        return ip;
    }

    /**
     * 获取请求头信息 将所有请求头转换为Map格式
     *
     * @param request HTTP请求对象
     * @return 请求头信息的字符串表示
     */
    private String getRequestHeaders(HttpServletRequest request) {
        Map<String, String> headers = new HashMap<>();
        Enumeration<String> headerNames = request.getHeaderNames();
        while (headerNames.hasMoreElements()) {
            String headerName = headerNames.nextElement();
            headers.put(headerName, request.getHeader(headerName));
        }
        return headers.toString();
    }

    /**
     * 获取请求体信息 目前只获取第一个参数的信息
     *
     * @param point 连接点
     * @return 请求体信息
     */
    private String getRequestBody(ProceedingJoinPoint point) {
        Object[] args = point.getArgs();
        if (args != null && args.length > 0) {
            return String.valueOf(args[0]);
        }
        return null;
    }

    /**
     * 获取异常类型 根据不同的异常类型返回对应的错误类型
     *
     * @param e 异常对象
     * @return 异常类型
     */
    private String getErrorType(Exception e) {
        if (e instanceof KnowledgeRuntimeExcepion) {
            return ServiceCode.Module.APP_AGENT;
        }
        else if (e instanceof ChaiBiRuntimeExcepion) {
            return ServiceCode.Module.APP_CHATBI;
        }
        else if (e instanceof DocchainRuntimeException) {
            return ServiceCode.Module.APP_DOCCHAIN;
        }
        else if (e instanceof DigitalHumanRuntimeExcepion) {
            return ServiceCode.Module.APP_DH;
        }
        else if (e instanceof PythonRuntimeException) {
            return ((PythonRuntimeException) e).getServiceCode();
        }
        else {
            return ServiceCode.Module.APP_BY;
        }
    }

    /**
     * 获取错误码 目前返回默认错误码
     *
     * @param e 异常对象
     * @return 错误码
     */
    private String getErrorCode(Exception e) {
        if (e instanceof PythonRuntimeException) {
            return ((PythonRuntimeException) e).getErrorCode().toString();
        }
        return defaultErrorCode;
    }
}
