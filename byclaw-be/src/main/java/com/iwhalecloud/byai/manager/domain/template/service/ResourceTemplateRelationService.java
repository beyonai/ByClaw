package com.iwhalecloud.byai.manager.domain.template.service;

import com.iwhalecloud.byai.manager.entity.template.ResourceTemplateRelation;
import com.iwhalecloud.byai.manager.mapper.template.ResourceTemplateRelationMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;

import java.util.List;

/**
 * 资源模版关联关系Service
 * 
 * @author system
 * @date 2025-01-XX
 */
@Service
public class ResourceTemplateRelationService {

    @Autowired
    private ResourceTemplateRelationMapper resourceTemplateRelationMapper;

    /**
     * 保存资源模版关联关系
     * 
     * @param relation 关联关系
     */
    public void save(ResourceTemplateRelation relation) {
        resourceTemplateRelationMapper.insert(relation);
    }

    /**
     * 批量保存资源模版关联关系
     * 
     * @param relations 关联关系列表
     */
    public void batchSave(List<ResourceTemplateRelation> relations) {
        if (!CollectionUtils.isEmpty(relations)) {
            resourceTemplateRelationMapper.batchInsert(relations);
        }
    }

    /**
     * 根据资源ID删除关联关系
     * 
     * @param resourceId 资源ID
     */
    public void deleteByResourceId(Long resourceId) {
        resourceTemplateRelationMapper.deleteByResourceId(resourceId);
    }

    /**
     * 根据资源ID和用户ID查询关联关系列表
     * 
     * @param resourceId 资源ID
     * @param userId 用户ID
     * @return 关联关系列表
     */
    public List<ResourceTemplateRelation> findByResourceIdAndUserId(Long resourceId, Long userId) {
        return resourceTemplateRelationMapper.selectByResourceIdAndUserId(resourceId, userId);
    }

    /**
     * 根据主键更新关联关系
     * 
     * @param relation 关联关系
     */
    public void updateById(ResourceTemplateRelation relation) {
        resourceTemplateRelationMapper.updateById(relation);
    }

    /**
     * 根据主键删除关联关系
     * 
     * @param resourceTemplateId 关联关系主键ID
     */
    public void deleteById(Long resourceTemplateId) {
        resourceTemplateRelationMapper.deleteById(resourceTemplateId);
    }

    /**
     * 根据模板ID查询关联关系列表
     * 
     * @param templateId 模板ID
     * @return 关联关系列表
     */
    public List<ResourceTemplateRelation> findByTemplateId(Long templateId) {
        return resourceTemplateRelationMapper.selectByTemplateId(templateId);
    }

    /**
     * 根据模板ID删除关联关系
     * 
     * @param templateId 模板ID
     */
    public void deleteByTemplateId(Long templateId) {
        com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<ResourceTemplateRelation> queryWrapper =
            new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<>();
        queryWrapper.eq(ResourceTemplateRelation::getTemplateId, templateId);
        resourceTemplateRelationMapper.delete(queryWrapper);
    }

    /**
     * 根据模板ID和资源ID查询关联关系（唯一记录）
     * 
     * @param templateId 模板ID
     * @param resourceId 资源ID
     * @return 关联关系，如果不存在返回null
     */
    public ResourceTemplateRelation findByTemplateIdAndResourceId(Long templateId, Long resourceId) {
        return resourceTemplateRelationMapper.selectByTemplateIdAndResourceId(templateId, resourceId);
    }
}

