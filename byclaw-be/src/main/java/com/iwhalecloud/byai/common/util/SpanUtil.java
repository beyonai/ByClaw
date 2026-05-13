package com.iwhalecloud.byai.common.util;

import java.util.List;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.StatusCode;

/**
 * opentelemetry-javaagent集成到langfuse的trace工具类
 *
 * @author wangwei
 * @since 2026-01-24
 */
public final class SpanUtil {

    private SpanUtil() {
    }

    /**
     * 设置当前span的名称
     *
     * @param span span
     * @param name name
     * @author wangwei
     * @since 2026-01-24
     */
    public static void name(Span span, String name) {
        if (span == null) {
            return;
        }
        span.updateName(name);
    }

    /**
     * 设置当前调用链上该span的输入
     *
     * @param span  span
     * @param input input
     * @author wangwei
     * @since 2026-01-24
     */
    public static void input(Span span, String input) {
        if (span == null) {
            return;
        }
        span.setAttribute("input.value", input);
    }

    /**
     * 设置当前调用链上该span的输出
     *
     * @param span   span
     * @param output output
     * @author wangwei
     * @since 2026-01-24
     */
    public static void output(Span span, String output) {
        if (span == null) {
            return;
        }
        span.setAttribute("output.value", output);
    }

    /**
     * 设置当前调用链上该span的调用异常信息
     *
     * @param span     span
     * @param errorMsg errorMsg
     * @author wangwei
     * @since 2026-01-24
     */
    public static void error(Span span, String errorMsg) {
        span.setStatus(StatusCode.ERROR, errorMsg);
    }

    /**
     * 设置当前调用链上该span的标签
     *
     * @param span     span
     * @param tagNames tagNames
     * @author wangwei
     * @since 2026-01-24
     */
    public static void tags(Span span, List<String> tagNames) {
        span.setAttribute(AttributeKey.stringArrayKey("tags"), tagNames);
    }
}
