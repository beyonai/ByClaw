package com.iwhalecloud.byai.manager.mapper.aimodel;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.aimodel.AiPrompt;
import org.apache.ibatis.annotations.Mapper;

/**
 * 智能体提示词模板表Mapper接口 提供基础的CRUD操作及自定义查询方法
 *
 * @author system
 * @date 2025-11-01
 */
@Mapper
public interface AiPromptMapper extends BaseMapper<AiPrompt> {
}
