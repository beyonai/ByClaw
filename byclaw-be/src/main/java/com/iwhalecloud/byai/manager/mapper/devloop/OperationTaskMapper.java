package com.iwhalecloud.byai.manager.mapper.devloop;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.devloop.OperationTask;
import org.apache.ibatis.annotations.Mapper;

/** 运营任务专用 Mapper，不与研发会话任务共用。 */
@Mapper
public interface OperationTaskMapper extends BaseMapper<OperationTask> {
}
