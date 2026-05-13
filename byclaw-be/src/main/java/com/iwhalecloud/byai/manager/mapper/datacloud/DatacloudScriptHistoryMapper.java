package com.iwhalecloud.byai.manager.mapper.datacloud;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptHistory;
import org.apache.ibatis.annotations.Mapper;

/**
 * 脚本版本历史表Mapper接口
 * 用于管理脚本的版本变更历史
 * 
 * @author system
 * @date 2025-01-15
 */
@Mapper
public interface DatacloudScriptHistoryMapper extends BaseMapper<DatacloudScriptHistory> {

}
