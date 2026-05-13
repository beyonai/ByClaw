package com.iwhalecloud.byai.manager.domain.memory.service;

import com.iwhalecloud.byai.manager.entity.memory.MemoryLibrary;
import com.iwhalecloud.byai.manager.mapper.memory.MemoryLibraryMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 记忆库Service
 * 
 * @author system
 * @date 2025-01-XX
 */
@Service
public class MemoryLibraryService {

    @Autowired
    private MemoryLibraryMapper memoryLibraryMapper;

    /**
     * 保存记忆库
     * 
     * @param memoryLibrary 记忆库信息
     */
    public void save(MemoryLibrary memoryLibrary) {
        memoryLibraryMapper.insert(memoryLibrary);
    }

    /**
     * 根据ID查询记忆库
     * 
     * @param libraryId 记忆库ID
     * @return 记忆库信息
     */
    public MemoryLibrary findById(Long libraryId) {
        return memoryLibraryMapper.selectById(libraryId);
    }

    /**
     * 根据用户ID和数字员工ID查询记忆库
     *
     * @param agentId 数字员工ID
     * @param libraryType 类型
     * @return 记忆库信息
     */
    public MemoryLibrary findByUserIdAndAgentId(Long agentId, String libraryType) {
        return memoryLibraryMapper.selectByUserIdAndAgentId(agentId, libraryType);
    }

    /**
     * 更新记忆库
     * 
     * @param memoryLibrary 记忆库信息
     */
    public void update(MemoryLibrary memoryLibrary) {
        memoryLibraryMapper.updateById(memoryLibrary);
    }

    /**
     * 根据数字员工ID查询记忆库列表
     * 
     * @param agentId 数字员工ID
     * @return 记忆库信息列表
     */
    public List<MemoryLibrary> findByAgentId(Long agentId) {
        return memoryLibraryMapper.selectByAgentId(agentId);
    }

    /**
     * 根据数字员工ID删除记忆库
     * 
     * @param agentId 数字员工ID
     * @return 删除的记录数
     */
    public int deleteByAgentId(Long agentId) {
        return memoryLibraryMapper.deleteByAgentId(agentId);
    }
}

