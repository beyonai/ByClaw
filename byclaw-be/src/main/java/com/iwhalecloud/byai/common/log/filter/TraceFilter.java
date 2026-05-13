package com.iwhalecloud.byai.common.log.filter;

import static com.iwhalecloud.byai.common.log.exception.ServiceCode.REQUEST_ID;

import java.io.IOException;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.log.util.RequestContextUtil;
import com.iwhalecloud.byai.common.log.util.SnowFlake;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;

/**
 * 追踪过滤器
 * 职责：为每个 HTTP 请求生成唯一的 REQUEST_ID 并设置到上下文
 *
 * @author system
 */
@Component
public class TraceFilter implements Filter {
    
    @Override
    public void init(FilterConfig filterConfig) {
        // 初始化方法，无需实现
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        try {
            // 1. 生成唯一的请求ID
            Long requestId = SnowFlake.nextId();
            
            // 2. 存储到请求属性（兼容旧代码）
            request.setAttribute(REQUEST_ID, requestId);
            
            // 3. 设置到 ThreadLocal 和 MDC（新方式，支持 WebSocket 统一获取）
            RequestContextUtil.setRequestId(requestId);
            
            // 4. 继续执行过滤器链
            chain.doFilter(request, response);
            
        } finally {
            // 5. 请求结束，清理上下文（防止线程池复用时数据污染）
            RequestContextUtil.clear();
        }
    }

    @Override
    public void destroy() {
        // 销毁方法，无需实现
    }
}
