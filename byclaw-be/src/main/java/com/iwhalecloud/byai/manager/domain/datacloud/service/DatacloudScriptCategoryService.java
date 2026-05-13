package com.iwhalecloud.byai.manager.domain.datacloud.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import cn.hutool.core.util.IdUtil;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptCategory;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudScriptCategoryMapper;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptCategoryBatchDeleteQO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptCategoryDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptCategoryQueryDTO;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * 脚本分类管理服务
 * 
 * @author system
 * @date 2025-01-15
 */
@Service
public class DatacloudScriptCategoryService {

    private static final Logger logger = LoggerFactory.getLogger(DatacloudScriptCategoryService.class);


    @Autowired
    private DatacloudScriptCategoryMapper datacloudScriptCategoryMapper;

    /**
     * 分页查询脚本分类列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    public ResponseUtil queryScriptCategoryList(DatacloudScriptCategoryQueryDTO query) {
        try {
            Page<DatacloudScriptCategoryDTO> page = new Page<>(query.getPageNum(), query.getPageSize());

            List<DatacloudScriptCategoryDTO> list = datacloudScriptCategoryMapper.selectScriptCategoryListByPage(page,
                query);
            page.setRecords(list);

            // 如果需要包含统计信息，则补充统计数据
            if (Boolean.TRUE.equals(query.getIncludeChildCount())) {
                for (DatacloudScriptCategoryDTO dto : list) {
                    dto.setChildCount(datacloudScriptCategoryMapper.countChildCategories(dto.getCategoryId()));
                }
            }

            if (Boolean.TRUE.equals(query.getIncludeScriptCount())) {
                for (DatacloudScriptCategoryDTO dto : list) {
                    dto.setScriptCount(datacloudScriptCategoryMapper.countScriptsByCategory(dto.getCategoryId()));
                }
            }

            return ResponseUtil.success(PageHelperUtil.toPageInfo(page));
        }
        catch (Exception e) {
            logger.error("查询脚本分类列表失败", e);
            return ResponseUtil.fail("查询脚本分类列表失败：" + e.getMessage());
        }
    }

    /**
     * 查询脚本分类树形结构
     * 
     * @param enterpriseId 企业ID
     * @return 分类树形列表
     */
    public ResponseUtil queryScriptCategoryTree(Long enterpriseId) {
        try {
            List<DatacloudScriptCategoryDTO> treeList = datacloudScriptCategoryMapper
                .selectScriptCategoryTree(enterpriseId);
            return ResponseUtil.success(treeList);
        }
        catch (Exception e) {
            logger.error("查询脚本分类树形结构失败", e);
            return ResponseUtil.fail("查询脚本分类树形结构失败：" + e.getMessage());
        }
    }

    /**
     * 根据ID查询脚本分类详情
     * 
     * @param categoryId 分类ID
     * @return 分类详情
     */
    public ResponseUtil queryScriptCategoryById(Long categoryId) {
        try {
            DatacloudScriptCategory category = datacloudScriptCategoryMapper.selectById(categoryId);
            if (category == null) {
                return ResponseUtil.fail("脚本分类不存在");
            }

            DatacloudScriptCategoryDTO dto = new DatacloudScriptCategoryDTO();
            BeanUtils.copyProperties(category, dto);

            // 统计子分类和脚本数量
            int childCount = datacloudScriptCategoryMapper.countChildCategories(categoryId);
            int scriptCount = datacloudScriptCategoryMapper.countScriptsByCategory(categoryId);
            dto.setChildCount(childCount);
            dto.setScriptCount(scriptCount);

            return ResponseUtil.success(dto);
        }
        catch (Exception e) {
            logger.error("查询脚本分类详情失败", e);
            return ResponseUtil.fail("查询脚本分类详情失败：" + e.getMessage());
        }
    }

    /**
     * 新增脚本分类
     * 
     * @param dto 分类信息
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil addScriptCategory(DatacloudScriptCategoryDTO dto) {
        try {
            // 检查分类编码是否已存在
            int existsCount = datacloudScriptCategoryMapper.checkCategoryCodeExists(dto.getCategoryCode(),
                dto.getEnterpriseId(), null);
            if (existsCount > 0) {
                return ResponseUtil.fail("分类编码已存在");
            }

            DatacloudScriptCategory category = new DatacloudScriptCategory();
            BeanUtils.copyProperties(dto, category);

            // 设置主键ID
            category.setCategoryId(IdUtil.getSnowflakeNextId());
            category.setCreateTime(new Date());

            int result = datacloudScriptCategoryMapper.insert(category);
            if (result > 0) {
                logger.info("新增脚本分类成功，分类ID：{}", category.getCategoryId());
                return ResponseUtil.success("新增脚本分类成功");
            }
            else {
                return ResponseUtil.fail("新增脚本分类失败");
            }
        }
        catch (Exception e) {
            logger.error("新增脚本分类失败", e);
            return ResponseUtil.fail("新增脚本分类失败：" + e.getMessage());
        }
    }

    /**
     * 更新脚本分类
     * 
     * @param dto 分类信息
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil updateScriptCategory(DatacloudScriptCategoryDTO dto) {
        try {
            // 检查分类是否存在
            DatacloudScriptCategory existingCategory = datacloudScriptCategoryMapper.selectById(dto.getCategoryId());
            if (existingCategory == null) {
                return ResponseUtil.fail("脚本分类不存在");
            }

            // 检查分类编码是否已存在（排除当前记录）
            int existsCount = datacloudScriptCategoryMapper.checkCategoryCodeExists(dto.getCategoryCode(),
                dto.getEnterpriseId(), dto.getCategoryId());
            if (existsCount > 0) {
                return ResponseUtil.fail("分类编码已存在");
            }

            DatacloudScriptCategory category = new DatacloudScriptCategory();
            BeanUtils.copyProperties(dto, category);
            category.setUpdateTime(new Date());

            int result = datacloudScriptCategoryMapper.updateById(category);
            if (result > 0) {
                logger.info("更新脚本分类成功，分类ID：{}", category.getCategoryId());
                return ResponseUtil.success("更新脚本分类成功");
            }
            else {
                return ResponseUtil.fail("更新脚本分类失败");
            }
        }
        catch (Exception e) {
            logger.error("更新脚本分类失败", e);
            return ResponseUtil.fail("更新脚本分类失败：" + e.getMessage());
        }
    }

    /**
     * 删除脚本分类
     * 
     * @param categoryId 分类ID
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil deleteScriptCategory(Long categoryId) {
        try {
            // 检查分类是否存在
            DatacloudScriptCategory category = datacloudScriptCategoryMapper.selectById(categoryId);
            if (category == null) {
                return ResponseUtil.fail("脚本分类不存在");
            }

            // 检查是否有子分类
            int childCount = datacloudScriptCategoryMapper.countChildCategories(categoryId);
            if (childCount > 0) {
                return ResponseUtil.fail("该分类下存在子分类，无法删除");
            }

            // 检查是否有关联的脚本
            int scriptCount = datacloudScriptCategoryMapper.countScriptsByCategory(categoryId);
            if (scriptCount > 0) {
                return ResponseUtil.fail("该分类下存在关联脚本，无法删除");
            }

            int result = datacloudScriptCategoryMapper.deleteById(categoryId);
            if (result > 0) {
                logger.info("删除脚本分类成功，分类ID：{}", categoryId);
                return ResponseUtil.success("删除脚本分类成功");
            }
            else {
                return ResponseUtil.fail("删除脚本分类失败");
            }
        }
        catch (Exception e) {
            logger.error("删除脚本分类失败", e);
            return ResponseUtil.fail("删除脚本分类失败：" + e.getMessage());
        }
    }

    /**
     * 批量删除脚本分类
     * 
     * @param qo 批量删除请求对象
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil batchDeleteScriptCategories(DatacloudScriptCategoryBatchDeleteQO qo) {
        try {
            List<Long> categoryIds = qo.getCategoryIds();
            Long enterpriseId = qo.getEnterpriseId();

            if (categoryIds == null || categoryIds.isEmpty()) {
                return ResponseUtil.fail("请选择要删除的分类");
            }

            // 验证分类是否存在且属于该企业
            List<DatacloudScriptCategory> existingCategories = datacloudScriptCategoryMapper
                .selectBatchIds(categoryIds);
            if (existingCategories.size() != categoryIds.size()) {
                return ResponseUtil.fail("部分分类不存在");
            }

            for (DatacloudScriptCategory category : existingCategories) {
                if (!category.getEnterpriseId().equals(enterpriseId)) {
                    return ResponseUtil.fail("无权删除其他企业的分类");
                }

                // 检查是否有子分类
                int childCount = datacloudScriptCategoryMapper.countChildCategories(category.getCategoryId());
                if (childCount > 0) {
                    return ResponseUtil.fail("分类【" + category.getCategoryName() + "】下存在子分类，无法删除");
                }

                // 检查是否有脚本
                int scriptCount = datacloudScriptCategoryMapper.countScriptsByCategory(category.getCategoryId());
                if (scriptCount > 0) {
                    return ResponseUtil.fail("分类【" + category.getCategoryName() + "】下存在脚本，无法删除");
                }
            }

            // 使用批量删除方法
            int result = datacloudScriptCategoryMapper.batchDeleteScriptCategories(categoryIds, enterpriseId);
            if (result > 0) {
                logger.info("批量删除脚本分类成功，共删除 {} 个分类", result);
                return ResponseUtil.success("批量删除成功，共删除 " + result + " 个分类");
            }
            else {
                return ResponseUtil.fail("批量删除脚本分类失败");
            }
        }
        catch (Exception e) {
            logger.error("批量删除脚本分类失败", e);
            return ResponseUtil.fail("批量删除脚本分类失败：" + e.getMessage());
        }
    }

    /**
     * 查询分类统计信息
     * 
     * @param enterpriseId 企业ID
     * @return 统计信息
     */
    public ResponseUtil queryCategoryStatistics(Long enterpriseId) {
        try {
            Map<String, Object> statistics = datacloudScriptCategoryMapper.selectCategoryStatistics(enterpriseId);
            return ResponseUtil.success(statistics);
        }
        catch (Exception e) {
            logger.error("查询分类统计信息失败", e);
            return ResponseUtil.fail("查询分类统计信息失败：" + e.getMessage());
        }
    }
}
