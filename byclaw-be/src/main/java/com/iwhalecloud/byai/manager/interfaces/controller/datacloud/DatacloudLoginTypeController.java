package com.iwhalecloud.byai.manager.interfaces.controller.datacloud;

import com.iwhalecloud.byai.manager.domain.datacloud.service.DatacloudLoginTypeService;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudLoginTypeBatchDeleteQO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudLoginTypeDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudLoginTypeQueryDTO;
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
 * 登录类型管理控制器
 * 
 * @author system
 * @date 2025-01-15
 */
@Api(tags = "登录类型管理")
@RestController
@RequestMapping("/datacloud/loginType")
public class DatacloudLoginTypeController {

    @Autowired
    private DatacloudLoginTypeService datacloudLoginTypeService;

    /**
     * 分页查询登录类型列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    @ApiOperation("分页查询登录类型列表")
    @PostMapping("/queryLoginTypeList")
    public ResponseUtil queryLoginTypeList(@RequestBody DatacloudLoginTypeQueryDTO query) {
        return datacloudLoginTypeService.queryLoginTypeList(query);
    }

    /**
     * 查询所有启用的登录类型
     * 
     * @param enterpriseId 企业ID
     * @return 启用的登录类型列表）/
    @ApiOperation("查询所有启用的登录类型")
    @GetMapping("/queryActiveLoginTypes")
    public ResponseUtil queryActiveLoginTypes(@ApiParam("企业ID") @RequestParam Long enterpriseId) {
        return datacloudLoginTypeService.queryActiveLoginTypes(enterpriseId);
    }

    /**
     * 根据ID查询登录类型详情
     * 
     * @param loginTypeId 登录类型ID
     * @return 登录类型详情
     */
    @ApiOperation("查询登录类型详情")
    @GetMapping("/queryLoginTypeById")
    public ResponseUtil queryLoginTypeById(@ApiParam("登录类型ID") @RequestParam Long loginTypeId) {
        return datacloudLoginTypeService.queryLoginTypeById(loginTypeId);
    }

    /**
     * 新增登录类型
     * 
     * @param dto 登录类型信息
     * @return 操作结果
     */
    @ApiOperation("新增登录类型")
    @PostMapping("/addLoginType")
    @ManageLogAnnotation(name = "登录类型管理", description = "新增登录类型")
    public ResponseUtil addLoginType(@Validated @RequestBody DatacloudLoginTypeDTO dto) {
        return datacloudLoginTypeService.addLoginType(dto);
    }

    /**
     * 更新登录类型
     * 
     * @param dto 登录类型信息
     * @return 操作结果
     */
    @ApiOperation("更新登录类型")
    @PostMapping("/updateLoginType")
    @ManageLogAnnotation(name = "登录类型管理", description = "更新登录类型")
    public ResponseUtil updateLoginType(@Validated @RequestBody DatacloudLoginTypeDTO dto) {
        return datacloudLoginTypeService.updateLoginType(dto);
    }

    /**
     * 删除登录类型
     * 
     * @param loginTypeId 登录类型ID
     * @return 操作结果
     */
    @ApiOperation("删除登录类型")
    @PostMapping("/deleteLoginType")
    @ManageLogAnnotation(name = "登录类型管理", description = "删除登录类型")
    public ResponseUtil deleteLoginType(@ApiParam("登录类型ID") @RequestParam Long loginTypeId) {
        return datacloudLoginTypeService.deleteLoginType(loginTypeId);
    }

    /**
     * 批量删除登录类型
     * 
     * @param qo 批量删除请求对象
     * @return 操作结果
     */
    @ApiOperation("批量删除登录类型")
    @PostMapping("/batchDeleteLoginTypes")
    @ManageLogAnnotation(name = "登录类型管理", description = "批量删除登录类型")
    public ResponseUtil batchDeleteLoginTypes(@Validated @RequestBody DatacloudLoginTypeBatchDeleteQO qo) {
        return datacloudLoginTypeService.batchDeleteLoginTypes(qo);
    }

    /**
     * 启用/禁用登录类型
     * 
     * @param loginTypeId 登录类型ID
     * @param isActive 是否启用户-禁用户-启用
     * @return 操作结果
     */
    @ApiOperation("启用/禁用登录类型")
    @PostMapping("/updateLoginTypeStatus")
    @ManageLogAnnotation(name = "登录类型管理", description = "启用/禁用登录类型")
    public ResponseUtil updateLoginTypeStatus(@ApiParam("登录类型ID") @RequestParam Long loginTypeId,
                                             @ApiParam("是否启用") @RequestParam Integer isActive) {
        return datacloudLoginTypeService.updateLoginTypeStatus(loginTypeId, isActive);
    }

    /**
     * 查询登录类型统计信息
     * 
     * @param enterpriseId 企业ID
     * @return 统计信息
     */
    @ApiOperation("查询登录类型统计信息")
    @GetMapping("/queryLoginTypeStatistics")
    public ResponseUtil queryLoginTypeStatistics(@ApiParam("企业ID") @RequestParam Long enterpriseId) {
        return datacloudLoginTypeService.queryLoginTypeStatistics(enterpriseId);
    }
}
