package com.iwhalecloud.byai.manager.domain.system.service;

import com.iwhalecloud.byai.manager.mapper.system.SystemFeedbackMapper;
import com.iwhalecloud.byai.manager.entity.system.SystemFeedback;
import com.iwhalecloud.byai.manager.qo.system.SystemFeedbackQueryQo;
import com.iwhalecloud.byai.manager.vo.system.SystemFeedbackManageVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

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

    /**
     * 查询系统反馈管理列表。
     *
     * @param qo 查询条件
     * @return 系统反馈列表
     */
    public List<SystemFeedbackManageVo> selectManageList(SystemFeedbackQueryQo qo) {
        return systemFeedbackMapper.selectManageList(qo);
    }

    /**
     * 查询系统反馈详情。
     *
     * @param id 反馈ID
     * @return 系统反馈详情
     */
    public SystemFeedbackManageVo selectManageDetail(Long id) {
        return systemFeedbackMapper.selectManageDetail(id);
    }
}
