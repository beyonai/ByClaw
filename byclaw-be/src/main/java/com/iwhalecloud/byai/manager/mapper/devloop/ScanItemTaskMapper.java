package com.iwhalecloud.byai.manager.mapper.devloop;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.devloop.ScanItemTask;
import org.apache.ibatis.annotations.Mapper;

/** 研发需求子任务专用 Mapper,不与运营任务或研发会话共用。 */
@Mapper
public interface ScanItemTaskMapper extends BaseMapper<ScanItemTask> {
}
