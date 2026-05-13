package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.manager.dto.resource.ResourceExtToolKitDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtToolKit;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtToolKitMapper;
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
public class SsResExtToolKitService {

    @Autowired
    private SsResExtToolKitMapper ssResExtToolKitMapper;

    /**
     * 插入工具集扩展表
     * 
     * @param ssResExtToolKit 工具集扩展
     */
    public void save(SsResExtToolKit ssResExtToolKit) {
        ssResExtToolKitMapper.insert(ssResExtToolKit);
    }

    /**
     * 更新工具集扩展表
     * 
     * @param ssResExtToolKit 工具集扩展
     */
    public void update(SsResExtToolKit ssResExtToolKit) {
        ssResExtToolKitMapper.updateById(ssResExtToolKit);
    }

    /**
     * 删除工具集扩展表
     *
     * @param resourceId 资源扩展标识
     */
    public void removeById(Long resourceId) {
        ssResExtToolKitMapper.deleteById(resourceId);
    }

    /**
     * 查询资源信息
     * 
     * @param resourceId 资源扩展标识
     */
    public SsResExtToolKit findById(Long resourceId) {
        return ssResExtToolKitMapper.selectById(resourceId);
    }

    /**
     * 查询工具集信息（包含关联的工具列表）
     *
     * @param resourceIds 资源标识
     * @return ResourceExtToolKitDto
     */
    public List<ResourceExtToolKitDto> findResourceExtToolKitByIds(Collection<Long> resourceIds) {
        return ssResExtToolKitMapper.findResourceExtToolKitByIds(resourceIds);
    }

    /**
     * 查询单个值
     *
     * @param resourceId 资源标识
     * @return ResourceExtToolKitDto
     */
    public ResourceExtToolKitDto findResourceExtToolKitById(Long resourceId) {
        Set<Long> resourceIds = Collections.singleton(resourceId);
        List<ResourceExtToolKitDto> resultList = this.findResourceExtToolKitByIds(resourceIds);
        return ListUtil.isNotEmpty(resultList) ? resultList.get(0) : null;
    }

    /**
     * 查找工具的工具集
     * 
     * @param resourceId 资源标识
     * @return Long
     */
    public Long findToolKitIdByToolsId(Long resourceId) {
        return ssResExtToolKitMapper.findToolKitIdByToolsId(resourceId);
    }

}
