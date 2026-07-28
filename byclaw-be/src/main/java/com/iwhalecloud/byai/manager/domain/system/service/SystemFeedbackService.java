package com.iwhalecloud.byai.manager.domain.system.service;

import com.iwhalecloud.byai.manager.mapper.system.SystemFeedbackMapper;
import com.iwhalecloud.byai.manager.entity.system.SystemFeedback;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-08-19 19:45:46
 * @description TODO
 */
@Service
public class SystemFeedbackService {

    @Autowired
    private SystemFeedbackMapper systemFeedbackMapper;

    /**
     * 保存系统
     * 
     * @param systemFeedback save
     */
    public void save(SystemFeedback systemFeedback) {
        systemFeedbackMapper.insert(systemFeedback);
    }

}
