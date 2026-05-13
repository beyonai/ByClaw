package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceOperLog;
import org.apache.ibatis.annotations.Mapper;

/**
 * 资源操作日志表Mapper接口
 */
@Mapper
public interface SsResourceOperLogMapper extends BaseMapper<SsResourceOperLog> {
}