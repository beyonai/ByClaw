package com.iwhalecloud.byai.manager.interfaces.controller.datacloud;

import com.iwhalecloud.byai.manager.domain.datacloud.service.DatacloudScriptScenarioService;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptScenarioBatchDeleteQO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptScenarioDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptScenarioQueryDTO;
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
 * 脚本场景管理控制器
 * 
 * @author system
 * @date 2025-01-15
 */
@Api(tags = "脚本场景管理")
@RestController
@RequestMapping("/datacloud/scenario")
public class DatacloudScriptScenarioController {

    @Autowired
    private DatacloudScriptScenarioService datacloudScriptScenarioService;

    /**
     * 分页查询脚本场景列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    @ApiOperation("分页查询脚本场景列表")
    @PostMapping("/queryScenarioList")
    public ResponseUtil queryScenarioList(@RequestBody DatacloudScriptScenarioQueryDTO query) {
        return datacloudScriptScenarioService.queryScenarioList(query);
    }

    /**
     * 查询脚本场景树形结构
     * 
     * @param enterpriseId 企业ID
     * @return 场景树形列表
     */
    @ApiOperation("查询脚本场景树形结构")
    @GetMapping("/queryScenarioTree")
    public ResponseUtil queryScenarioTree(@ApiParam("企业ID") @RequestParam Long enterpriseId) {
        return datacloudScriptScenarioService.queryScenarioTree(enterpriseId);
    }

    /**
     * 根据ID查询脚本场景详情
     * 
     * @param scenarioId 场景ID
     * @return 场景详情
     */
    @ApiOperation("查询脚本场景详情")
    @GetMapping("/queryScenarioById")
    public ResponseUtil queryScenarioById(@ApiParam("场景ID") @RequestParam Long scenarioId) {
        return datacloudScriptScenarioService.queryScenarioById(scenarioId);
    }

    /**
     * 新增脚本场景
     * 
     * @param dto 场景信息
     * @return 操作结果
     */
    @ApiOperation("新增脚本场景")
    @PostMapping("/addScenario")
    @ManageLogAnnotation(name = "脚本场景管理", description = "新增脚本场景")
    public ResponseUtil addScenario(@Validated @RequestBody DatacloudScriptScenarioDTO dto) {
        return datacloudScriptScenarioService.addScenario(dto);
    }

    /**
     * 更新脚本场景
     * 
     * @param dto 场景信息
     * @return 操作结果
     */
    @ApiOperation("更新脚本场景")
    @PostMapping("/updateScenario")
    @ManageLogAnnotation(name = "脚本场景管理", description = "更新脚本场景")
    public ResponseUtil updateScenario(@Validated @RequestBody DatacloudScriptScenarioDTO dto) {
        return datacloudScriptScenarioService.updateScenario(dto);
    }

    /**
     * 批量删除脚本场景
     * 
     * @param qo 批量删除请求对象
     * @return 操作结果
     */
    @ApiOperation("批量删除脚本场景")
    @PostMapping("/batchDeleteScenarios")
    @ManageLogAnnotation(name = "脚本场景管理", description = "批量删除脚本场景")
    public ResponseUtil batchDeleteScenarios(@Validated @RequestBody DatacloudScriptScenarioBatchDeleteQO qo) {
        return datacloudScriptScenarioService.batchDeleteScenarios(qo);
    }
}
