package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.manager.dto.resource.ResourceExtAgentDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAgent;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtAgentMapper;
import com.iwhalecloud.byai.common.util.ListUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * @author he.duming
 * @date 2025-09-07 11:37:09
 * @description TODO
 */
@Service
public class SsResExtAgentService {

    @Autowired
    private SsResExtAgentMapper ssResExtAgentMapper;

    /**
     * 插入智能体扩展表
     * 
     * @param ssResExtAgent 智能体扩展
     */
    public void save(SsResExtAgent ssResExtAgent) {
        ssResExtAgentMapper.insert(ssResExtAgent);
    }

    /**
     * 更新智能体扩展表
     * 
     * @param ssResExtAgent 智能体扩展
     */
    public void update(SsResExtAgent ssResExtAgent) {
        ssResExtAgentMapper.updateById(ssResExtAgent);
    }

    /**
     * 删除智能体扩展表
     *
     * @param resourceId 资源扩展标识
     */
    public void removeById(Long resourceId) {
        ssResExtAgentMapper.deleteById(resourceId);
    }

    /**
     * 查询资源信息
     * 
     * @param resourceId 资源扩展标识
     */
    public SsResExtAgent findById(Long resourceId) {
        return ssResExtAgentMapper.selectById(resourceId);
    }

    /**
     * 查询智能体信息
     *
     * @param resourceIds 资源标识
     * @return ResourceExtAgentDto
     */
    public List<ResourceExtAgentDto> findResourceExtAgentByIds(Collection<Long> resourceIds) {
        return ssResExtAgentMapper.findResourceExtAgentByIds(resourceIds);
    }

    /**
     * 查询单个值
     *
     * @param resourceId 资源标识
     * @return ResourceExtAgentDto
     */
    public ResourceExtAgentDto findResourceExtAgentById(Long resourceId) {
        Set<Long> resourceIds = Collections.singleton(resourceId);
        List<ResourceExtAgentDto> resultList = this.findResourceExtAgentByIds(resourceIds);
        return ListUtil.isNotEmpty(resultList) ? resultList.get(0) : null;
    }

}
