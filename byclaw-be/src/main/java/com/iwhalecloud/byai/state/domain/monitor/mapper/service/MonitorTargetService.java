package com.iwhalecloud.byai.state.domain.monitor.mapper.service;

import com.iwhalecloud.byai.manager.mapper.monitor.MonitorTargetMapper;
import com.iwhalecloud.byai.common.constants.Constants;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class MonitorTargetService {
    @Autowired
    private MonitorTargetMapper monitorTargetMapper;

    /**
     * 查询质量等级评级小于阈值的数字员工
     * @param targetQuality 质量等级评级
     * @return List<Long></Long> 数字员工id
     */
    public List<Long> digitalEmployeeLtTargetQuality(String targetQuality) {
        return monitorTargetMapper.selectLtTargetQuality(Constants.DIGITAL_EMPLOYEE, targetQuality);
    }
}
