package com.iwhalecloud.byai.manager.interfaces.controller.datacloud;

import com.iwhalecloud.byai.manager.domain.datacloud.service.DatacloudScriptService;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptBatchDeleteQO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptQueryDTO;
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
 * 脚本采集管理控制器
 * 
 * @author system
 * @date 2025-01-15
 */
@Api(tags = "脚本采集管理")
@RestController
@RequestMapping("/datacloud/script")
public class DatacloudScriptController {

    @Autowired
    private DatacloudScriptService datacloudScriptService;

    /**
     * 分页查询脚本列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    @ApiOperation("分页查询脚本列表")
    @PostMapping("/queryScriptList")
    public ResponseUtil queryScriptList(@RequestBody DatacloudScriptQueryDTO query) {
        return datacloudScriptService.queryScriptList(query);
    }

    /**
     * 根据ID查询脚本详情
     *
     * @return 脚本详情
     */
    @ApiOperation("查询脚本详情")
    @PostMapping("/queryScriptDesc")
    public ResponseUtil queryScriptDesc(@RequestBody DatacloudScriptQueryDTO query) {
        return datacloudScriptService.queryScriptDesc(query);
    }

    /**
     * 新增脚本
     * 
     * @param dto 脚本信息
     * @return 操作结果
     */
    @ApiOperation("新增脚本")
    @PostMapping("/addScript")
    @ManageLogAnnotation(name = "脚本采集管理", description = "新增脚本")
    public ResponseUtil addScript(@Validated @RequestBody DatacloudScriptDTO dto) {
        return datacloudScriptService.addScript(dto);
    }

    /**
     * 更新脚本
     * 
     * @param dto 脚本信息
     * @return 操作结果
     */
    @ApiOperation("更新脚本")
    @PostMapping("/updateScript")
    @ManageLogAnnotation(name = "脚本采集管理", description = "更新脚本")
    public ResponseUtil updateScript(@Validated @RequestBody DatacloudScriptDTO dto) {
        return datacloudScriptService.updateScript(dto);
    }

    /**
     * 删除脚本
     * 
     * @param scriptId 脚本ID
     * @return 操作结果
     */
    @ApiOperation("删除脚本")
    @PostMapping("/deleteScript")
    @ManageLogAnnotation(name = "脚本采集管理", description = "删除脚本")
    public ResponseUtil deleteScript(@ApiParam("脚本ID") @RequestParam Long scriptId) {
        return datacloudScriptService.deleteScript(scriptId);
    }

    /**
     * 批量删除脚本
     * 
     * @param qo 批量删除请求对象
     * @return 操作结果
     */
    @ApiOperation("批量删除脚本")
    @PostMapping("/batchDeleteScripts")
    @ManageLogAnnotation(name = "脚本采集管理", description = "批量删除脚本")
    public ResponseUtil batchDeleteScripts(@Validated @RequestBody DatacloudScriptBatchDeleteQO qo) {
        return datacloudScriptService.batchDeleteScripts(qo);
    }

    /**
     * 复制脚本
     * 
     * @param scriptId 原脚本ID
     * @param newScriptName 新脚本名称
     * @param creatorId 创建人ID
     * @return 操作结果
     */
    @ApiOperation("复制脚本")
    @PostMapping("/copyScript")
    @ManageLogAnnotation(name = "脚本采集管理", description = "复制脚本")
    public ResponseUtil copyScript(@ApiParam("原脚本ID") @RequestParam Long scriptId,
                                  @ApiParam("新脚本名称") @RequestParam String newScriptName,
                                  @ApiParam("创建人ID") @RequestParam Long creatorId) {
        return datacloudScriptService.copyScript(scriptId, newScriptName, creatorId);
    }

    /**
     * 查询热门脚本列表
     * 
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 热门脚本列表
     */
    @ApiOperation("查询热门脚本列表")
    @GetMapping("/queryPopularScripts")
    public ResponseUtil queryPopularScripts(@ApiParam("企业ID") @RequestParam Long enterpriseId,
                                           @ApiParam("限制数量") @RequestParam(defaultValue = "10") Integer limit) {
        return datacloudScriptService.queryPopularScripts(enterpriseId, limit);
    }

    /**
     * 查询最近创建的脚本列表
     * 
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 最近创建的脚本列表
     */
    @ApiOperation("查询最近创建的脚本列表")
    @GetMapping("/queryRecentScripts")
    public ResponseUtil queryRecentScripts(@ApiParam("企业ID") @RequestParam Long enterpriseId,
                                           @ApiParam("限制数量") @RequestParam(defaultValue = "10") Integer limit) {
        return datacloudScriptService.queryRecentScripts(enterpriseId, limit);
    }

    /**
     * 查询脚本统计信息
     * 
     * @param enterpriseId 企业ID
     * @return 统计信息
     */
    @ApiOperation("查询脚本统计信息")
    @GetMapping("/queryScriptStatistics")
    public ResponseUtil queryScriptStatistics(@ApiParam("企业ID") @RequestParam Long enterpriseId) {
        return datacloudScriptService.queryScriptStatistics(enterpriseId);
    }


    /**
     * 发布场景
     * @param dto dto
     * @return 统计信息
     */
    @ApiOperation("发布场景")
    @PostMapping("/publish")
    public ResponseUtil publishScript(@RequestBody DatacloudScriptQueryDTO dto) {
        return datacloudScriptService.publishScript(dto);
    }


    /**
     * 发布场景
     * @param dto dto
     * @return 统计信息
     */
    @ApiOperation("取消发布场景")
    @PostMapping("/unPublish")
    public ResponseUtil unPublishScript(@RequestBody DatacloudScriptQueryDTO dto) {
        return datacloudScriptService.unPublishScript(dto);
    }
}
