package com.iwhalecloud.byai.manager.interfaces.controller.permissiongroup;

import com.iwhalecloud.byai.manager.application.service.permissiongroup.PermissionGroupApplicationService;
import com.iwhalecloud.byai.manager.dto.permissiongroup.AuthorizedObjectDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.AuthorizedObjectDataPermissionDetailQueryDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.AuthorizedObjectDataPermissionListQueryDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.BatchDeleteAuthorizedObjectDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.BatchDeleteAuthorizedObjectDataPermissionDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.BatchDeleteExcludedObjectDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.BatchDeleteResourcePermissionDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.DeleteAuthorizedObjectDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.DeleteAuthorizedObjectDataPermissionDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.DeletePermissionGroupDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.DimensionListPermissionQueryDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.ExcludedObjectDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.PermissionGroupAndCatalogQueryDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.PermissionGroupBasicInfoDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.PermissionGroupDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.PermissionGroupDetailQueryDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.ResourceAssociatePermissionGroupsDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.ResourceAttributePermissionByResourceQueryDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.ResourceAttributePermissionQueryDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.ResourceQueryAssociatedPermissionGroupsDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.UpdateAuthorizedObjectDataPermissionDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.UpdateDataPermissionDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.UpdateResourceAttributePermissionDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.UpdateResourcePermissionDTO;
import com.iwhalecloud.byai.manager.qo.permissiongroup.AuthorizedObjectQueryQO;
import com.iwhalecloud.byai.manager.qo.permissiongroup.AuthorizedUserQueryQO;
import com.iwhalecloud.byai.manager.qo.permissiongroup.AvailableObjectQueryQO;
import com.iwhalecloud.byai.manager.qo.permissiongroup.PermissionGroupQueryQO;
import com.iwhalecloud.byai.manager.qo.permissiongroup.ResourcePermissionQueryQO;
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
 * 权限组控制器
 * 提供权限组管理相关的REST API接口
 */
@RestController
@RequestMapping("/system/permissionGroup")
@Validated
public class PermissionGroupController {

    @Autowired
    private PermissionGroupApplicationService permissionGroupApplicationService;

    /**
     * 分页查询权限组列表
     *
     * @param queryQO 查询条件
     * @return 权限组分页列表
     */
    @RequestMapping(value = "/queryPage", method = RequestMethod.POST)
    public ResponseUtil queryPermissionGroupPage(@RequestBody PermissionGroupQueryQO queryQO) {
        return ResponseUtil.successResponse(permissionGroupApplicationService.queryPermissionGroupPage(queryQO));
    }

    /**
     * 查询权限组详情
     *
     * @param queryDTO 查询条件
     * @return 权限组详情
     */
    @RequestMapping(value = "/detail", method = RequestMethod.POST)
    public ResponseUtil getPermissionGroupDetail(@Valid @RequestBody PermissionGroupDetailQueryDTO queryDTO) {
        return permissionGroupApplicationService.getPermissionGroupDetail(queryDTO.getId());
    }

    /**
     * 新增权限组
     *
     * @param permissionGroupDTO 权限组信息
     * @return 新增结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "新增权限组")
    @RequestMapping(value = "/add", method = RequestMethod.POST)
    public ResponseUtil addPermissionGroup(@Valid @RequestBody PermissionGroupDTO permissionGroupDTO) {
        return permissionGroupApplicationService.addPermissionGroup(permissionGroupDTO);
    }

    /**
     * 修改权限组
     *
     * @param permissionGroupDTO 权限组信息
     * @return 修改结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "修改权限组")
    @RequestMapping(value = "/update", method = RequestMethod.POST)
    public ResponseUtil updatePermissionGroup(@Valid @RequestBody PermissionGroupDTO permissionGroupDTO) {
        return permissionGroupApplicationService.updatePermissionGroup(permissionGroupDTO);
    }

    /**
     * 删除权限组
     *
     * @param deleteDTO 删除请求
     * @return 删除结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "删除权限组")
    @RequestMapping(value = "/delete", method = RequestMethod.POST)
    public ResponseUtil deletePermissionGroup(@Valid @RequestBody DeletePermissionGroupDTO deleteDTO) {
        return permissionGroupApplicationService.deletePermissionGroup(deleteDTO.getId());
    }

    /**
     * 分页查询授权对象列表
     *
     * @param queryQO 查询条件
     * @return 授权对象分页列表
     */
    @RequestMapping(value = "/authorizedObject/queryPage", method = RequestMethod.POST)
    public ResponseUtil queryAuthorizedObjectPage(@Valid @RequestBody AuthorizedObjectQueryQO queryQO) {
        return ResponseUtil.successResponse(permissionGroupApplicationService.queryAuthorizedObjectPage(queryQO));
    }

    /**
     * 添加授权对象
     *
     * @param authorizedObjectDTO 授权对象信息
     * @return 添加结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "添加授权对象")
    @RequestMapping(value = "/authorizedObject/add", method = RequestMethod.POST)
    public ResponseUtil addAuthorizedObjects(@Valid @RequestBody AuthorizedObjectDTO authorizedObjectDTO) {
        return permissionGroupApplicationService.addAuthorizedObjects(authorizedObjectDTO);
    }

    /**
     * 删除授权对象
     *
     * @param deleteDTO 删除请求
     * @return 删除结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "删除授权对象")
    @RequestMapping(value = "/authorizedObject/delete", method = RequestMethod.POST)
    public ResponseUtil deleteAuthorizedObject(@Valid @RequestBody DeleteAuthorizedObjectDTO deleteDTO) {
        return permissionGroupApplicationService.deleteAuthorizedObject(deleteDTO.getId());
    }

    /**
     * 批量删除授权对象
     *
     * @param batchDeleteDTO 批量删除请求
     * @return 删除结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "批量删除授权对象")
    @RequestMapping(value = "/authorizedObject/batchDelete", method = RequestMethod.POST)
    public ResponseUtil batchDeleteAuthorizedObjects(@Valid @RequestBody BatchDeleteAuthorizedObjectDTO batchDeleteDTO) {
        return permissionGroupApplicationService.batchDeleteAuthorizedObjects(batchDeleteDTO.getIds());
    }

    /**
     * 分页查询排除对象列表
     *
     * @param queryQO 查询条件
     * @return 排除对象分页列表
     */
    @RequestMapping(value = "/excludedObject/queryPage", method = RequestMethod.POST)
    public ResponseUtil queryExcludedObjectPage(@Valid @RequestBody AuthorizedObjectQueryQO queryQO) {
        return ResponseUtil.successResponse(permissionGroupApplicationService.queryExcludedObjectPage(queryQO));
    }

    /**
     * 添加排除对象
     *
     * @param excludedObjectDTO 排除对象信息
     * @return 添加结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "添加排除对象")
    @RequestMapping(value = "/excludedObject/add", method = RequestMethod.POST)
    public ResponseUtil addExcludedObjects(@Valid @RequestBody ExcludedObjectDTO excludedObjectDTO) {
        return permissionGroupApplicationService.addExcludedObjects(excludedObjectDTO);
    }

    /**
     * 批量删除排除对象
     *
     * @param batchDeleteDTO 批量删除请求
     * @return 删除结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "批量删除排除对象")
    @RequestMapping(value = "/excludedObject/batchDelete", method = RequestMethod.POST)
    public ResponseUtil batchDeleteExcludedObjects(@Valid @RequestBody BatchDeleteExcludedObjectDTO batchDeleteDTO) {
        return permissionGroupApplicationService.batchDeleteExcludedObjects(batchDeleteDTO);
    }

    /**
     * 更新权限组基本信息
     *
     * @param basicInfoDTO 基本信息
     * @return 更新结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "更新基本信息")
    @RequestMapping(value = "/updateBasicInfo", method = RequestMethod.POST)
    public ResponseUtil updateBasicInfo(@Valid @RequestBody PermissionGroupBasicInfoDTO basicInfoDTO) {
        return permissionGroupApplicationService.updateBasicInfo(basicInfoDTO);
    }

    /**
     * 分页查询权限组授权资源列表
     *
     * @param queryQO 查询条件
     * @return 授权资源分页列表
     */
    @RequestMapping(value = "/resourcePermission/queryPage", method = RequestMethod.POST)
    public ResponseUtil queryResourcePermissionPage(@Valid @RequestBody ResourcePermissionQueryQO queryQO) {
        return ResponseUtil.successResponse(permissionGroupApplicationService.queryResourcePermissionPage(queryQO));
    }

    /**
     * 更新功能权限
     *
     * @param updateDTO 功能权限配置
     * @return 更新结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "更新功能权限")
    @RequestMapping(value = "/updateResourcePermissions", method = RequestMethod.POST)
    public ResponseUtil updateResourcePermissions(@Valid @RequestBody UpdateResourcePermissionDTO updateDTO) {
        return permissionGroupApplicationService.updateResourcePermissions(updateDTO);
    }

    /**
     * 更新数据权限
     *
     * @param updateDTO 数据权限配置
     * @return 更新结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "更新数据权限")
    @RequestMapping(value = "/updateDataPermission", method = RequestMethod.POST)
    public ResponseUtil updateDataPermission(@Valid @RequestBody UpdateDataPermissionDTO updateDTO) {
        return permissionGroupApplicationService.updateDataPermission(updateDTO);
    }

    /**
     * 批量删除权限组资源
     *
     * @param batchDeleteDTO 批量删除请求
     * @return 删除结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "批量删除权限组资源")
    @RequestMapping(value = "/resourcePermission/batchDelete", method = RequestMethod.POST)
    public ResponseUtil batchDeleteResourcePermissions(@Valid @RequestBody BatchDeleteResourcePermissionDTO batchDeleteDTO) {
        return permissionGroupApplicationService.batchDeleteResourcePermissions(batchDeleteDTO);
    }

    /**
     * 分页查询权限组授权用户列表（去重）
     *
     * @param queryQO 查询条件
     * @return 授权用户分页列表
     */
    @RequestMapping(value = "/authorizedUser/queryPage", method = RequestMethod.POST)
    public ResponseUtil queryAuthorizedUserPage(@Valid @RequestBody AuthorizedUserQueryQO queryQO) {
        return ResponseUtil.successResponse(permissionGroupApplicationService.queryAuthorizedUserPage(queryQO));
    }

    /**
     * 分页查询可用授权对象
     *
     * @param queryQO 查询条件
     * @return 可用授权对象分页列表
     */
    @RequestMapping(value = "/availableObject/queryPage", method = RequestMethod.POST)
    public ResponseUtil queryAvailableObjectPage(@Valid @RequestBody AvailableObjectQueryQO queryQO) {
        return ResponseUtil.successResponse(permissionGroupApplicationService.queryAvailableObjectPage(queryQO));
    }

    /**
     * 查询指定资源的所有属性权限配置
     *
     * @param queryDTO 查询条件
     * @return 资源属性权限列表
     */
    @RequestMapping(value = "/resourceAttributePermission/queryList", method = RequestMethod.POST)
    public ResponseUtil queryResourceAttributePermissions(
            @Valid @RequestBody ResourceAttributePermissionQueryDTO queryDTO) {
        return permissionGroupApplicationService.queryResourceAttributePermissions(queryDTO.getResourceId());
    }

    /**
     * 查询指定资源的属性权限列表
     *
     * @param queryDTO 查询条件
     * @return 资源属性权限列表
     */
    @RequestMapping(value = "/resourceAttributePermission/queryByResource", method = RequestMethod.POST)
    public ResponseUtil queryResourceAttributePermissionsByResource(
            @Valid @RequestBody ResourceAttributePermissionByResourceQueryDTO queryDTO) {
        return permissionGroupApplicationService.queryResourceAttributePermissionsByResource(queryDTO.getResourceId());
    }

    /**
     * 更新资源属性权限
     *
     * @param updateDTO 资源属性权限配置
     * @return 更新结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "更新资源属性权限")
    @RequestMapping(value = "/updateResourceAttributePermissions", method = RequestMethod.POST)
    public ResponseUtil updateResourceAttributePermissions(@Valid @RequestBody UpdateResourceAttributePermissionDTO updateDTO) {
        return permissionGroupApplicationService.updateResourceAttributePermissions(updateDTO);
    }

    /**
     * 查询权限组和目录联合信息
     * 根据查询条件同时返回符合条件的目录列表和权限组列表（含目录及标签信息）
     *
     * @param queryDTO 查询请求参数
     * @return 权限组和目录联合查询结果
     */
    @RequestMapping(value = "/qryPrivGroupAndCatalog", method = RequestMethod.POST)
    public ResponseUtil qryPrivGroupAndCatalog(@RequestBody PermissionGroupAndCatalogQueryDTO queryDTO) {
        return permissionGroupApplicationService.queryPermissionGroupAndCatalog(queryDTO.getQueryCondition());
    }

    /**
     * 查询权限组授权对象数据权限列表
     *
     * @param queryDTO 查询请求参数
     * @return 授权对象数据权限列表
     */
    @RequestMapping(value = "/authorizedObjectDataPermission/queryList", method = RequestMethod.POST)
    public ResponseUtil queryAuthorizedObjectDataPermissions(@Valid @RequestBody AuthorizedObjectDataPermissionListQueryDTO queryDTO) {
        return permissionGroupApplicationService.queryAuthorizedObjectDataPermissions(queryDTO);
    }

    /**
     * 查询权限组授权对象数据权限详情
     *
     * @param queryDTO 查询请求参数
     * @return 授权对象数据权限详情
     */
    @RequestMapping(value = "/authorizedObjectDataPermission/detail", method = RequestMethod.POST)
    public ResponseUtil queryAuthorizedObjectDataPermissionDetail(@Valid @RequestBody AuthorizedObjectDataPermissionDetailQueryDTO queryDTO) {
        return permissionGroupApplicationService.queryAuthorizedObjectDataPermissionDetail(queryDTO);
    }

    /**
     * 更新授权对象数据权限
     *
     * @param updateDTO 更新请求参数
     * @return 操作结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "更新授权对象数据权限")
    @RequestMapping(value = "/authorizedObjectDataPermission/update", method = RequestMethod.POST)
    public ResponseUtil updateAuthorizedObjectDataPermission(@Valid @RequestBody UpdateAuthorizedObjectDataPermissionDTO updateDTO) {
        return permissionGroupApplicationService.updateAuthorizedObjectDataPermission(updateDTO);
    }

    /**
     * 删除授权对象数据权限
     *
     * @param deleteDTO 删除请求参数
     * @return 操作结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "删除用户数据权限")
    @RequestMapping(value = "/authorizedObjectDataPermission/delete", method = RequestMethod.POST)
    public ResponseUtil deleteAuthorizedObjectDataPermission(@Valid @RequestBody DeleteAuthorizedObjectDataPermissionDTO deleteDTO) {
        return permissionGroupApplicationService.deleteAuthorizedObjectDataPermission(deleteDTO.getPermissionGroupId(), deleteDTO.getUserId());
    }

    /**
     * 批量删除授权对象数据权限
     *
     * @param batchDeleteDTO 批量删除请求参数
     * @return 操作结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "批量删除授权对象数据权限")
    @RequestMapping(value = "/authorizedObjectDataPermission/batchDelete", method = RequestMethod.POST)
    public ResponseUtil batchDeleteAuthorizedObjectDataPermissions(@Valid @RequestBody BatchDeleteAuthorizedObjectDataPermissionDTO batchDeleteDTO) {
        return permissionGroupApplicationService.batchDeleteAuthorizedObjectDataPermissions(batchDeleteDTO);
    }

    /**
     * 检查当前用户是否有访问指定维度列表的权限
     *
     * @param queryDTO 查询请求参数
     * @return 权限检查结果，返回布尔值表示是否有权限
     */
    @RequestMapping(value = "/checkDimensionListPermission", method = RequestMethod.POST)
    public ResponseUtil checkDimensionListPermission(@Valid @RequestBody DimensionListPermissionQueryDTO queryDTO) {
        return permissionGroupApplicationService.checkDimensionListPermission(queryDTO);
    }

    /**
     * 资源关联多个权限组
     * 为指定资源批量关联多个权限组（先删除原有关联，再添加新关联）
     *
     * @param associateDTO 资源关联权限组请求
     * @return 操作结果
     */
    @ManageLogAnnotation(name = "权限组管理", description = "资源关联权限组")
    @RequestMapping(value = "/resource/associatePermissionGroups", method = RequestMethod.POST)
    public ResponseUtil associateResourceToPermissionGroups(@Valid @RequestBody ResourceAssociatePermissionGroupsDTO associateDTO) {
        return permissionGroupApplicationService.associateResourceToPermissionGroups(associateDTO);
    }

    /**
     * 查询资源关联的权限组信息
     *
     * @param queryDTO 查询请求参数
     * @return 权限组列表
     */
    @RequestMapping(value = "/resource/queryAssociatedPermissionGroups", method = RequestMethod.POST)
    public ResponseUtil queryAssociatedPermissionGroupsByResource(@Valid @RequestBody ResourceQueryAssociatedPermissionGroupsDTO queryDTO) {
        return permissionGroupApplicationService.queryAssociatedPermissionGroupsByResource(queryDTO);
    }

}

