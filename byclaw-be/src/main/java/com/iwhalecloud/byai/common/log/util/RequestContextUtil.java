package com.iwhalecloud.byai.common.log.util;

import static com.iwhalecloud.byai.common.log.exception.ServiceCode.REQUEST_ID;

import org.slf4j.MDC;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import com.alibaba.ttl.TransmittableThreadLocal;
import jakarta.servlet.http.HttpServletRequest;

/**
 * 请求上下文工具类 统一管理 REQUEST_ID，支持 HTTP 请求和 WebSocket 消息 职责分工： - HTTP 请求：TraceFilter 负责设置 - WebSocket：WebSocketHandler 负责设置
 * - 业务代码：只负责获取
 *
 * @author system
 */
public final class RequestContextUtil {

    private RequestContextUtil() {
        // 工具类，禁止实例化
    }

    /**
     * 使用 TransmittableThreadLocal 存储请求ID 支持线程池和异步场景的上下文传递
     */
    private static final TransmittableThreadLocal<Long> REQUEST_ID_HOLDER = new TransmittableThreadLocal<>();

    /**
     * 设置请求ID（仅供入口调用） - TraceFilter - WebSocketHandler
     *
     * @param requestId 请求ID
     */
    public static void setRequestId(Long requestId) {
        if (requestId != null) {
            // 1. 设置到 ThreadLocal
            REQUEST_ID_HOLDER.set(requestId);

            // 2. 设置到 MDC（日志自动输出）
            MDC.put(REQUEST_ID, String.valueOf(requestId));
        }
    }

    /**
     * 获取请求ID（业务代码调用） 优先级：ThreadLocal > RequestAttribute
     *
     * @return 请求ID，如果不存在返回 null
     */
    public static Long getRequestId() {
        // 1. 优先从 ThreadLocal 获取（适用于 HTTP 和 WebSocket）
        Long requestId = REQUEST_ID_HOLDER.get();
        if (requestId != null) {
            return requestId;
        }

        // 2. 降级：从 RequestAttribute 获取（兼容旧代码）
        try {
            ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder
                .getRequestAttributes();
            if (attributes != null) {
                HttpServletRequest request = attributes.getRequest();
                Object requestIdObj = request.getAttribute(REQUEST_ID);
                if (requestIdObj != null) {
                    if (requestIdObj instanceof Long) {
                        return (Long) requestIdObj;
                    }
                    return Long.parseLong(requestIdObj.toString());
                }
            }
        }
        catch (Exception e) {
            // 忽略异常
        }

        return null;
    }

    /**
     * 获取请求ID，如果不存在则生成新的 注意：这是一个兜底方法，正常情况下应该在入口已设置 如果走到生成逻辑，说明可能有问题
     *
     * @return 请求ID（保证不为 null）
     */
    public static Long getRequestIdOrGenerate() {
        Long requestId = getRequestId();
        if (requestId == null) {
            // 如果走到这里，说明入口没有设置 REQUEST_ID
            requestId = SnowFlake.nextId();
        }
        return requestId;
    }

    /**
     * 清理上下文（必须在请求/消息处理完成后调用） 防止线程池复用时数据污染和内存泄漏
     */
    public static void clear() {
        REQUEST_ID_HOLDER.remove();
        MDC.remove(REQUEST_ID);
    }

}
