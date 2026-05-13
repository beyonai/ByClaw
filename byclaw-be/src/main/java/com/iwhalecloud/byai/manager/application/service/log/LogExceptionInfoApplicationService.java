package com.iwhalecloud.byai.manager.application.service.log;

import com.iwhalecloud.byai.common.util.IpUtil;
import com.iwhalecloud.byai.manager.domain.log.service.LogExceptionInfoService;
import com.iwhalecloud.byai.manager.entity.log.LogExceptionInfo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.util.Date;

/**
 * 异常日志应用服务,负责封装异常日志的公共填充逻辑并调用领域服务持久化
 */
@Service
public class LogExceptionInfoApplicationService {

    @Value("${exception.log.sysCode:BYAI_BE}")
    private String sysCode;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private LogExceptionInfoService logExceptionInfoService;

    /**
     * 保存异常日志信息,自动填充主键、系统编码、时间、IP及当前用户信息
     *
     * @param request HTTP请求对象,用于获取客户端IP等请求信息
     * @param logExceptionInfo 异常日志实体
     */
    public void saveLogExceptionInfo(HttpServletRequest request, LogExceptionInfo logExceptionInfo) {
        logExceptionInfo.setSysCode(this.sysCode);
        logExceptionInfo.setRequestId(sequenceService.nextSnowId());
        logExceptionInfo.setCreateTime(new Date());
        logExceptionInfo.setHostIp(IpUtil.getIpAddress(request));
        logExceptionInfo.setUserId(CurrentUserHolder.getCurrentUserId());
        logExceptionInfo.setUserName(CurrentUserHolder.getCurrentUserName());
        logExceptionInfo.setSessionId(CurrentUserHolder.getSessionId());
        logExceptionInfoService.save(logExceptionInfo);
    }
}
