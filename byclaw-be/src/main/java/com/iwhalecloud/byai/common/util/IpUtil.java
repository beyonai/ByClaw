package com.iwhalecloud.byai.common.util;

import cn.hutool.http.useragent.OS;
import cn.hutool.http.useragent.UserAgent;
import cn.hutool.http.useragent.UserAgentUtil;
import jakarta.servlet.http.HttpServletRequest;

import java.util.Arrays;

/**
 * @author he.duming
 * @date 2025-04-14 15:53:18
 * @description 获取ip地址的工具类
 */
public final class IpUtil {

    private IpUtil() {
    }

    /**
     * 根据请求获取访问端IP地址
     *
     * @param request 请求
     * @return String 访问端IP地址
     */
    public static String getIpAddress(HttpServletRequest request) {
        if (request == null) {
            return "";
        }
        String ip = request.getHeader("x-forwarded-for");
        ip = getClientIpFromHeaders(request, ip);
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }
        if (ip != null && ip.contains(",")) {
            String[] ipArray = ip.split(",");
            ip = ipArray[0];
        }
        if ("0:0:0:0:0:0:0:1".equalsIgnoreCase(ip)) {
            ip = "127.0.0.1";
        }
        return ip;
    }

    private static String getClientIpFromHeaders(HttpServletRequest request, String ip) {
        for (String header : Arrays.asList("X-Forwarded-For", "X-Real-IP", "Proxy-Client-IP", "WL-Proxy-Client-IP",
            "HTTP_CLIENT_IP", "HTTP_X_FORWARDED_FOR")) {
            ip = request.getHeader(header);
            if (ip != null && !ip.isEmpty() && !"unknown".equalsIgnoreCase(ip)) {
                break;
            }
        }
        return ip;
    }

    /**
     * 是否是手机终端
     * 
     * @param request 请求
     * @return boolean
     */
    public static boolean isMobileAgent(HttpServletRequest request) {
        String userAgent = request.getHeader("User-Agent");
        if (StringUtil.isEmpty(userAgent)) {
            return false;
        }

        // 转换为小写，避免大小写问题
        String lowerAgent = userAgent.toLowerCase();

        // 手机端特征关键词（包含常见移动设备系统/浏览器）
        String[] mobileKeywords = {
            "android", "iphone", "ipad", "ipod", "blackberry", "windows phone", "mobile", "opera mini", "iemobile",
            "webos", "kindle", "phone", "mobile safari", "dalvik", "samsung", "sony", "okhttp", "cfnetwork"
        };

        // 匹配关键词，存在则视为手机端
        for (String keyword : mobileKeywords) {
            if (lowerAgent.contains(keyword)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 解析请求的操作系统信息
     *
     * @param request HttpServletRequest对象
     * @return 操作系统名称
     */
    public static String getOsType(HttpServletRequest request) {

        // 优先尝试使用 sec-ch-ua-platform 头部
        String osPlatform = request.getHeader("sec-ch-ua-platform");
        if (StringUtil.isNotEmpty(osPlatform)) {
            // 移除引号 (如果存在)
            return osPlatform.replaceAll("\"", "");
        }

        // 回退到解析User-Agent
        String userAgent = request.getHeader("User-Agent");
        if (StringUtil.isEmpty(userAgent)) {
            return "Unknown";
        }

        // 获取代理请求对象
        UserAgent agent = UserAgentUtil.parse(userAgent);
        if (agent == null) {
            return "Unknown";
        }

        // 如果无法获取，返回未知
        OS os = agent.getOs();
        return os != null ? os.getName() : "Unknown";
    }

}
