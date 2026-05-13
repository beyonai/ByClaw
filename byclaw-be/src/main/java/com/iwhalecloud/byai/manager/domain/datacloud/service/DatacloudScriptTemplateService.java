package com.iwhalecloud.byai.manager.domain.datacloud.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptTemplate;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptTemplateQueryDTO;

import java.util.List;

/**
 * 脚本模板表服务接�? 用于管理脚本模板的业务逻辑操作
 * 
 * @author system
 * @date 2025-01-15
 */
public interface DatacloudScriptTemplateService extends IService<DatacloudScriptTemplate> {

    /**
     * 分页查询脚本模板列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    Page<DatacloudScriptTemplate> queryTemplateList(DatacloudScriptTemplateQueryDTO query);

    /**
     * 根据ID查询脚本模板详情
     * 
     * @param templateId 模板ID
     * @return 模板详情
     */
    DatacloudScriptTemplate queryTemplateById(Long templateId);

    /**
     * 保存脚本模板
     * 
     * @param template 模板信息
     * @return 保存结果
     */
    boolean saveTemplate(DatacloudScriptTemplate template);

    /**
     * 更新脚本模板
     * 
     * @param template 模板信息
     * @return 更新结果
     */
    boolean updateTemplate(DatacloudScriptTemplate template);

    /**
     * 删除脚本模板
     * 
     * @param templateId 模板ID
     * @return 删除结果
     */
    boolean deleteTemplate(Long templateId);

    /**
     * 批量删除脚本模板
     * 
     * @param templateIds 模板ID列表
     * @return 删除结果
     */
    boolean deleteTemplates(List<Long> templateIds);

    /**
     * 查询可用的脚本模板列�?
     * 
     * @param templateType 模板类型
     * @param framework 框架类型
     * @param enterpriseId 企业ID
     * @return 模板列表
     */
    List<DatacloudScriptTemplate> queryAvailableTemplates(String templateType, String framework, Long enterpriseId);

    /**
     * 启用/禁用脚本模板
     * 
     * @param templateId 模板ID
     * @param isActive 是否启用
     * @return 操作结果
     */
    boolean updateTemplateStatus(Long templateId, Integer isActive);

    /**
     * 检查模板名称是否重�?
     * 
     * @param templateName 模板名称
     * @param templateId 模板ID（更新时排除自己�?
     * @param enterpriseId 企业ID
     * @return 是否重复
     */
    boolean checkTemplateNameExists(String templateName, Long templateId, Long enterpriseId);

}
