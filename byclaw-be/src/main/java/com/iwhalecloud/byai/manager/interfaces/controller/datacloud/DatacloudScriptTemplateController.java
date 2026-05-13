package com.iwhalecloud.byai.manager.interfaces.controller.datacloud;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.iwhalecloud.byai.manager.domain.datacloud.service.DatacloudScriptTemplateApplicationService;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptTemplateBatchDeleteDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptTemplateDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptTemplateQueryDTO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 脚本模板管理控制器 用于管理脚本模板的REST API接口
 * 
 * @author system
 * @date 2025-01-15
 */
@RestController
@RequestMapping("/api/datacloud/scriptTemplate")
@Tag(name = "脚本模板管理", description = "脚本模板相关的API接口")
public class DatacloudScriptTemplateController {

    private static final Logger logger = LoggerFactory.getLogger(DatacloudScriptTemplateController.class);


    @Autowired
    private DatacloudScriptTemplateApplicationService datacloudScriptTemplateApplicationService;

    /**
     * 分页查询脚本模板列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    @PostMapping("/list")
    @Operation(summary = "分页查询脚本模板列表", description = "根据条件分页查询脚本模板列表")
    public ResponseUtil queryTemplateList(@RequestBody @Valid DatacloudScriptTemplateQueryDTO query) {
        logger.info("分页查询脚本模板列表，查询条件：{}", query);
        return datacloudScriptTemplateApplicationService.queryTemplateList(query);
    }

    /**
     * 根据ID查询脚本模板详情
     * 
     * @param templateId 模板ID
     * @return 模板详情
     */
    @GetMapping("/{templateId}")
    @Operation(summary = "查询脚本模板详情", description = "根据模板ID查询脚本模板详情")
    public ResponseUtil queryTemplateById(
        @Parameter(description = "模板ID", required = true) @PathVariable Long templateId) {
        logger.info("查询脚本模板详情，templateId：{}", templateId);
        return datacloudScriptTemplateApplicationService.queryTemplateById(templateId);
    }

    /**
     * 保存脚本模板
     * 
     * @param dto 模板信息
     * @return 保存结果
     */
    @PostMapping("/save")
    @Operation(summary = "保存脚本模板", description = "新增脚本模板")
    public ResponseUtil saveTemplate(@RequestBody @Valid DatacloudScriptTemplateDTO dto) {
        logger.info("保存脚本模板，模板信息：{}", dto);
        return datacloudScriptTemplateApplicationService.saveTemplate(dto);
    }

    /**
     * 更新脚本模板
     * 
     * @param dto 模板信息
     * @return 更新结果
     */
    @PostMapping("/update")
    @Operation(summary = "更新脚本模板", description = "更新脚本模板信息")
    public ResponseUtil updateTemplate(@RequestBody @Valid DatacloudScriptTemplateDTO dto) {
        logger.info("更新脚本模板，模板信息：{}", dto);
        return datacloudScriptTemplateApplicationService.updateTemplate(dto);
    }

    /**
     * 删除脚本模板
     * 
     * @param templateId 模板ID
     * @return 删除结果
     */
    @DeleteMapping("/{templateId}")
    @Operation(summary = "删除脚本模板", description = "根据模板ID删除脚本模板")
    public ResponseUtil deleteTemplate(
        @Parameter(description = "模板ID", required = true) @PathVariable Long templateId) {
        logger.info("删除脚本模板，templateId：{}", templateId);
        return datacloudScriptTemplateApplicationService.deleteTemplate(templateId);
    }

    /**
     * 批量删除脚本模板
     * 
     * @param dto 批量删除请求
     * @return 删除结果
     */
    @PostMapping("/batch-delete")
    @Operation(summary = "批量删除脚本模板", description = "批量删除脚本模板")
    public ResponseUtil deleteTemplates(@RequestBody @Valid DatacloudScriptTemplateBatchDeleteDTO dto) {
        logger.info("批量删除脚本模板，templateIds：{}", dto.getTemplateIds());
        return datacloudScriptTemplateApplicationService.deleteTemplates(dto.getTemplateIds());
    }

    /**
     * 查询可用的脚本模板列表）
     * 
     * @param templateType 模板类型
     * @param framework 框架类型
     * @param enterpriseId 企业ID
     * @return 模板列表
     */
    @GetMapping("/available")
    @Operation(summary = "查询可用脚本模板", description = "查询可用的脚本模板列表")
    public ResponseUtil queryAvailableTemplates(
        @Parameter(description = "模板类型") @RequestParam(required = false) String templateType,
        @Parameter(description = "框架类型") @RequestParam(required = false) String framework,
        @Parameter(description = "企业ID", required = true) @RequestParam Long enterpriseId) {
        logger.info("查询可用脚本模板，templateType：{}，framework：{}，enterpriseId：{}", templateType, framework, enterpriseId);
        return datacloudScriptTemplateApplicationService.queryAvailableTemplates(templateType, framework, enterpriseId);
    }

    /**
     * 启用/禁用脚本模板
     * 
     * @param templateId 模板ID
     * @param isActive 是否启用
     * @return 操作结果
     */
    @PostMapping("/{templateId}/status")
    @Operation(summary = "更新脚本模板状态", description = "启用或禁用脚本模式")
    public ResponseUtil updateTemplateStatus(
        @Parameter(description = "模板ID", required = true) @PathVariable Long templateId,
        @Parameter(description = "是否启用户-禁用户-启用", required = true) @RequestParam Integer isActive) {
        logger.info("更新脚本模板状态，templateId：{}，isActive：{}", templateId, isActive);
        return datacloudScriptTemplateApplicationService.updateTemplateStatus(templateId, isActive);
    }

    /**
     * 检查模板名称是否重复）
     * 
     * @param templateName 模板名称
     * @param templateId 模板ID（更新时排除自己? * @param enterpriseId 企业ID
     * @return 检查结?
     */
    @GetMapping("/check-name")
    @Operation(summary = "检查模板名称是否重给", description = "检查模板名称是否重给")
    public ResponseUtil checkTemplateNameExists(
        @Parameter(description = "模板名称", required = true) @RequestParam String templateName,
        @Parameter(description = "模板ID（更新时排除自己") @RequestParam(required = false) Long templateId,
        @Parameter(description = "企业ID", required = true) @RequestParam Long enterpriseId) {
        logger.info("检查模板名称是否重复，templateName：{}，templateId：{}，enterpriseId：{}", templateName, templateId,
            enterpriseId);
        return datacloudScriptTemplateApplicationService.checkTemplateNameExists(templateName, templateId,
            enterpriseId);
    }
}