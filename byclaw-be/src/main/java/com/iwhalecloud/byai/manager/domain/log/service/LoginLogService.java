package com.iwhalecloud.byai.manager.domain.log.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.mapper.log.LoginLogMapper;
import com.iwhalecloud.byai.manager.entity.log.LoginLog;

import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;

@Service
public class LoginLogService {

    @Autowired
    private LoginLogMapper loginLogMapper;

    @Autowired
    private SequenceService SequenceService;

    /**
     * 保存登陆日志
     *
     * @param loginLog 日志对象
     */
    public void saveLoginLog(LoginLog loginLog) {
        loginLog.setLogId(SequenceService.nextSnowId());
        loginLogMapper.insert(loginLog);
    }

    /***
     * 退出登陆时间
     * 
     * @param sessionId 信息
     */
    public void updateLogoutTimeBySessionId(String sessionId) {

        // 如果为空，不处理
        if (StringUtil.isEmpty(sessionId)) {
            return;
        }

        LambdaQueryWrapper<LoginLog> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(LoginLog::getSessionId, sessionId);

        LoginLog loginLog = new LoginLog();
        loginLog.setLogoutTime(new Date());
        loginLogMapper.update(loginLog, queryWrapper);
    }
}