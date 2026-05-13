package com.iwhalecloud.byai.manager.domain.permissiongroup.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.permissiongroup.PermissionGroupCategoryDTO;
import com.iwhalecloud.byai.manager.entity.permissiongroup.PermissionGroupCategory;
import com.iwhalecloud.byai.manager.mapper.permissiongroup.PermissionGroupCategoryMapper;
import com.iwhalecloud.byai.manager.qo.permissiongroup.PermissionGroupCategoryQueryQO;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.manager.vo.permissiongroup.PermissionGroupCategoryVO;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 权限组目录领域服务
 * 负责权限组目录相关的核心业务逻辑
 */
@Service
public class PermissionGroupCategoryService {

    private static final Logger logger = LoggerFactory.getLogger(PermissionGroupCategoryService.class);


    @Autowired
    private PermissionGroupCategoryMapper permissionGroupCategoryMapper;

    @Autowired
    private SequenceService SequenceService;

    /**
     * 分页查询目录列表
     *
     * @param queryQO 查询条件
     * @return 目录分页列表
     */
    public Page<PermissionGroupCategoryVO> queryCategoryPage(PermissionGroupCategoryQueryQO queryQO) {
        Page<PermissionGroupCategoryVO> page = new Page<>(queryQO.getPageIndex(), queryQO.getPageSize());
        List<PermissionGroupCategoryVO> records = permissionGroupCategoryMapper.selectCategoryPage(page, queryQO).getRecords();
        page.setRecords(records);
        return page;
    }

    /**
     * 查询目录树
     *
     * @param queryQO 查询条件
     * @return 目录树
     */
    public List<PermissionGroupCategoryVO> queryCategoryTree(PermissionGroupCategoryQueryQO queryQO) {
        // 查询所有符合条件的目录
        List<PermissionGroupCategoryVO> allCategories = permissionGroupCategoryMapper.selectCategoryList(queryQO);

        if (ListUtil.isEmpty(allCategories)) {
            return new ArrayList<>();
        }

        // 构建树形结构
        return buildCategoryTree(allCategories);
    }

    /**
     * 构建目录树
     *
     * @param categories 目录列表
     * @return 目录树
     */
    private List<PermissionGroupCategoryVO> buildCategoryTree(List<PermissionGroupCategoryVO> categories) {
        // 使用Map来快速查找父节点
        Map<Long, PermissionGroupCategoryVO> categoryMap = new HashMap<>();
        for (PermissionGroupCategoryVO category : categories) {
            categoryMap.put(category.getId(), category);
        }

        // 构建树形结构
        List<PermissionGroupCategoryVO> rootCategories = new ArrayList<>();
        for (PermissionGroupCategoryVO category : categories) {
            if (category.getParentId() == null) {
                // 顶级目录
                rootCategories.add(category);
            } else {
                // 子目录，添加到父级的children中
                PermissionGroupCategoryVO parentCategory = categoryMap.get(category.getParentId());
                if (parentCategory != null) {
                    if (parentCategory.getChildren() == null) {
                        parentCategory.setChildren(new ArrayList<>());
                    }
                    parentCategory.getChildren().add(category);
                } else {
                    // 父级不在查询结果中，作为根节点处理
                    rootCategories.add(category);
                }
            }
        }

        return rootCategories;
    }

    /**
     * 查询目录详情
     *
     * @param id 目录ID
     * @return 目录详情
     */
    public PermissionGroupCategoryVO getCategoryDetail(Long id) {
        PermissionGroupCategoryVO categoryVO = permissionGroupCategoryMapper.selectCategoryDetail(id);
        if (categoryVO == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.not.exist"));
        }
        return categoryVO;
    }

    /**
     * 新增目录
     *
     * @param categoryDTO 目录信息
     * @return 目录ID
     */
    @Transactional(rollbackFor = Exception.class)
    public Long addCategory(PermissionGroupCategoryDTO categoryDTO) {
        // 校验编码是否重复（如果有编码）
        if (categoryDTO.getCategoryCode() != null && !categoryDTO.getCategoryCode().isEmpty()) {
            Long codeCount = permissionGroupCategoryMapper.countByCategoryCode(categoryDTO.getCategoryCode(), null);
            if (codeCount > 0) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.code.exists"));
            }
        }

        // 校验同级别下名称是否重复
        Long nameCount = permissionGroupCategoryMapper.countByCategoryName(
                categoryDTO.getCategoryName(), categoryDTO.getParentId(), null);
        if (nameCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.name.duplicate"));
        }

        // 校验父级目录是否存在
        if (categoryDTO.getParentId() != null) {
            PermissionGroupCategory parentCategory = permissionGroupCategoryMapper.selectById(categoryDTO.getParentId());
            if (parentCategory == null) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.parent.not.exist"));
            }
        }

        // 创建目录
        PermissionGroupCategory category = new PermissionGroupCategory();
        category.setId(SequenceService.nextSnowId());
        category.setCategoryName(categoryDTO.getCategoryName());
        category.setParentId(categoryDTO.getParentId());
        category.setCategoryCode(categoryDTO.getCategoryCode());
        category.setDescription(categoryDTO.getDescription());
        category.setIcon(categoryDTO.getIcon());
        category.setSortOrder(categoryDTO.getSortOrder() != null ? categoryDTO.getSortOrder() : 0);
        category.setStatus(categoryDTO.getStatus() != null ? categoryDTO.getStatus() : "active");
        category.setOrgId(categoryDTO.getOrgId());
        category.setCreateBy(CurrentUserHolder.getCurrentUserId());
        category.setCreateTime(new Date());

        permissionGroupCategoryMapper.insert(category);

        logger.info("新增权限组目录成功: id={}, categoryName={}", category.getId(), categoryDTO.getCategoryName());

        return category.getId();
    }

    /**
     * 修改目录
     *
     * @param categoryDTO 目录信息
     */
    @Transactional(rollbackFor = Exception.class)
    public void updateCategory(PermissionGroupCategoryDTO categoryDTO) {
        Long id = categoryDTO.getId();
        if (id == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.id.not.null"));
        }

        // 检查目录是否存在
        PermissionGroupCategory existingCategory = permissionGroupCategoryMapper.selectById(id);
        if (existingCategory == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.not.exist"));
        }

        // 校验编码是否重复（如果有编码）
        if (categoryDTO.getCategoryCode() != null && !categoryDTO.getCategoryCode().isEmpty()) {
            Long codeCount = permissionGroupCategoryMapper.countByCategoryCode(categoryDTO.getCategoryCode(), id);
            if (codeCount > 0) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.code.exists"));
            }
        }

        // 校验同级别下名称是否重复
        Long nameCount = permissionGroupCategoryMapper.countByCategoryName(
                categoryDTO.getCategoryName(), categoryDTO.getParentId(), id);
        if (nameCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.name.duplicate"));
        }

        // 校验父级目录是否存在
        if (categoryDTO.getParentId() != null) {
            // 不能将自己设为父级
            if (categoryDTO.getParentId().equals(id)) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.cannot.set.self.as.parent"));
            }
            // 检查是否形成循环
            if (isDescendant(id, categoryDTO.getParentId())) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.cannot.set.child.as.parent"));
            }
            PermissionGroupCategory parentCategory = permissionGroupCategoryMapper.selectById(categoryDTO.getParentId());
            if (parentCategory == null) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.parent.not.exist"));
            }
        }

        // 更新目录
        existingCategory.setCategoryName(categoryDTO.getCategoryName());
        existingCategory.setParentId(categoryDTO.getParentId());
        existingCategory.setCategoryCode(categoryDTO.getCategoryCode());
        existingCategory.setDescription(categoryDTO.getDescription());
        existingCategory.setIcon(categoryDTO.getIcon());
        if (categoryDTO.getSortOrder() != null) {
            existingCategory.setSortOrder(categoryDTO.getSortOrder());
        }
        if (categoryDTO.getStatus() != null) {
            existingCategory.setStatus(categoryDTO.getStatus());
        }
        existingCategory.setOrgId(categoryDTO.getOrgId());
        existingCategory.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        existingCategory.setUpdateTime(new Date());

        permissionGroupCategoryMapper.updateById(existingCategory);

        logger.info("修改权限组目录成功: id={}", id);
    }

    /**
     * 检查是否为后代目录
     *
     * @param parentId 父级ID
     * @param childId 子级ID
     * @return 是否为后代
     */
    private boolean isDescendant(Long parentId, Long childId) {
        List<Long> childrenIds = permissionGroupCategoryMapper.selectChildrenIds(parentId);
        return childrenIds != null && childrenIds.contains(childId);
    }

    /**
     * 删除目录
     *
     * @param id 目录ID
     */
    @Transactional(rollbackFor = Exception.class)
    public void deleteCategory(Long id) {
        // 检查目录是否存在
        PermissionGroupCategory category = permissionGroupCategoryMapper.selectById(id);
        if (category == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.not.exist"));
        }

        // 检查是否有子目录
        Long childCount = permissionGroupCategoryMapper.countByParentId(id);
        if (childCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.has.children"));
        }

        // 检查是否有权限组
        Long groupCount = permissionGroupCategoryMapper.countPermissionGroupByCategoryId(id);
        if (groupCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.category.has.permission.groups"));
        }

        // 删除目录
        permissionGroupCategoryMapper.deleteById(id);

        logger.info("删除权限组目录成功: id={}", id);
    }

    /**
     * 根据ID查询目录
     *
     * @param id 目录ID
     * @return 目录实体
     */
    public PermissionGroupCategory findById(Long id) {
        return permissionGroupCategoryMapper.selectById(id);
    }

}

