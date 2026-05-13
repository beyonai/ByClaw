package com.iwhalecloud.byai.manager.domain.datacloud.service.impl;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import cn.hutool.core.util.IdUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptTemplate;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudScriptTemplateMapper;
import com.iwhalecloud.byai.manager.domain.datacloud.service.DatacloudScriptTemplateService;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptTemplateQueryDTO;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;
import java.util.List;

/**
 * 脚本模板表服务实现类 用于管理脚本模板的业务逻辑操作
 * 
 * @author system
 * @date 2025-01-15
 */
@Service
public class DatacloudScriptTemplateServiceImpl extends
    ServiceImpl<DatacloudScriptTemplateMapper, DatacloudScriptTemplate> implements DatacloudScriptTemplateService {

    private static final Logger logger = LoggerFactory.getLogger(DatacloudScriptTemplateServiceImpl.class);


    @Autowired
    private DatacloudScriptTemplateMapper datacloudScriptTemplateMapper;

    @Override
    public Page<DatacloudScriptTemplate> queryTemplateList(DatacloudScriptTemplateQueryDTO query) {
        try {
            Page<DatacloudScriptTemplate> page = new Page<>(query.getPageNum(), query.getPageSize());

            LambdaQueryWrapper<DatacloudScriptTemplate> queryWrapper = new LambdaQueryWrapper<>();

            // 构建查询条件
            if (StringUtil.isNotEmpty(query.getTemplateName())) {
                queryWrapper.like(DatacloudScriptTemplate::getTemplateName, query.getTemplateName());
            }
            if (StringUtil.isNotEmpty(query.getTemplateType())) {
                queryWrapper.eq(DatacloudScriptTemplate::getTemplateType, query.getTemplateType());
            }
            if (StringUtil.isNotEmpty(query.getFramework())) {
                queryWrapper.eq(DatacloudScriptTemplate::getFramework, query.getFramework());
            }
            if (query.getIsActive() != null) {
                queryWrapper.eq(DatacloudScriptTemplate::getIsActive, query.getIsActive());
            }
            if (query.getEnterpriseId() != null) {
                queryWrapper.eq(DatacloudScriptTemplate::getEnterpriseId, query.getEnterpriseId());
            }
            if (query.getCreatorId() != null) {
                queryWrapper.eq(DatacloudScriptTemplate::getCreatorId, query.getCreatorId());
            }

            // 按创建时间倒序排列
            queryWrapper.orderByDesc(DatacloudScriptTemplate::getCreateTime);

            // // 如果不包含内容，则排除大字段
            // if (!Boolean.TRUE.equals(query.getIncludeContent())) {
            // queryWrapper.select(DatacloudScriptTemplate.class, info ->
            // !info.getColumn().equals("py_template_content") &&
            // !info.getColumn().equals("node_template_content") &&
            // !info.getColumn().equals("meta_infos")
            // );
            // }

            return this.page(page, queryWrapper);
        }
        catch (Exception e) {
            logger.error("查询脚本模板列表失败", e);
            throw new BaseException(I18nUtil.get("datacloud.script.template.query.list.failed", e.getMessage()));
        }
    }

    @Override
    public DatacloudScriptTemplate queryTemplateById(Long templateId) {
        try {
            if (templateId == null) {
                throw new IllegalArgumentException(I18nUtil.get("datacloud.script.template.id.not.empty"));
            }
            return this.getById(templateId);
        }
        catch (Exception e) {
            logger.error("查询脚本模板详情失败，templateId: {}", templateId, e);
            throw new BaseException(I18nUtil.get("datacloud.script.template.query.detail.failed", e.getMessage()));
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean saveTemplate(DatacloudScriptTemplate template) {
        try {
            if (template == null) {
                throw new IllegalArgumentException(I18nUtil.get("datacloud.script.template.info.not.empty"));
            }

            // 检查模板名称是否重复
            if (checkTemplateNameExists(template.getTemplateName(), null, template.getEnterpriseId())) {
                throw new BaseException(I18nUtil.get("datacloud.script.template.name.exists"));
            }

            template.setTemplateId(IdUtil.getSnowflakeNextId());

            // 设置创建时间
            template.setCreateTime(new Date());

            return this.save(template);
        }
        catch (Exception e) {
            logger.error("保存脚本模板失败", e);
            throw new BaseException(I18nUtil.get("datacloud.script.template.save.failed", e.getMessage()));
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean updateTemplate(DatacloudScriptTemplate template) {
        try {
            if (template == null || template.getTemplateId() == null) {
                throw new IllegalArgumentException(I18nUtil.get("datacloud.script.template.info.or.id.not.empty"));
            }

            // 检查模板名称是否重复（排除自己）
            if (checkTemplateNameExists(template.getTemplateName(), template.getTemplateId(),
                template.getEnterpriseId())) {
                throw new BaseException(I18nUtil.get("datacloud.script.template.name.exists"));
            }

            // 设置更新时间
            template.setUpdateTime(new Date());

            return this.updateById(template);
        }
        catch (Exception e) {
            logger.error("更新脚本模板失败，templateId: {}", template.getTemplateId(), e);
            throw new BaseException(I18nUtil.get("datacloud.script.template.update.failed", e.getMessage()));
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean deleteTemplate(Long templateId) {
        try {
            if (templateId == null) {
                throw new IllegalArgumentException(I18nUtil.get("datacloud.script.template.id.not.empty"));
            }

            // 检查模板是否存在
            DatacloudScriptTemplate template = this.getById(templateId);
            if (template == null) {
                throw new BaseException(I18nUtil.get("datacloud.script.template.not.exist"));
            }

            return this.removeById(templateId);
        }
        catch (Exception e) {
            logger.error("删除脚本模板失败，templateId: {}", templateId, e);
            throw new BaseException(I18nUtil.get("datacloud.script.template.delete.failed", e.getMessage()));
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean deleteTemplates(List<Long> templateIds) {
        try {
            if (templateIds == null || templateIds.isEmpty()) {
                throw new IllegalArgumentException(I18nUtil.get("datacloud.script.template.id.list.not.empty"));
            }

            return this.removeByIds(templateIds);
        }
        catch (Exception e) {
            logger.error("批量删除脚本模板失败，templateIds: {}", templateIds, e);
            throw new BaseException(I18nUtil.get("datacloud.script.template.batch.delete.failed", e.getMessage()));
        }
    }

    @Override
    public List<DatacloudScriptTemplate> queryAvailableTemplates(String templateType, String framework,
        Long enterpriseId) {
        try {
            return datacloudScriptTemplateMapper.selectAvailableTemplates(templateType, framework, enterpriseId);
        }
        catch (Exception e) {
            logger.error("查询可用脚本模板失败，templateType: {}, framework: {}, enterpriseId: {}", templateType, framework,
                enterpriseId, e);
            throw new BaseException(I18nUtil.get("datacloud.script.template.query.available.failed", e.getMessage()));
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean updateTemplateStatus(Long templateId, Integer isActive) {
        try {
            if (templateId == null) {
                throw new IllegalArgumentException(I18nUtil.get("datacloud.script.template.id.not.empty"));
            }
            if (isActive == null || (isActive != 0 && isActive != 1)) {
                throw new IllegalArgumentException(I18nUtil.get("datacloud.script.template.status.invalid"));
            }

            DatacloudScriptTemplate template = new DatacloudScriptTemplate();
            template.setTemplateId(templateId);
            template.setIsActive(isActive);
            template.setUpdateTime(new Date());

            return this.updateById(template);
        }
        catch (Exception e) {
            logger.error("更新脚本模板状态失败，templateId: {}, isActive: {}", templateId, isActive, e);
            throw new BaseException(I18nUtil.get("datacloud.script.template.update.status.failed", e.getMessage()));
        }
    }

    @Override
    public boolean checkTemplateNameExists(String templateName, Long templateId, Long enterpriseId) {
        try {
            if (StringUtil.isEmpty(templateName) || enterpriseId == null) {
                return false;
            }

            LambdaQueryWrapper<DatacloudScriptTemplate> queryWrapper = new LambdaQueryWrapper<>();
            queryWrapper.eq(DatacloudScriptTemplate::getTemplateName, templateName)
                .eq(DatacloudScriptTemplate::getEnterpriseId, enterpriseId);

            // 更新时排除自己
            if (templateId != null) {
                queryWrapper.ne(DatacloudScriptTemplate::getTemplateId, templateId);
            }

            return this.count(queryWrapper) > 0;
        }
        catch (Exception e) {
            logger.error("检查模板名称是否存在失败，templateName: {}, templateId: {}, enterpriseId: {}", templateName,
                templateId, enterpriseId, e);
            return false;
        }
    }
}
