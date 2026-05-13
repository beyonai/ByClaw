package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceOperLog;
import com.iwhalecloud.byai.manager.domain.resource.enums.OperationTypeEnum;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceOperLogMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Service
public class OperationLogService {

    @Autowired
    private SsResourceOperLogMapper ssResourceOperLogMapper;
    /**
     * 记录操作日志
     */
    public void recordOperationLog(SsResource resource, OperationTypeEnum operationTypeEnum) {
        SsResourceOperLog operLog = new SsResourceOperLog();
        operLog.setResourceId(resource.getResourceId());
        operLog.setOperType(operationTypeEnum.getCode());
        operLog.setOperDesc(operationTypeEnum.getDesc() + "资源");
        operLog.setOperUser(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        operLog.setCreateTime(LocalDateTime.now());
        operLog.setCreateBy(CurrentUserHolder.getCurrentUserId());
        operLog.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        operLog.setUpdateTime(LocalDateTime.now());
        operLog.setComAcctId(CurrentUserHolder.getEnterpriseId());
        // 设置当前版本号
        operLog.setVersionNo(String.valueOf(resource.getResourceDVerid()));
        ssResourceOperLogMapper.insert(operLog);
    }
}
