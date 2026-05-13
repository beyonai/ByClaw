package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.manager.dto.resource.ResourceExtToolDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtTool;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtToolMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-09-07 19:39:21
 * @description TODO
 */
@Service
public class SsResExtToolService {

    @Autowired
    private SsResExtToolMapper ssResExtToolMapper;

    /**
     * 插入工具扩展表
     *
     * @param ssResExtTool 工具扩展
     */
    public void save(SsResExtTool ssResExtTool) {
        ssResExtToolMapper.insert(ssResExtTool);
    }

    /**
     * 更新工具扩展表
     *
     * @param ssResExtTool 工具扩展
     */
    public void update(SsResExtTool ssResExtTool) {
        ssResExtToolMapper.updateById(ssResExtTool);
    }

    /**
     * 删除工具扩展表
     *
     * @param resourceId 资源扩展标识
     */
    public void removeById(Long resourceId) {
        ssResExtToolMapper.deleteById(resourceId);
    }

    /**
     * 查询资源信息
     *
     * @param resourceId 资源扩展标识
     */
    public SsResExtTool findById(Long resourceId) {
        return ssResExtToolMapper.selectById(resourceId);
    }

    /**
     * 查询工具信息
     *
     * @param resourceIds 资源标识
     * @return ResourceExtToolDto
     */
    public List<ResourceExtToolDto> findResourceExtToolByIds(Collection<Long> resourceIds) {
        return ssResExtToolMapper.findResourceExtToolByIds(resourceIds);
    }

}
