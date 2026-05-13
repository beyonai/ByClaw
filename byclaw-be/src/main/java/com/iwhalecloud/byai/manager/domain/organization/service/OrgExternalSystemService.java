package com.iwhalecloud.byai.manager.domain.organization.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.mapper.organization.OrgExternalSystemMapper;
import com.iwhalecloud.byai.manager.entity.organization.OrgExternalSystem;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-05-30 01:47:52
 * @description TODO
 */
@Service
public class OrgExternalSystemService {

    @Autowired
    private OrgExternalSystemMapper orgExternalSystemMapper;

    /**
     * 新增外组织关联表
     * 
     * @param orgExternalSystem 系统关联
     */
    public void save(OrgExternalSystem orgExternalSystem) {
        orgExternalSystemMapper.insert(orgExternalSystem);
    }

    /***
     * 更新外系统组织信息
     * 
     * @param orgExternalSystem 外系统
     */
    public void update(OrgExternalSystem orgExternalSystem) {
        orgExternalSystemMapper.updateById(orgExternalSystem);
    }

    /**
     * 查找外系统
     * 
     * @param depId 来源组织
     * @return OrgExternalSystem
     */
    public OrgExternalSystem finByDepId(Long depId) {
        LambdaQueryWrapper<OrgExternalSystem> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(OrgExternalSystem::getSourceDepId, depId);
        return orgExternalSystemMapper.selectOne(queryWrapper);
    }

    /**
     * 根据外系统部门unionId查找本系统orgId
     *
     * @param unionId 来源标识
     * @return OrgExternalSystem
     */
    public Long findOrgIdByUnionId(String unionId) {
        LambdaQueryWrapper<OrgExternalSystem> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(OrgExternalSystem::getUnionId, unionId);
        OrgExternalSystem orgExternalSystem = orgExternalSystemMapper.selectOne(queryWrapper);
        return orgExternalSystem != null ? orgExternalSystem.getOrgId() : null;
    }

    /**
     * 根据本系统组织ID查找外部系统映射
     *
     * @param orgId 本系统组织ID
     * @return OrgExternalSystem
     */
    public OrgExternalSystem findByOrgId(Long orgId) {
        LambdaQueryWrapper<OrgExternalSystem> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(OrgExternalSystem::getOrgId, orgId);
        return orgExternalSystemMapper.selectOne(queryWrapper);
    }

    /**
     * 删除外系统组织
     * 
     * @param poOrgExternalSystemId 主键
     */
    public void deleteById(Long poOrgExternalSystemId) {
        orgExternalSystemMapper.deleteById(poOrgExternalSystemId);
    }
}
