package com.iwhalecloud.byai.manager.domain.datacloud.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptTemplate;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptTemplateDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptTemplateQueryDTO;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 脚本模板应用服务 用于处理脚本模板相关的业务逻辑
 * 
 * @author system
 * @date 2025-01-15
 */
@Service
public class DatacloudScriptTemplateApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(DatacloudScriptTemplateApplicationService.class);


    @Autowired
    private DatacloudScriptTemplateService datacloudScriptTemplateService;

    /**
     * 分页查询脚本模板列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    public ResponseUtil queryTemplateList(DatacloudScriptTemplateQueryDTO query) {
        try {
            logger.info("查询脚本模板列表，查询条件：{}", query);

            Page<DatacloudScriptTemplate> page = datacloudScriptTemplateService.queryTemplateList(query);

            return ResponseUtil.success(PageHelperUtil.toPageInfo(page));
        }
        catch (Exception e) {
            logger.error("查询脚本模板列表失败", e);
            return ResponseUtil.fail("查询脚本模板列表失败：" + e.getMessage());
        }
    }

    /**
     * 根据ID查询脚本模板详情
     * 
     * @param templateId 模板ID
     * @return 模板详情
     */
    public ResponseUtil queryTemplateById(Long templateId) {
        try {
            logger.info("查询脚本模板详情，templateId：{}", templateId);

            DatacloudScriptTemplate template = datacloudScriptTemplateService.queryTemplateById(templateId);
            if (template == null) {
                return ResponseUtil.fail("模板不存在");
            }

            DatacloudScriptTemplateDTO dto = convertToDTO(template);
            return ResponseUtil.success(dto);
        }
        catch (Exception e) {
            logger.error("查询脚本模板详情失败，templateId：{}", templateId, e);
            return ResponseUtil.fail("查询脚本模板详情失败：" + e.getMessage());
        }
    }

    /**
     * 保存脚本模板
     * 
     * @param dto 模板信息
     * @return 保存结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil saveTemplate(DatacloudScriptTemplateDTO dto) {
        try {
            dto.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
            dto.setCreatorId(CurrentUserHolder.getCurrentUserId());
            logger.info("保存脚本模板，模板信息：{}", dto);

            // 参数校验
            if (dto == null) {
                return ResponseUtil.fail("模板信息不能为空");
            }
            if (dto.getTemplateName() == null || dto.getTemplateName().trim().isEmpty()) {
                return ResponseUtil.fail("模板名称不能为空");
            }
            if (dto.getTemplateType() == null || dto.getTemplateType().trim().isEmpty()) {
                return ResponseUtil.fail("模板类型不能为空");
            }
            if (dto.getFramework() == null || dto.getFramework().trim().isEmpty()) {
                return ResponseUtil.fail("框架类型不能为空");
            }
            if (dto.getEnterpriseId() == null) {
                return ResponseUtil.fail("企业ID不能为空");
            }
            if (dto.getCreatorId() == null) {
                return ResponseUtil.fail("创建人ID不能为空");
            }

            // 转换为实体
            DatacloudScriptTemplate template = convertToEntity(dto);

            // 保存
            boolean result = datacloudScriptTemplateService.saveTemplate(template);
            if (result) {
                return ResponseUtil.success("保存成功");
            }
            else {
                return ResponseUtil.fail("保存失败");
            }
        }
        catch (Exception e) {
            logger.error("保存脚本模板失败", e);
            return ResponseUtil.fail("保存脚本模板失败：" + e.getMessage());
        }
    }

    /**
     * 更新脚本模板
     * 
     * @param dto 模板信息
     * @return 更新结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil updateTemplate(DatacloudScriptTemplateDTO dto) {
        try {
            dto.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
            dto.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            logger.info("更新脚本模板，模板信息：{}", dto);

            // 参数校验
            if (dto == null || dto.getTemplateId() == null) {
                return ResponseUtil.fail("模板信息或模板ID不能为空");
            }

            // 检查模板是否存在
            DatacloudScriptTemplate existingTemplate = datacloudScriptTemplateService
                .queryTemplateById(dto.getTemplateId());
            if (existingTemplate == null) {
                return ResponseUtil.fail("模板不存在");
            }

            // 转换为实体
            DatacloudScriptTemplate template = convertToEntity(dto);

            // 更新
            boolean result = datacloudScriptTemplateService.updateTemplate(template);
            if (result) {
                return ResponseUtil.success("更新成功");
            }
            else {
                return ResponseUtil.fail("更新失败");
            }
        }
        catch (Exception e) {
            logger.error("更新脚本模板失败", e);
            return ResponseUtil.fail("更新脚本模板失败：" + e.getMessage());
        }
    }

    /**
     * 删除脚本模板
     * 
     * @param templateId 模板ID
     * @return 删除结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil deleteTemplate(Long templateId) {
        try {
            logger.info("删除脚本模板，templateId：{}", templateId);

            if (templateId == null) {
                return ResponseUtil.fail("模板ID不能为空");
            }

            boolean result = datacloudScriptTemplateService.deleteTemplate(templateId);
            if (result) {
                return ResponseUtil.success("删除成功");
            }
            else {
                return ResponseUtil.fail("删除失败");
            }
        }
        catch (Exception e) {
            logger.error("删除脚本模板失败，templateId：{}", templateId, e);
            return ResponseUtil.fail("删除脚本模板失败：" + e.getMessage());
        }
    }

    /**
     * 批量删除脚本模板
     * 
     * @param templateIds 模板ID列表
     * @return 删除结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil deleteTemplates(List<Long> templateIds) {
        try {
            logger.info("批量删除脚本模板，templateIds：{}", templateIds);

            if (templateIds == null || templateIds.isEmpty()) {
                return ResponseUtil.fail("模板ID列表不能为空");
            }

            boolean result = datacloudScriptTemplateService.deleteTemplates(templateIds);
            if (result) {
                return ResponseUtil.success("批量删除成功");
            }
            else {
                return ResponseUtil.fail("批量删除失败");
            }
        }
        catch (Exception e) {
            logger.error("批量删除脚本模板失败，templateIds：{}", templateIds, e);
            return ResponseUtil.fail("批量删除脚本模板失败：" + e.getMessage());
        }
    }

    /**
     * 查询可用的脚本模板列表
     * 
     * @param templateType 模板类型
     * @param framework 框架类型
     * @param enterpriseId 企业ID
     * @return 模板列表
     */
    public ResponseUtil queryAvailableTemplates(String templateType, String framework, Long enterpriseId) {
        try {
            logger.info("查询可用脚本模板，templateType：{}，framework：{}，enterpriseId：{}", templateType, framework,
                enterpriseId);

            List<DatacloudScriptTemplate> templates = datacloudScriptTemplateService
                .queryAvailableTemplates(templateType, framework, enterpriseId);

            List<DatacloudScriptTemplateDTO> dtoList = templates.stream().map(this::convertToDTO)
                .collect(Collectors.toList());

            return ResponseUtil.success(dtoList);
        }
        catch (Exception e) {
            logger.error("查询可用脚本模板失败，templateType：{}，framework：{}，enterpriseId：{}", templateType, framework,
                enterpriseId, e);
            return ResponseUtil.fail("查询可用脚本模板失败：" + e.getMessage());
        }
    }

    /**
     * 启用/禁用脚本模板
     * 
     * @param templateId 模板ID
     * @param isActive 是否启用
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil updateTemplateStatus(Long templateId, Integer isActive) {
        try {
            logger.info("更新脚本模板状态，templateId：{}，isActive：{}", templateId, isActive);

            if (templateId == null) {
                return ResponseUtil.fail("模板ID不能为空");
            }
            if (isActive == null || (isActive != 0 && isActive != 1)) {
                return ResponseUtil.fail("启用状态必须为0或1");
            }

            boolean result = datacloudScriptTemplateService.updateTemplateStatus(templateId, isActive);
            if (result) {
                return ResponseUtil.success("状态更新成功");
            }
            else {
                return ResponseUtil.fail("状态更新失败");
            }
        }
        catch (Exception e) {
            logger.error("更新脚本模板状态失败，templateId：{}，isActive：{}", templateId, isActive, e);
            return ResponseUtil.fail("更新脚本模板状态失败：" + e.getMessage());
        }
    }

    /**
     * 检查模板名称是否重复
     * 
     * @param templateName 模板名称
     * @param templateId 模板ID（更新时排除自己）
     * @param enterpriseId 企业ID
     * @return 检查结果
     */
    public ResponseUtil checkTemplateNameExists(String templateName, Long templateId, Long enterpriseId) {
        try {
            logger.info("检查模板名称是否重复，templateName：{}，templateId：{}，enterpriseId：{}", templateName, templateId,
                enterpriseId);

            boolean exists = datacloudScriptTemplateService.checkTemplateNameExists(templateName, templateId,
                enterpriseId);

            return ResponseUtil.success(exists);
        }
        catch (Exception e) {
            logger.error("检查模板名称是否重复失败，templateName：{}，templateId：{}，enterpriseId：{}", templateName, templateId,
                enterpriseId, e);
            return ResponseUtil.fail("检查模板名称是否重复失败：" + e.getMessage());
        }
    }

    /**
     * 实体转DTO
     * 
     * @param template 实体对象
     * @return DTO对象
     */
    private DatacloudScriptTemplateDTO convertToDTO(DatacloudScriptTemplate template) {
        if (template == null) {
            return null;
        }

        DatacloudScriptTemplateDTO dto = new DatacloudScriptTemplateDTO();
        BeanUtils.copyProperties(template, dto);
        return dto;
    }

    /**
     * DTO转实体
     * 
     * @param dto DTO对象
     * @return 实体对象
     */
    private DatacloudScriptTemplate convertToEntity(DatacloudScriptTemplateDTO dto) {
        if (dto == null) {
            return null;
        }

        DatacloudScriptTemplate template = new DatacloudScriptTemplate();
        BeanUtils.copyProperties(dto, template);
        return template;
    }
}
