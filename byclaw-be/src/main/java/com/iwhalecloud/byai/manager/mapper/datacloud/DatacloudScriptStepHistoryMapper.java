package com.iwhalecloud.byai.manager.mapper.datacloud;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptStepHistory;
import org.apache.ibatis.annotations.Mapper;

/**
 * 脚本步骤历史记录表Mapper接口
 * 用于管理脚本步骤的变更历史
 * 
 * @author system
 * @date 2025-01-15
 */
@Mapper
public interface DatacloudScriptStepHistoryMapper extends BaseMapper<DatacloudScriptStepHistory> {

}
