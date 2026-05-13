package com.iwhalecloud.byai.manager.domain.template.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.template.TemplateRuleInfo;
import com.iwhalecloud.byai.manager.mapper.template.TemplateRuleInfoMapper;
import com.iwhalecloud.byai.manager.qo.template.TemplateRuleInfoQueryQo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 模版规则信息Service
 * 
 * @author system
 * @date 2025-01-XX
 */
@Service
public class TemplateRuleInfoService {

    @Autowired
    private TemplateRuleInfoMapper templateRuleInfoMapper;

    /**
     * 保存模版规则信息
     * 
     * @param templateRuleInfo 模版规则信息
     */
    public void save(TemplateRuleInfo templateRuleInfo) {
        templateRuleInfoMapper.insert(templateRuleInfo);
    }

    /**
     * 根据ID查询模版规则信息
     * 
     * @param templateId 模版ID
     * @return 模版规则信息
     */
    public TemplateRuleInfo findById(Long templateId) {
        return templateRuleInfoMapper.selectById(templateId);
    }

    /**
     * 根据条件查询模版规则信息列表（分页）
     * 使用 MyBatis Plus 自动分页功能
     * 
     * @param page 分页对象
     * @param queryQo 查询条件
     * @return 分页结果
     */
    public Page<TemplateRuleInfo> findByCondition(Page<TemplateRuleInfo> page, TemplateRuleInfoQueryQo queryQo) {
        return templateRuleInfoMapper.selectByCondition(page, queryQo);
    }

    /**
     * 根据资源ID和用户ID查询模版规则信息列表
     * 
     * @param resourceId 资源ID
     * @param userId 用户ID
     * @return 模版规则信息列表
     */
    public List<TemplateRuleInfo> findByResourceIdAndUserId(Long resourceId, Long userId) {
        return templateRuleInfoMapper.selectByResourceIdAndUserId(resourceId, userId);
    }

    /**
     * 更新模版规则信息
     * 
     * @param templateRuleInfo 模版规则信息
     */
    public void update(TemplateRuleInfo templateRuleInfo) {
        templateRuleInfoMapper.updateById(templateRuleInfo);
    }

    /**
     * 根据ID删除模版规则信息
     * 
     * @param templateId 模版ID
     */
    public void deleteById(Long templateId) {
        templateRuleInfoMapper.deleteById(templateId);
    }
}

