package com.iwhalecloud.byai.manager.interfaces.controller.datacloud;

import com.iwhalecloud.byai.manager.entity.datacloud.DataCloudScriptView;
import com.iwhalecloud.byai.manager.domain.datacloud.service.DataCloudScriptViewService;
import com.iwhalecloud.byai.manager.dto.datacloud.DataCloudScriptViewQueryDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptQueryDTO;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
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
 * 脚本采集管理控制器
 * 
 * @author system
 * @date 2025-01-15
 */
@Api(tags = "脚本采集管理")
@RestController
@RequestMapping("/datacloud/scriptView")
public class DatacloudScriptViewController {

    @Autowired
    private DataCloudScriptViewService datacloudScriptViewService;


    /**
     * 分页查询视图列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    @ApiOperation("分页查询视图列表")
    @PostMapping("/queryViewList")
    public ResponseUtil queryViewList(@RequestBody DatacloudScriptQueryDTO query) {
        return datacloudScriptViewService.queryViewList(query);
    }


    /**
     * 分页查询视图列表
     *
     * @param query 查询条件
     * @return 分页结果
     */
    @ApiOperation("分页查询视图列表")
    @PostMapping("/queryViewScriptList")
    public ResponseUtil queryViewScriptListByPage(@RequestBody DataCloudScriptViewQueryDTO query) {
        return datacloudScriptViewService.queryViewScriptListByPage(query);
    }


    /**
     * 新增脚本
     * 
     * @param dto 脚本信息
     * @return 操作结果
     */
    @ApiOperation("新增脚本视图")
    @PostMapping("/addScriptView")
    @ManageLogAnnotation(name = "脚本采集管理", description = "新增脚本视图")
    public ResponseUtil addScriptView(@Validated @RequestBody DataCloudScriptView dto) {
        return datacloudScriptViewService.addScriptView(dto);
    }

    /**
     * 更新脚本视图
     *
     * @param dto 脚本信息
     * @return 操作结果
     */
    @ApiOperation("更新脚本视图")
    @PostMapping("/updateScriptView")
    @ManageLogAnnotation(name = "脚本采集管理", description = "更新脚本视图")
    public ResponseUtil updateScriptView(@Validated @RequestBody DataCloudScriptView dto) {
        return datacloudScriptViewService.updateScriptView(dto);
    }


    /**
     * 批量删除脚本
     * 
     * @param qo 批量删除请求对象
     * @return 操作结果
     */
    @ApiOperation("批量删除脚本")
    @PostMapping("/batchDeleteView")
    @ManageLogAnnotation(name = "脚本采集管理", description = "批量删除脚本")
    public ResponseUtil batchDeleteViewList(@Validated @RequestBody DataCloudScriptViewQueryDTO qo) {
        return datacloudScriptViewService.batchDeleteViewList(qo);
    }



    /**
     * 发布场景
     * @param dto dto
     * @return 统计信息
     */
    @ApiOperation("发布场景")
    @PostMapping("/publish")
    public ResponseUtil publish(@RequestBody DataCloudScriptViewQueryDTO dto) {
        return datacloudScriptViewService.publish(dto);
    }


    /**
     * 发布场景
     * @param dto dto
     * @return 统计信息
     */
    @ApiOperation("取消发布场景")
    @PostMapping("/unPublish")
    public ResponseUtil unPublish(@RequestBody DataCloudScriptViewQueryDTO dto) {
        return datacloudScriptViewService.unPublish(dto);
    }
}
