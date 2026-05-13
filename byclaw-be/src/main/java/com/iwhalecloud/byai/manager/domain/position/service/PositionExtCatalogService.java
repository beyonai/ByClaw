package com.iwhalecloud.byai.manager.domain.position.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.position.PositionExtCatalog;
import com.iwhalecloud.byai.manager.mapper.position.PositionExtCatalogMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 领域与岗位关系服务
 */
@Service
public class PositionExtCatalogService {

    @Autowired
    private PositionExtCatalogMapper positionExtCatalogMapper;

    /**
     * 根据岗位ID查询关联领域
     *
     * @param positionId 岗位ID
     * @return 关联记录
     */
    public List<PositionExtCatalog> listByPositionId(Long positionId) {
        LambdaQueryWrapper<PositionExtCatalog> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(PositionExtCatalog::getPositionId, positionId);
        return positionExtCatalogMapper.selectList(wrapper);
    }

    /**
     * 新增关联
     *
     * @param entity 关联实体
     */
    public void save(PositionExtCatalog entity) {
        positionExtCatalogMapper.insert(entity);
    }

    /**
     * 删除岗位关联
     *
     * @param positionId 岗位ID
     */
    public void removeByPositionId(Long positionId) {
        LambdaQueryWrapper<PositionExtCatalog> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(PositionExtCatalog::getPositionId, positionId);
        positionExtCatalogMapper.delete(wrapper);
    }
}

