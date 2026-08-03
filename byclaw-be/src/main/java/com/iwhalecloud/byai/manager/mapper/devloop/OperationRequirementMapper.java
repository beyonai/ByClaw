package com.iwhalecloud.byai.manager.mapper.devloop;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.devloop.OperationRequirement;
import org.apache.ibatis.annotations.Mapper;

/** 运营需求专用 Mapper，禁止替代研发扫描条目的 Mapper。 */
@Mapper
public interface OperationRequirementMapper extends BaseMapper<OperationRequirement> {
}
