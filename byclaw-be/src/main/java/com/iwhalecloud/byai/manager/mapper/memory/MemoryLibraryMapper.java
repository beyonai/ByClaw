package com.iwhalecloud.byai.manager.mapper.memory;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.memory.MemoryLibrary;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 记忆库Mapper
 * 
 * @author system
 * @date 2025-01-XX
 */
@Mapper
public interface MemoryLibraryMapper extends BaseMapper<MemoryLibrary> {

    /**
     * 根据用户ID和数字员工ID查询记忆库
     *
     * @param agentId 数字员工ID
     * @param libraryType 类型
     * @return 记忆库信息
     */
    MemoryLibrary selectByUserIdAndAgentId(@Param("agentId") Long agentId,
                                          @Param("libraryType") String libraryType);

    /**
     * 根据数字员工ID查询记忆库列表
     * 
     * @param agentId 数字员工ID
     * @return 记忆库信息列表
     */
    List<MemoryLibrary> selectByAgentId(@Param("agentId") Long agentId);

    /**
     * 根据数字员工ID删除记忆库
     * 
     * @param agentId 数字员工ID
     * @return 删除的记录数
     */
    int deleteByAgentId(@Param("agentId") Long agentId);
}

