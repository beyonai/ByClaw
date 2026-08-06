package com.iwhalecloud.byai.manager.mapper.capability;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import com.iwhalecloud.byai.manager.entity.capability.AgentCapabilityCardEntity;

/**
 * Agent 能力卡持久化 Mapper。
 *
 * <p>表为 (system_code, agent_id) 复合主键、无独立 id 列，故不继承 MyBatis-Plus BaseMapper，
 * 仅提供业务所需的自定义语句。</p>
 *
 * @author tangs
 */
@Mapper
public interface AgentCapabilityCardMapper {

    /**
     * 按 (systemCode, agentId) 原子 upsert 能力卡；命中则版本自增，否则新增。
     *
     * @param entity 已填充编译产物的实体（createdAt/updatedAt 由 SQL 端用 NOW() 兜底）
     * @return 受影响行数
     */
    int upsert(@Param("entity") AgentCapabilityCardEntity entity);
}
