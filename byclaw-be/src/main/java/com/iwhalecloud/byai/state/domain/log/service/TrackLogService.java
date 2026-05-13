package com.iwhalecloud.byai.state.domain.log.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.manager.mapper.log.TrackLogMapper;
import com.iwhalecloud.byai.manager.entity.log.TrackLog;

/**
 * 日志埋点服务类 提供日志的保存业务操作
 *
 * @author system
 * @date 2025-01-20
 */
@Service
public class TrackLogService {

    @Autowired
    private TrackLogMapper trackLogMapper;

    /**
     * 保存日志埋点信息
     *
     * @param trackLog 日志对象
     */
    public void saveTrackLog(TrackLog trackLog) {
        // 插入日志
        trackLogMapper.insert(trackLog);
    }
}
