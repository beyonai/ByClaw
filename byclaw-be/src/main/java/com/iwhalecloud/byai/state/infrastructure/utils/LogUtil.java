package com.iwhalecloud.byai.state.infrastructure.utils;

import java.util.Arrays;

import org.slf4j.Logger;

public final class LogUtil {

    private LogUtil() {

    }

    public static void info(Logger logger, String format, Object... args) {
        logger.info(format,
                Arrays.stream(args).map(e -> e.toString().replaceAll("[\r\n]", "")).toArray());
    }
    
    public static void warn(Logger logger, String format, Object... args) {
        logger.warn(format,
                Arrays.stream(args).map(e -> e.toString().replaceAll("[\r\n]", "")).toArray());
    }

    public static void debug(Logger logger, String format, Object... args) {
        logger.debug(format,
                Arrays.stream(args).map(e -> sanitizeForLog(e)).toArray());
    }

    /**
     * 清理日志参数中的CRLF字符，防止日志注入
     *
     * @param object 要清理的对象
     * @return 清理后的字符串表示
     */
    public static Object sanitizeForLog(Object object) {
        if (object == null) {
            return "null";
        }
        String str = object.toString();
        // 移除CRLF字符，用空格替换
        return str.replaceAll("[\r\n]", " ");
    }

    /**
     * 清理日志参数，防止注入
     *
     * @param parameter 参数值
     * @return 清理后的参数
     */
    public static String sanitizeLogParameter(Object parameter) {
        if (parameter == null) {
            return "null";
        }
        String str = parameter.toString();
        
        // 清理所有控制字符（包括CRLF、制表符等）
        str = str.replaceAll("[\\x00-\\x1F\\x7F]", " ");
        
        // 清理Unicode控制字符
        str = str.replaceAll("[\\u0000-\\u001F\\u007F-\\u009F]", " ");
        
        // 清理可能导致日志格式破坏的特殊字符
        str = str.replaceAll("[<>&\"'\\\\]", "");
        
        // 清理可能导致日志框架解析错误的字符
        str = str.replaceAll("[\\{\\}\\[\\]]", "");
        
        // 清理可能导致SQL注入的字符（如果日志被用于SQL查询）
        str = str.replaceAll("[;'\"`]", "");
        
        // 清理可能导致命令注入的字符
        str = str.replaceAll("[|&;`$()]", "");
        
        // 清理可能导致XSS的字符
        str = str.replaceAll("[<>\"']", "");
        
        // 限制长度，防止过长的日志
        if (str.length() > 1000) {
            str = str.substring(0, 1000) + "...";
        }
        
        return str;
    }
}
