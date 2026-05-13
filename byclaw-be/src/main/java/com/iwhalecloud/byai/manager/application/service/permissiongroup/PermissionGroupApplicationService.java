package com.iwhalecloud.byai.manager.application.service.permissiongroup;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.domain.permissiongroup.service.PermissionGroupService;
import com.iwhalecloud.byai.manager.dto.permissiongroup.AuthorizedObjectDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.AuthorizedObjectDataPermissionDetailQueryDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.AuthorizedObjectDataPermissionListQueryDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.BatchDeleteAuthorizedObjectDataPermissionDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.BatchDeleteExcludedObjectDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.BatchDeleteResourcePermissionDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.DimensionListPermissionQueryDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.ExcludedObjectDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.PermissionGroupBasicInfoDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.PermissionGroupDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.ResourceAssociatePermissionGroupsDTO;
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
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AddResultVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AuthorizedObjectDataPermissionVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AuthorizedObjectVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AuthorizedUserVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AvailableObjectVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.DimensionListPermissionVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.PermissionGroupAndCatalogResultVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.PermissionGroupVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.PermissionResourceVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.ResourceAttributePermissionVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 权限组应用服务
 * 负责权限组相关的应用层业务编排
 */
@Service
public class PermissionGroupApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(PermissionGroupApplicationService.class);


    @Autowired
    private PermissionGroupService permissionGroupService;

    /**
     * 分页查询权限组列表
     *
     * @param queryQO 查询条件
     * @return 权限组分页列表
     */
    public PageInfo<PermissionGroupVO> queryPermissionGroupPage(PermissionGroupQueryQO queryQO) {
        try {
            Page<PermissionGroupVO> page = permissionGroupService.queryPermissionGroupPage(queryQO);
            return PageHelperUtil.toPageInfo(page);
        } catch (BaseException e) {
            logger.error("查询权限组列表失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询权限组列表异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.query.list.failed");
        }
    }

    /**
     * 查询权限组详情
     *
     * @param id 权限组ID
     * @return 响应结果
     */
    public ResponseUtil getPermissionGroupDetail(Long id) {
        try {
            PermissionGroupVO detail = permissionGroupService.getPermissionGroupDetail(id);
            return ResponseUtil.successResponse(detail);
        } catch (BaseException e) {
            logger.error("查询权限组详情失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询权限组详情异常: id={}, {}", id, e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.query.detail.failed");
        }
    }

    /**
     * 新增权限组
     *
     * @param permissionGroupDTO 权限组信息
     * @return 响应结果，包含新增权限组ID
     */
    public ResponseUtil addPermissionGroup(PermissionGroupDTO permissionGroupDTO) {
        try {
            // 权限校验
            checkPermission();

            Long id = permissionGroupService.addPermissionGroup(permissionGroupDTO);
            // 使用AddResultVO包装Long类型ID，防止前端精度丢失
            return ResponseUtil.successResponse("新增权限组成功", AddResultVO.of(id));
        } catch (BaseException e) {
            logger.error("新增权限组失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("新增权限组异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.add.failed");
        }
    }

    /**
     * 修改权限组
     *
     * @param permissionGroupDTO 权限组信息
     * @return 响应结果
     */
    public ResponseUtil updatePermissionGroup(PermissionGroupDTO permissionGroupDTO) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupService.updatePermissionGroup(permissionGroupDTO);
            return ResponseUtil.successResponse("修改权限组成功");
        } catch (BaseException e) {
            logger.error("修改权限组失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("修改权限组异常: id={}, {}", permissionGroupDTO.getId(), e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.update.failed");
        }
    }

    /**
     * 删除权限组
     *
     * @param id 权限组ID
     * @return 响应结果
     */
    public ResponseUtil deletePermissionGroup(Long id) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupService.deletePermissionGroup(id);
            return ResponseUtil.successResponse("删除权限组成功");
        } catch (BaseException e) {
            logger.error("删除权限组失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("删除权限组异常: id={}, {}", id, e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.delete.failed");
        }
    }

    /**
     * 分页查询授权对象列表
     *
     * @param queryQO 查询条件
     * @return 授权对象分页列表
     */
    public PageInfo<AuthorizedObjectVO> queryAuthorizedObjectPage(AuthorizedObjectQueryQO queryQO) {
        try {
            Page<AuthorizedObjectVO> page = permissionGroupService.queryAuthorizedObjectPage(queryQO);
            return PageHelperUtil.toPageInfo(page);
        } catch (BaseException e) {
            logger.error("查询授权对象列表失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询授权对象列表异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.query.authorized.objects.failed");
        }
    }

    /**
     * 添加授权对象
     *
     * @param authorizedObjectDTO 授权对象信息
     * @return 响应结果
     */
    public ResponseUtil addAuthorizedObjects(AuthorizedObjectDTO authorizedObjectDTO) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupService.addAuthorizedObjects(authorizedObjectDTO);
            return ResponseUtil.successResponse("添加授权对象成功");
        } catch (BaseException e) {
            logger.error("添加授权对象失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("添加授权对象异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.add.authorized.object.failed");
        }
    }

    /**
     * 删除授权对象
     *
     * @param id 关联ID
     * @return 响应结果
     */
    public ResponseUtil deleteAuthorizedObject(Long id) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupService.deleteAuthorizedObject(id);
            return ResponseUtil.successResponse("删除授权对象成功");
        } catch (BaseException e) {
            logger.error("删除授权对象失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("删除授权对象异常: id={}, {}", id, e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.delete.authorized.object.failed");
        }
    }

    /**
     * 更新权限组基本信息
     *
     * @param basicInfoDTO 基本信息
     * @return 响应结果
     */
    public ResponseUtil updateBasicInfo(PermissionGroupBasicInfoDTO basicInfoDTO) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupService.updateBasicInfo(basicInfoDTO);
            return ResponseUtil.successResponse("更新基本信息成功");
        } catch (BaseException e) {
            logger.error("更新基本信息失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("更新基本信息异常: id={}, {}", basicInfoDTO.getId(), e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.update.basic.info.failed");
        }
    }

    /**
     * 更新功能权限
     *
     * @param updateDTO 功能权限配置
     * @return 响应结果
     */
    public ResponseUtil updateResourcePermissions(UpdateResourcePermissionDTO updateDTO) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupService.updateResourcePermissions(updateDTO);
            return ResponseUtil.successResponse("更新功能权限成功");
        } catch (BaseException e) {
            logger.error("更新功能权限失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("更新功能权限异常: permissionGroupId={}, {}", updateDTO.getPermissionGroupId(), e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.update.resource.permission.failed");
        }
    }

    /**
     * 更新数据权限
     *
     * @param updateDTO 数据权限配置
     * @return 响应结果
     */
    public ResponseUtil updateDataPermission(UpdateDataPermissionDTO updateDTO) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupService.updateDataPermission(updateDTO);
            return ResponseUtil.successResponse("更新数据权限成功");
        } catch (BaseException e) {
            logger.error("更新数据权限失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("更新数据权限异常: permissionGroupId={}, {}", updateDTO.getPermissionGroupId(), e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.update.data.permission.failed");
        }
    }

    /**
     * 批量删除授权对象
     *
     * @param ids 关联ID列表
     * @return 响应结果
     */
    public ResponseUtil batchDeleteAuthorizedObjects(List<Long> ids) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupService.batchDeleteAuthorizedObjects(ids);
            return ResponseUtil.successResponse("批量删除授权对象成功");
        } catch (BaseException e) {
            logger.error("批量删除授权对象失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("批量删除授权对象异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.batch.delete.authorized.objects.failed");
        }
    }

    /**
     * 分页查询排除对象列表
     *
     * @param queryQO 查询条件
     * @return 排除对象分页列表
     */
    public PageInfo<AuthorizedObjectVO> queryExcludedObjectPage(AuthorizedObjectQueryQO queryQO) {
        try {
            Page<AuthorizedObjectVO> page = permissionGroupService.queryExcludedObjectPage(queryQO);
            return PageHelperUtil.toPageInfo(page);
        } catch (BaseException e) {
            logger.error("查询排除对象列表失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询排除对象列表异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.query.excluded.objects.failed");
        }
    }

    /**
     * 添加排除对象
     *
     * @param excludedObjectDTO 排除对象信息
     * @return 响应结果
     */
    public ResponseUtil addExcludedObjects(ExcludedObjectDTO excludedObjectDTO) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupService.addExcludedObjects(excludedObjectDTO);
            return ResponseUtil.successResponse("添加排除对象成功");
        } catch (BaseException e) {
            logger.error("添加排除对象失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("添加排除对象异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.add.excluded.object.failed");
        }
    }

    /**
     * 批量删除排除对象
     *
     * @param batchDeleteDTO 批量删除请求
     * @return 响应结果
     */
    public ResponseUtil batchDeleteExcludedObjects(BatchDeleteExcludedObjectDTO batchDeleteDTO) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupService.batchDeleteExcludedObjects(batchDeleteDTO.getPermissionGroupId(), batchDeleteDTO.getIds());
            return ResponseUtil.successResponse("批量删除排除对象成功");
        } catch (BaseException e) {
            logger.error("批量删除排除对象失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("批量删除排除对象异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.batch.delete.excluded.objects.failed");
        }
    }

    /**
     * 批量删除权限组资源
     *
     * @param batchDeleteDTO 批量删除请求
     * @return 响应结果
     */
    public ResponseUtil batchDeleteResourcePermissions(BatchDeleteResourcePermissionDTO batchDeleteDTO) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupService.batchDeletePermissionGroupResources(
                    batchDeleteDTO.getPermissionGroupId(), batchDeleteDTO.getResourceIds());
            return ResponseUtil.successResponse("批量删除权限组资源成功");
        } catch (BaseException e) {
            logger.error("批量删除权限组资源失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("批量删除权限组资源异常: permissionGroupId={}, {}", 
                    batchDeleteDTO.getPermissionGroupId(), e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.batch.delete.resources.failed");
        }
    }

    /**
     * 分页查询权限组授权用户列表（去重）
     *
     * @param queryQO 查询条件
     * @return 授权用户分页列表
     */
    public PageInfo<AuthorizedUserVO> queryAuthorizedUserPage(AuthorizedUserQueryQO queryQO) {
        try {
            Page<AuthorizedUserVO> page = permissionGroupService.queryAuthorizedUserPage(queryQO);
            return PageHelperUtil.toPageInfo(page);
        } catch (BaseException e) {
            logger.error("查询权限组授权用户列表失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询权限组授权用户列表异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.query.authorized.users.failed");
        }
    }

    /**
     * 分页查询可用授权对象
     *
     * @param queryQO 查询条件
     * @return 可用授权对象分页列表
     */
    public PageInfo<AvailableObjectVO> queryAvailableObjectPage(AvailableObjectQueryQO queryQO) {
        try {
            Page<AvailableObjectVO> page = permissionGroupService.queryAvailableObjectPage(queryQO);
            return PageHelperUtil.toPageInfo(page);
        } catch (BaseException e) {
            logger.error("查询可用授权对象列表失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询可用授权对象列表异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.query.available.objects.failed");
        }
    }

    /**
     * 分页查询权限组授权资源列表
     *
     * @param queryQO 查询条件
     * @return 授权资源分页列表
     */
    public PageInfo<PermissionResourceVO> queryResourcePermissionPage(ResourcePermissionQueryQO queryQO) {
        try {
            Page<PermissionResourceVO> page = permissionGroupService.queryResourcePermissionPage(queryQO);
            return PageHelperUtil.toPageInfo(page);
        } catch (BaseException e) {
            logger.error("查询授权资源列表失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询授权资源列表异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.query.authorized.resources.failed");
        }
    }

    /**
     * 查询指定资源的所有属性权限配置
     *
     * @param resourceId 资源ID
     * @return 响应结果
     */
    public ResponseUtil queryResourceAttributePermissions(Long resourceId) {
        try {
            List<ResourceAttributePermissionVO> list = permissionGroupService.queryResourceAttributePermissions(resourceId);
            return ResponseUtil.successResponse(list);
        } catch (BaseException e) {
            logger.error("查询资源属性权限列表失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询资源属性权限列表异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.query.resource.attribute.permissions.failed");
        }
    }

    /**
     * 查询指定资源的属性权限列表
     *
     * @param resourceId 资源ID
     * @return 响应结果
     */
    public ResponseUtil queryResourceAttributePermissionsByResource(Long resourceId) {
        try {
            List<ResourceAttributePermissionVO> list = permissionGroupService.queryResourceAttributePermissionsByResource(resourceId);
            return ResponseUtil.successResponse(list);
        } catch (BaseException e) {
            logger.error("查询资源属性权限列表失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询资源属性权限列表异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.query.resource.attribute.permissions.failed");
        }
    }

    /**
     * 更新资源属性权限
     *
     * @param updateDTO 资源属性权限配置
     * @return 响应结果
     */
    public ResponseUtil updateResourceAttributePermissions(UpdateResourceAttributePermissionDTO updateDTO) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupService.updateResourceAttributePermissions(updateDTO);
            return ResponseUtil.successResponse("更新资源属性权限成功");
        } catch (BaseException e) {
            logger.error("更新资源属性权限失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {

            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.update.resource.attribute.permission.failed");
        }
    }

    /**
     * 权限校验
     * 检查当前用户是否有权限操作权限组
     */
    private void checkPermission() {
        // 只有平台管理员可以操作权限组
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.no.permission");
        }
    }

    /**
     * 查询权限组和目录联合信息
     * 根据查询条件同时返回符合条件的目录列表和权限组列表（含目录及标签信息）
     *
     * @param queryCondition 查询条件（模糊匹配目录名称和权限组名称）
     * @return 响应结果
     */
    public ResponseUtil queryPermissionGroupAndCatalog(String queryCondition) {
        try {
            // 获取当前用户ID
            Long userId = CurrentUserHolder.getCurrentUserId();
            PermissionGroupAndCatalogResultVO result = permissionGroupService.queryPermissionGroupAndCatalog(
                    queryCondition, userId);
            return ResponseUtil.successResponse(result);
        } catch (BaseException e) {
            logger.error("查询权限组和目录联合信息失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询权限组和目录联合信息异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.query.group.and.catalog.failed");
        }
    }

    /**
     * 查询权限组授权对象数据权限列表
     *
     * @param queryDTO 查询请求参数
     * @return 响应结果
     */
    public ResponseUtil queryAuthorizedObjectDataPermissions(AuthorizedObjectDataPermissionListQueryDTO queryDTO) {
        try {
            checkPermission();
            List<AuthorizedObjectDataPermissionVO> result = permissionGroupService.queryAuthorizedObjectDataPermissions(
                    queryDTO.getPermissionGroupId());
            return ResponseUtil.successResponse(result);
        } catch (BaseException e) {
            logger.error("查询权限组授权对象数据权限失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询权限组授权对象数据权限异常: permissionGroupId={}, {}", queryDTO.getPermissionGroupId(), e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.query.authorized.object.data.permission.failed");
        }
    }

    /**
     * 查询权限组授权对象数据权限详情
     *
     * @param queryDTO 查询请求参数
     * @return 响应结果
     */
    public ResponseUtil queryAuthorizedObjectDataPermissionDetail(AuthorizedObjectDataPermissionDetailQueryDTO queryDTO) {
        try {
            checkPermission();
            AuthorizedObjectDataPermissionVO result = permissionGroupService.getUserDataPermission(
                    queryDTO.getPermissionGroupId(), queryDTO.getUserId());
            return ResponseUtil.successResponse(result);
        } catch (BaseException e) {
            logger.error("查询权限组授权对象数据权限详情失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询权限组授权对象数据权限详情异常: permissionGroupId={}, userId={}, {}",
                    queryDTO.getPermissionGroupId(), queryDTO.getUserId(), e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.query.authorized.object.data.permission.detail.failed");
        }
    }

    /**
     * 更新授权对象数据权限
     *
     * @param updateDTO 更新请求参数
     * @return 响应结果
     */
    public ResponseUtil updateAuthorizedObjectDataPermission(UpdateAuthorizedObjectDataPermissionDTO updateDTO) {
        try {
            checkPermission();
            permissionGroupService.updateAuthorizedObjectDataPermission(updateDTO);
            return ResponseUtil.successResponse("更新授权对象数据权限成功");
        }
        catch (BaseException e) {
            logger.error("更新授权对象数据权限失败: {}", e.getMessage());
            throw e;
        }
        catch (Exception e) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.update.authorized.object.data.permission.failed");
        }
    }

    /**
     * 删除用户数据权限
     *
     * @param permissionGroupId 权限组ID
     * @param userId 用户ID
     * @return 响应结果
     */
    public ResponseUtil deleteAuthorizedObjectDataPermission(Long permissionGroupId, Long userId) {
        try {
            checkPermission();
            permissionGroupService.deleteAuthorizedObjectDataPermission(permissionGroupId, userId);
            return ResponseUtil.successResponse("删除用户数据权限成功");
        } catch (BaseException e) {
            logger.error("删除用户数据权限失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("删除用户数据权限异常: permissionGroupId={}, userId={}, {}",
                    permissionGroupId, userId, e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.delete.user.data.permission.failed");
        }
    }

    /**
     * 批量删除授权对象数据权限
     *
     * @param batchDeleteDTO 批量删除请求参数
     * @return 响应结果
     */
    public ResponseUtil batchDeleteAuthorizedObjectDataPermissions(BatchDeleteAuthorizedObjectDataPermissionDTO batchDeleteDTO) {
        try {
            checkPermission();
            permissionGroupService.batchDeleteUserDataPermissions(
                    batchDeleteDTO.getPermissionGroupId(), batchDeleteDTO.getAuthorizedObjectIds());
            return ResponseUtil.successResponse("批量删除授权对象数据权限成功");
        } catch (BaseException e) {
            logger.error("批量删除授权对象数据权限失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("批量删除授权对象数据权限异常: permissionGroupId={}, count={}, {}",
                    batchDeleteDTO.getPermissionGroupId(), batchDeleteDTO.getAuthorizedObjectIds().size(), e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.batch.delete.authorized.object.data.permissions.failed");
        }
    }

    /**
     * 检查当前用户是否有访问指定维度列表的权限
     *
     * @param queryDTO 查询请求参数
     * @return 响应结果，包含是否有权限的布尔值
     */
    public ResponseUtil checkDimensionListPermission(DimensionListPermissionQueryDTO queryDTO) {
        try {
            DimensionListPermissionVO result = permissionGroupService.checkDimensionListPermission(
                    queryDTO.getPermissionGroupIds(), queryDTO.getDimensionType(), queryDTO.getObjIds());

            return ResponseUtil.successResponse(result);
        } catch (BaseException e) {
            logger.error("检查维度列表权限失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("检查维度列表权限异常: permissionGroupIds={}, dimensionType={}, objIds={}, {}",
                    queryDTO.getPermissionGroupIds(), queryDTO.getDimensionType(), queryDTO.getObjIds(), e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.check.dimension.list.permission.failed");
        }
    }

    /**
     * 资源关联多个权限组
     * 为指定资源批量关联多个权限组
     *
     * @param associateDTO 资源关联权限组请求
     * @return 响应结果
     */
    public ResponseUtil associateResourceToPermissionGroups(ResourceAssociatePermissionGroupsDTO associateDTO) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupService.associateResourceToPermissionGroups(associateDTO);
            return ResponseUtil.successResponse("资源关联权限组成功");
        } catch (BaseException e) {
            logger.error("资源关联权限组失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("资源关联权限组异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.associate.resources.failed");
        }
    }

    /**
     * 查询资源关联的权限组信息
     *
     * @param queryDTO 查询请求参数
     * @return 权限组列表
     */
    public ResponseUtil queryAssociatedPermissionGroupsByResource(ResourceQueryAssociatedPermissionGroupsDTO queryDTO) {
        try {
            List<PermissionResourceVO> result = permissionGroupService.queryPermissionGroupsByResource(queryDTO.getResourceId());
            return ResponseUtil.successResponse(result);
        } catch (BaseException e) {
            logger.error("查询资源关联权限组失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询资源关联权限组异常: resourceId={}, {}", queryDTO.getResourceId(), e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "permission.group.application.query.resource.associated.groups.failed");
        }
    }

}

