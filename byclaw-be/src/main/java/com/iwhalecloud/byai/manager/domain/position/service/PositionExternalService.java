package com.iwhalecloud.byai.manager.domain.position.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.mapper.position.PositionExternalMapper;
import com.iwhalecloud.byai.manager.entity.position.PositionExternal;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-05-30 14:43:44
 * @description TODO
 */
@Service
public class PositionExternalService {

    @Autowired
    private PositionExternalMapper positionExternalMapper;

    /**
     * 保存用户信息
     *
     * @param positionExternal 岗位扩展信息
     */
    public void save(PositionExternal positionExternal) {
        positionExternalMapper.insert(positionExternal);
    }

    /**
     * 修改岗位信息
     *
     * @param positionExternal 扩展信息
     */
    public void update(PositionExternal positionExternal) {
        positionExternalMapper.updateById(positionExternal);
    }

    /**
     * 删除岗位扩展信息
     *
     * @param positionExternalId 扩展信息
     */
    public void deleteById(Long positionExternalId) {
        positionExternalMapper.deleteById(positionExternalId);
    }

    /**
     * 查询外系统标�?
     *
     * @param unionId 系统标识
     * @return PositionExternal
     */
    public PositionExternal findByUnionId(String unionId) {
        LambdaQueryWrapper<PositionExternal> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(PositionExternal::getUnionId, unionId);
        return positionExternalMapper.selectOne(queryWrapper);
    }

    /**
     * 查询外系统标识
     *
     * @param unionId 系统标识
     * @return PositionExternal
     */
    public Long findPositionIdByUnionId(String unionId) {
        PositionExternal positionExternal = this.findByUnionId(unionId);
        return positionExternal != null ? positionExternal.getPositionId() : null;
    }
}
