package com.iwhalecloud.byai.manager.interfaces.controller.datacloud;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.iwhalecloud.byai.manager.domain.datacloud.service.DatacloudTargetScriptService;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptScenarioConfigQueryDTO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 场景配置管理控制器
 * 用于处理脚本场景配置的保存和查询
 * 
 * @author system
 * @date 2025-01-15
 */
@Api(tags = "场景配置管理")
@RestController
@RequestMapping("/datacloud/targetScript")
public class DatacloudScriptScenarioTargetScriptController {

    private static final Logger logger = LoggerFactory.getLogger(DatacloudScriptScenarioTargetScriptController.class);


    @Autowired
    private DatacloudTargetScriptService datacloudTargetScriptService;

    /**
     * 分页查询场景配置列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    @ApiOperation("分页查询场景目标组件列表")
    @PostMapping("/list")
    public ResponseUtil queryScenarioConfigList(@RequestBody @Validated DatacloudScriptScenarioConfigQueryDTO query) {
        logger.info("分页查询场景配置列表，查询条件：{}", query);
        return datacloudTargetScriptService.queryList(query);
    }


}
