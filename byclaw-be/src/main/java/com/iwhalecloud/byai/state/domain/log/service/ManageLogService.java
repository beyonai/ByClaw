package com.iwhalecloud.byai.state.domain.log.service;

import com.iwhalecloud.byai.manager.entity.log.ManageLog;
import com.iwhalecloud.byai.manager.mapper.log.ManageLogMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-11-17 18:21:08
 * @description TODO
 */
@Service
public class ManageLogService {

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private ManageLogMapper manageLogMapper;

    public void saveManageLog(ManageLog manageLog) {
        manageLog.setLogId(sequenceService.nextSnowId());
        manageLogMapper.insert(manageLog);
    }
}
