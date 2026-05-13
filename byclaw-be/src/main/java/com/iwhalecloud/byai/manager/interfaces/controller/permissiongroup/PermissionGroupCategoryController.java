package com.iwhalecloud.byai.manager.interfaces.controller.permissiongroup;

import com.iwhalecloud.byai.manager.application.service.permissiongroup.PermissionGroupCategoryApplicationService;
import com.iwhalecloud.byai.manager.dto.permissiongroup.CategoryDetailQueryDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.DeleteCategoryDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.PermissionGroupCategoryDTO;
import com.iwhalecloud.byai.manager.qo.permissiongroup.PermissionGroupCategoryQueryQO;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

/**
 * 权限组目录控制器
 * 提供权限组目录管理相关的REST API接口
 */
@RestController
@RequestMapping("/system/permissionGroupCategory")
@Validated
public class PermissionGroupCategoryController {

    @Autowired
    private PermissionGroupCategoryApplicationService permissionGroupCategoryApplicationService;

    /**
     * 分页查询目录列表
     *
     * @param queryQO 查询条件
     * @return 目录分页列表
     */
    @RequestMapping(value = "/queryPage", method = RequestMethod.POST)
    public ResponseUtil queryCategoryPage(@RequestBody PermissionGroupCategoryQueryQO queryQO) {
        return ResponseUtil.successResponse(permissionGroupCategoryApplicationService.queryCategoryPage(queryQO));
    }

    /**
     * 查询目录树
     *
     * @param queryQO 查询条件
     * @return 目录树
     */
    @RequestMapping(value = "/queryTree", method = RequestMethod.POST)
    public ResponseUtil queryCategoryTree(@RequestBody PermissionGroupCategoryQueryQO queryQO) {
        return permissionGroupCategoryApplicationService.queryCategoryTree(queryQO);
    }

    /**
     * 查询目录详情
     *
     * @param queryDTO 查询条件
     * @return 目录详情
     */
    @RequestMapping(value = "/detail", method = RequestMethod.POST)
    public ResponseUtil getCategoryDetail(@Valid @RequestBody CategoryDetailQueryDTO queryDTO) {
        return permissionGroupCategoryApplicationService.getCategoryDetail(queryDTO.getId());
    }

    /**
     * 新增目录
     *
     * @param categoryDTO 目录信息
     * @return 新增结果
     */
    @ManageLogAnnotation(name = "权限组目录管理", description = "新增目录")
    @RequestMapping(value = "/add", method = RequestMethod.POST)
    public ResponseUtil addCategory(@Valid @RequestBody PermissionGroupCategoryDTO categoryDTO) {
        return permissionGroupCategoryApplicationService.addCategory(categoryDTO);
    }

    /**
     * 修改目录
     *
     * @param categoryDTO 目录信息
     * @return 修改结果
     */
    @ManageLogAnnotation(name = "权限组目录管理", description = "修改目录")
    @RequestMapping(value = "/update", method = RequestMethod.POST)
    public ResponseUtil updateCategory(@Valid @RequestBody PermissionGroupCategoryDTO categoryDTO) {
        return permissionGroupCategoryApplicationService.updateCategory(categoryDTO);
    }

    /**
     * 删除目录
     *
     * @param deleteDTO 删除请求
     * @return 删除结果
     */
    @ManageLogAnnotation(name = "权限组目录管理", description = "删除目录")
    @RequestMapping(value = "/delete", method = RequestMethod.POST)
    public ResponseUtil deleteCategory(@Valid @RequestBody DeleteCategoryDTO deleteDTO) {
        return permissionGroupCategoryApplicationService.deleteCategory(deleteDTO.getId());
    }

}

