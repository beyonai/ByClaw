package com.iwhalecloud.byai.state.domain.men.service;

import com.iwhalecloud.byai.manager.entity.men.MenTask;
import com.iwhalecloud.byai.manager.entity.men.MenTaskStatusLog;
import com.iwhalecloud.byai.manager.mapper.men.MenTaskStatusLogMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;

/**
 * 待办任务状态变更服务
 */
@Service
public class MenTaskStatusLogService {
    @Autowired
    private MenTaskStatusLogMapper menTaskStatusLogMapper;
    
    @Autowired
    private SequenceService sequenceService;

    /*
    * menTaskDtoOld 修改之前的任务信息
    * menTaskDtoNew 修改之后的任务信息
    * */
    public MenTaskStatusLog insert(MenTask menTaskDtoOld, MenTask menTaskDtoNew) {
        //修改了需要插入日志记录
        MenTaskStatusLog statusLog = new MenTaskStatusLog();
        statusLog.setTaskStatusLogId(sequenceService.nextVal());
        statusLog.setTaskId(menTaskDtoOld.getTaskId());
        statusLog.setStatusCd(menTaskDtoNew.getStatusCd());
        statusLog.setChangDesc(menTaskDtoNew.getDealDesc());
        statusLog.setStatusCdOld(menTaskDtoOld.getStatusCd());
        statusLog.setCreateTime(new Date());
        statusLog.setCreateBy(CurrentUserHolder.getCurrentUserId());
        statusLog.setComAcctId(CurrentUserHolder.getEnterpriseId());
        menTaskStatusLogMapper.insert(statusLog);
        return statusLog;
    }
    
    /**
     * 根据任务ID删除状态日志
     * 
     * @param taskId 任务ID
     * @return 删除的记录数
     */
    public int deleteByTaskId(Long taskId) {
        return menTaskStatusLogMapper.deleteByTaskId(taskId);
    }
} 