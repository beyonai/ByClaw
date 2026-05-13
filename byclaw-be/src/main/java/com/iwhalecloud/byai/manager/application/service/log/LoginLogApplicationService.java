package com.iwhalecloud.byai.manager.application.service.log;

import cn.hutool.http.useragent.OS;
import cn.hutool.http.useragent.UserAgent;
import cn.hutool.http.useragent.UserAgentUtil;
import com.iwhalecloud.byai.manager.entity.log.LoginLog;
import com.iwhalecloud.byai.manager.domain.log.service.LoginLogService;
import com.iwhalecloud.byai.common.util.IpUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.Date;

/**
 * @author he.duming
 * @date 2025-06-17 20:40:26
 * @description TODO
 */
@Service
public class LoginLogApplicationService {

    @Autowired
    private LoginLogService loginLogService;

    /**
     * 登陆成功日志
     *
     * @param request 请求信息
     * @param userId 用户标识
     * @param loginType 登陆类型
     */
    public void saveSuccessLog(HttpServletRequest request, Long userId, String loginType) {
        LoginLog loginLog = new LoginLog();
        loginLog.setUserId(userId);
        loginLog.setLoginType(loginType);
        loginLog.setStatus(0);
        loginLog.setLoginTime(new Date());
        loginLog.setOsType(this.getOsType(request));
        loginLog.setBrowserInfo(request.getHeader("User-Agent"));
        loginLog.setIpAddress(IpUtil.getIpAddress(request));
        loginLog.setSessionId(request.getSession().getId());
        loginLogService.saveLoginLog(loginLog);
    }

    /**
     * 保存用户登陆失败日志
     * 
     * @param request 请求信息
     * @param userId 用户标识
     * @param loginType 登陆类型
     * @param errorReason 错误信息
     */
    public void saveFailLog(HttpServletRequest request, Long userId, String loginType, String errorReason) {
        LoginLog loginLog = new LoginLog();
        loginLog.setUserId(userId);
        loginLog.setLoginType(loginType);
        loginLog.setErrorReason(errorReason);
        loginLog.setStatus(-1);
        loginLog.setLoginTime(new Date());
        loginLog.setOsType(this.getOsType(request));
        loginLog.setBrowserInfo(request.getHeader("User-Agent"));
        loginLog.setIpAddress(IpUtil.getIpAddress(request));
        loginLogService.saveLoginLog(loginLog);
    }

    /**
     * 解析请求的操作系统信息
     * 
     * @param request HttpServletRequest对象
     * @return 操作系统名称
     */
    private String getOsType(HttpServletRequest request) {

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
