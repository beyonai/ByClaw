package com.iwhalecloud.byai.manager.interfaces.controller.datacloud;

import com.iwhalecloud.byai.manager.domain.datacloud.service.DatacloudScriptExecutionService;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptExecutionBatchDeleteQO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptExecutionDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptExecutionQueryDTO;
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
 * 脚本执行记录管理控制器
 * 
 * @author system
 * @date 2025-01-15
 */
@Api(tags = "脚本执行记录管理")
@RestController
@RequestMapping("/datacloud/scriptExecution")
public class DatacloudScriptExecutionController {

    @Autowired
    private DatacloudScriptExecutionService datacloudScriptExecutionService;

    /**
     * 分页查询脚本执行记录列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    @ApiOperation("分页查询脚本执行记录列表")
    @PostMapping("/queryScriptExecutionList")
    public ResponseUtil queryScriptExecutionList(@RequestBody DatacloudScriptExecutionQueryDTO query) {
        return datacloudScriptExecutionService.queryScriptExecutionList(query);
    }

    /**
     * 根据脚本ID查询执行记录列表
     * 
     * @param scriptId 脚本ID
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 执行记录列表
     */
    @ApiOperation("根据脚本ID查询执行记录列表")
    @GetMapping("/queryExecutionsByScriptId")
    public ResponseUtil queryExecutionsByScriptId(@ApiParam("脚本ID") @RequestParam Long scriptId,
        @ApiParam("企业ID") @RequestParam Long enterpriseId,
        @ApiParam("限制数量") @RequestParam(defaultValue = "10") Integer limit) {
        return datacloudScriptExecutionService.queryExecutionsByScriptId(scriptId, enterpriseId, limit);
    }

    /**
     * 根据ID查询脚本执行记录详情
     * 
     * @param executionId 执行记录ID
     * @return 执行记录详情
     */
    @ApiOperation("查询脚本执行记录详情")
    @GetMapping("/queryScriptExecutionById")
    public ResponseUtil queryScriptExecutionById(@ApiParam("执行记录ID") @RequestParam Long executionId) {
        return datacloudScriptExecutionService.queryScriptExecutionById(executionId);
    }

    /**
     * 新增脚本执行记录
     * 
     * @param dto 执行记录信息
     * @return 操作结果
     */
    @ApiOperation("新增脚本执行记录")
    @PostMapping("/addScriptExecution")
    @ManageLogAnnotation(name = "脚本执行记录管理", description = "新增脚本执行记录")
    public ResponseUtil addScriptExecution(@Validated @RequestBody DatacloudScriptExecutionDTO dto) {
        return datacloudScriptExecutionService.addScriptExecution(dto);
    }

    /**
     * 更新脚本执行记录
     * 
     * @param dto 执行记录信息
     * @return 操作结果
     */
    @ApiOperation("更新脚本执行记录")
    @PostMapping("/updateScriptExecution")
    @ManageLogAnnotation(name = "脚本执行记录管理", description = "更新脚本执行记录")
    public ResponseUtil updateScriptExecution(@Validated @RequestBody DatacloudScriptExecutionDTO dto) {
        return datacloudScriptExecutionService.updateScriptExecution(dto);
    }

    /**
     * 删除脚本执行记录
     * 
     * @param executionId 执行记录ID
     * @return 操作结果
     */
    @ApiOperation("删除脚本执行记录")
    @PostMapping("/deleteScriptExecution")
    @ManageLogAnnotation(name = "脚本执行记录管理", description = "删除脚本执行记录")
    public ResponseUtil deleteScriptExecution(@ApiParam("执行记录ID") @RequestParam Long executionId) {
        return datacloudScriptExecutionService.deleteScriptExecution(executionId);
    }

    /**
     * 批量删除脚本执行记录
     * 
     * @param qo 批量删除请求对象
     * @return 操作结果
     */
    @ApiOperation("批量删除脚本执行记录")
    @PostMapping("/batchDeleteScriptExecutions")
    @ManageLogAnnotation(name = "脚本执行记录管理", description = "批量删除脚本执行记录")
    public ResponseUtil batchDeleteScriptExecutions(@Validated @RequestBody DatacloudScriptExecutionBatchDeleteQO qo) {
        return datacloudScriptExecutionService.batchDeleteScriptExecutions(qo);
    }

    /**
     * 取消正在执行的脚本
     * 
     * @param executionId 执行记录ID
     * @return 操作结果
     */
    @ApiOperation("取消正在执行的脚本")
    @PostMapping("/cancelScriptExecution")
    @ManageLogAnnotation(name = "脚本执行记录管理", description = "取消正在执行的脚本")
    public ResponseUtil cancelScriptExecution(@ApiParam("执行记录ID") @RequestParam Long executionId) {
        return datacloudScriptExecutionService.cancelScriptExecution(executionId);
    }

    /**
     * 查询执行记录统计信息
     * 
     * @param enterpriseId 企业ID
     * @return 统计信息
     */
    @ApiOperation("查询执行记录统计信息")
    @GetMapping("/queryExecutionStatistics")
    public ResponseUtil queryExecutionStatistics(@ApiParam("企业ID") @RequestParam Long enterpriseId) {
        return datacloudScriptExecutionService.queryExecutionStatistics(enterpriseId);
    }

    /**
     * 查询执行状态统计
     * 
     * @param enterpriseId 企业ID
     * @return 执行状态统计
     */
    @ApiOperation("查询执行状态统计")
    @GetMapping("/queryExecutionStatusStatistics")
    public ResponseUtil queryExecutionStatusStatistics(@ApiParam("企业ID") @RequestParam Long enterpriseId) {
        return datacloudScriptExecutionService.queryExecutionStatusStatistics(enterpriseId);
    }

    /**
     * 查询脚本执行统计
     * 
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 脚本执行统计
     */
    @ApiOperation("查询脚本执行统计")
    @GetMapping("/queryScriptExecutionStatistics")
    public ResponseUtil queryScriptExecutionStatistics(@ApiParam("企业ID") @RequestParam Long enterpriseId,
        @ApiParam("限制数量") @RequestParam(defaultValue = "10") Integer limit) {
        return datacloudScriptExecutionService.queryScriptExecutionStatistics(enterpriseId, limit);
    }

    /**
     * 查询最近执行记录）
     * 
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 最近执行记录列表）
     */
    @ApiOperation("查询最近执行记录")
    @GetMapping("/queryRecentExecutions")
    public ResponseUtil queryRecentExecutions(@ApiParam("企业ID") @RequestParam Long enterpriseId,
        @ApiParam("限制数量") @RequestParam(defaultValue = "10") Integer limit) {
        return datacloudScriptExecutionService.queryRecentExecutions(enterpriseId, limit);
    }
}
