package com.iwhalecloud.byai.manager.mapper.system;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.system.SystemFeedback;
import com.iwhalecloud.byai.manager.qo.system.SystemFeedbackQueryQo;
import com.iwhalecloud.byai.manager.vo.system.SystemFeedbackManageVo;
import org.apache.ibatis.annotations.Param;

import java.util.List;

public interface SystemFeedbackMapper extends BaseMapper<SystemFeedback> {

    /**
     * 查询系统反馈管理列表。
     *
     * @param qo 查询条件
     * @return 系统反馈管理列表
     */
    List<SystemFeedbackManageVo> selectManageList(@Param("qo") SystemFeedbackQueryQo qo);

    /**
     * 查询单条系统反馈管理详情。
     *
     * @param id 反馈ID
     * @return 系统反馈详情
     */
    SystemFeedbackManageVo selectManageDetail(@Param("id") Long id);
}
