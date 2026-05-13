package com.iwhalecloud.byai.manager.domain.log.service;

import com.iwhalecloud.byai.manager.entity.log.LogExceptionInfo;
import com.iwhalecloud.byai.manager.mapper.log.LogExceptionInfoMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class LogExceptionInfoService {

    @Autowired
    private LogExceptionInfoMapper exceptionLogMapper;

    /**
     * 保存异常日志信息
     * 
     * @param logExceptionLog 异常日志信息
     */
    public void save(LogExceptionInfo logExceptionLog) {
        exceptionLogMapper.insert(logExceptionLog);
    }

}
