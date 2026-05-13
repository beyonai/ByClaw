package com.iwhalecloud.byai.manager.interfaces.controller.datacloud;

import com.iwhalecloud.byai.manager.domain.datacloud.service.DatacloudScriptCategoryService;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptCategoryBatchDeleteQO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptCategoryDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptCategoryQueryDTO;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 脚本分类管理控制器
 * 
 * @author system
 * @date 2025-01-15
 */
@Api(tags = "脚本分类管理")
@RestController
@RequestMapping("/datacloud/scriptCategory")
public class DatacloudScriptCategoryController {

    @Autowired
    private DatacloudScriptCategoryService datacloudScriptCategoryService;

    /**
     * 分页查询脚本分类列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    @ApiOperation("分页查询脚本分类列表")
    @PostMapping("/queryScriptCategoryList")
    public ResponseUtil queryScriptCategoryList(@RequestBody DatacloudScriptCategoryQueryDTO query) {
        return datacloudScriptCategoryService.queryScriptCategoryList(query);
    }

    /**
     * 查询脚本分类树形结构
     * 
     * @param enterpriseId 企业ID
     * @return 分类树形列表
     */
    @ApiOperation("查询脚本分类树形结构")
    @GetMapping("/queryScriptCategoryTree")
    public ResponseUtil queryScriptCategoryTree(@ApiParam("企业ID") @RequestParam Long enterpriseId) {
        return datacloudScriptCategoryService.queryScriptCategoryTree(enterpriseId);
    }

    /**
     * 根据ID查询脚本分类详情
     * 
     * @param categoryId 分类ID
     * @return 分类详情
     */
    @ApiOperation("查询脚本分类详情")
    @GetMapping("/queryScriptCategoryById")
    public ResponseUtil queryScriptCategoryById(@ApiParam("分类ID") @RequestParam Long categoryId) {
        return datacloudScriptCategoryService.queryScriptCategoryById(categoryId);
    }

    /**
     * 新增脚本分类
     * 
     * @param dto 分类信息
     * @return 操作结果
     */
    @ApiOperation("新增脚本分类")
    @PostMapping("/addScriptCategory")
    @ManageLogAnnotation(name = "脚本分类管理", description = "新增脚本分类")
    public ResponseUtil addScriptCategory(@Validated @RequestBody DatacloudScriptCategoryDTO dto) {
        return datacloudScriptCategoryService.addScriptCategory(dto);
    }

    /**
     * 更新脚本分类
     * 
     * @param dto 分类信息
     * @return 操作结果
     */
    @ApiOperation("更新脚本分类")
    @PostMapping("/updateScriptCategory")
    @ManageLogAnnotation(name = "脚本分类管理", description = "更新脚本分类")
    public ResponseUtil updateScriptCategory(@Validated @RequestBody DatacloudScriptCategoryDTO dto) {
        return datacloudScriptCategoryService.updateScriptCategory(dto);
    }

    /**
     * 删除脚本分类
     * 
     * @param categoryId 分类ID
     * @return 操作结果
     */
    @ApiOperation("删除脚本分类")
    @PostMapping("/deleteScriptCategory")
    @ManageLogAnnotation(name = "脚本分类管理", description = "删除脚本分类")
    public ResponseUtil deleteScriptCategory(@ApiParam("分类ID") @RequestParam Long categoryId) {
        return datacloudScriptCategoryService.deleteScriptCategory(categoryId);
    }

    /**
     * 批量删除脚本分类
     * 
     * @param qo 批量删除请求对象
     * @return 操作结果
     */
    @ApiOperation("批量删除脚本分类")
    @PostMapping("/batchDeleteScriptCategories")
    @ManageLogAnnotation(name = "脚本分类管理", description = "批量删除脚本分类")
    public ResponseUtil batchDeleteScriptCategories(@Validated @RequestBody DatacloudScriptCategoryBatchDeleteQO qo) {
        return datacloudScriptCategoryService.batchDeleteScriptCategories(qo);
    }

    /**
     * 查询分类统计信息
     * 
     * @param enterpriseId 企业ID
     * @return 统计信息
     */
    @ApiOperation("查询分类统计信息")
    @GetMapping("/queryCategoryStatistics")
    public ResponseUtil queryCategoryStatistics(@ApiParam("企业ID") @RequestParam Long enterpriseId) {
        return datacloudScriptCategoryService.queryCategoryStatistics(enterpriseId);
    }
}
