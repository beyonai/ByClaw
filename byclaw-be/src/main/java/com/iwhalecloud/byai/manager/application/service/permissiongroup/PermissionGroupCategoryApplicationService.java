package com.iwhalecloud.byai.manager.application.service.permissiongroup;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.domain.permissiongroup.service.PermissionGroupCategoryService;
import com.iwhalecloud.byai.manager.dto.permissiongroup.PermissionGroupCategoryDTO;
import com.iwhalecloud.byai.manager.qo.permissiongroup.PermissionGroupCategoryQueryQO;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AddResultVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.PermissionGroupCategoryVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 权限组目录应用服务
 * 负责权限组目录相关的业务编排和事务控制
 */
@Service
public class PermissionGroupCategoryApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(PermissionGroupCategoryApplicationService.class);


    @Autowired
    private PermissionGroupCategoryService permissionGroupCategoryService;

    /**
     * 分页查询目录列表
     *
     * @param queryQO 查询条件
     * @return 目录分页列表
     */
    public PageInfo<PermissionGroupCategoryVO> queryCategoryPage(PermissionGroupCategoryQueryQO queryQO) {
        try {
            Page<PermissionGroupCategoryVO> page = permissionGroupCategoryService.queryCategoryPage(queryQO);
            return PageHelperUtil.toPageInfo(page);
        } catch (BaseException e) {
            logger.error("查询权限组目录列表失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询权限组目录列表异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.application.query.list.failed"));
        }
    }

    /**
     * 查询目录树
     *
     * @param queryQO 查询条件
     * @return 响应结果
     */
    public ResponseUtil queryCategoryTree(PermissionGroupCategoryQueryQO queryQO) {
        try {
            List<PermissionGroupCategoryVO> tree = permissionGroupCategoryService.queryCategoryTree(queryQO);
            return ResponseUtil.successResponse(tree);
        } catch (BaseException e) {
            logger.error("查询权限组目录树失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询权限组目录树异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.application.query.tree.failed"));
        }
    }

    /**
     * 查询目录详情
     *
     * @param id 目录ID
     * @return 响应结果
     */
    public ResponseUtil getCategoryDetail(Long id) {
        try {
            PermissionGroupCategoryVO categoryVO = permissionGroupCategoryService.getCategoryDetail(id);
            return ResponseUtil.successResponse(categoryVO);
        } catch (BaseException e) {
            logger.error("查询权限组目录详情失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("查询权限组目录详情异常: id={}, {}", id, e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.application.query.detail.failed"));
        }
    }

    /**
     * 新增目录
     *
     * @param categoryDTO 目录信息
     * @return 响应结果，包含新增目录ID
     */
    public ResponseUtil addCategory(PermissionGroupCategoryDTO categoryDTO) {
        try {
            // 权限校验
            checkPermission();

            Long categoryId = permissionGroupCategoryService.addCategory(categoryDTO);
            // 使用AddResultVO包装Long类型ID，防止前端精度丢失
            return ResponseUtil.successResponse(AddResultVO.of(categoryId));
        } catch (BaseException e) {
            logger.error("新增权限组目录失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("新增权限组目录异常: {}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.application.add.failed"));
        }
    }

    /**
     * 修改目录
     *
     * @param categoryDTO 目录信息
     * @return 响应结果
     */
    public ResponseUtil updateCategory(PermissionGroupCategoryDTO categoryDTO) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupCategoryService.updateCategory(categoryDTO);
            return ResponseUtil.successResponse("修改权限组目录成功");
        } catch (BaseException e) {
            logger.error("修改权限组目录失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("修改权限组目录异常: id={}, {}", categoryDTO.getId(), e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.application.update.failed"));
        }
    }

    /**
     * 删除目录
     *
     * @param id 目录ID
     * @return 响应结果
     */
    public ResponseUtil deleteCategory(Long id) {
        try {
            // 权限校验
            checkPermission();

            permissionGroupCategoryService.deleteCategory(id);
            return ResponseUtil.successResponse("删除权限组目录成功");
        } catch (BaseException e) {
            logger.error("删除权限组目录失败: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("删除权限组目录异常: id={}, {}", id, e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.application.delete.failed"));
        }
    }

    /**
     * 权限校验
     * 检查当前用户是否有权限操作权限组目录
     */
    private void checkPermission() {
        // 只有平台管理员可以操作权限组目录
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.application.no.permission"));
        }
    }

}

