package com.iwhalecloud.byai.manager.domain.datacloud.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import cn.hutool.core.util.IdUtil;
import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudLoginType;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudLoginTypeMapper;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudLoginTypeBatchDeleteQO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudLoginTypeDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudLoginTypeQueryDTO;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * 登录类型管理服务
 * 
 * @author system
 * @date 2025-01-15
 */
@Service
public class DatacloudLoginTypeService {

    private static final Logger logger = LoggerFactory.getLogger(DatacloudLoginTypeService.class);


    @Autowired
    private DatacloudLoginTypeMapper datacloudLoginTypeMapper;

    /**
     * 分页查询登录类型列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    public ResponseUtil queryLoginTypeList(DatacloudLoginTypeQueryDTO query) {
        try {
            /**
             * Page<SuasSuperassist> page = new Page<>(qo.getPageIndex(), qo.getPageSize());
             * QueryWrapper<SuasSuperassist> queryWrapper = new QueryWrapper<>(); queryWrapper.like("name", '%' +
             * qo.getKeyWord() + '%'); List<SuasSuperassist> suasSuperassists = suasSuperassistMapper.selectList(page,
             * queryWrapper); page.setRecords(suasSuperassists); return PageHelperUtil.toPageInfo(page);
             */
            Page<DatacloudLoginType> page = new Page<>(query.getPageNum(), query.getPageSize());
            LambdaQueryWrapper<DatacloudLoginType> queryWrapper = new LambdaQueryWrapper<>();
            queryWrapper.eq(DatacloudLoginType::getIsActive, 1);
            if (StringUtil.isNotEmpty(query.getLoginTypeCode())) {
                queryWrapper.like(DatacloudLoginType::getLoginTypeCode, '%' + query.getLoginTypeCode() + '%');
            }
            if (StringUtil.isNotEmpty(query.getLoginTypeName())) {
                queryWrapper.like(DatacloudLoginType::getLoginTypeName, '%' + query.getLoginTypeName() + '%');
            }

            List<DatacloudLoginType> list = datacloudLoginTypeMapper.selectList(page, queryWrapper);
            page.setRecords(list);

            return ResponseUtil.success(PageHelperUtil.toPageInfo(page));
        }
        catch (Exception e) {
            logger.error("查询登录类型列表失败", e);
            return ResponseUtil.fail("查询登录类型列表失败：" + e.getMessage());
        }
    }

    /**
     * 查询所有启用的登录类型
     * 
     * @param enterpriseId 企业ID
     * @return 启用的登录类型列表
     */
    public ResponseUtil queryActiveLoginTypes(Long enterpriseId) {
        try {
            List<DatacloudLoginTypeDTO> list = datacloudLoginTypeMapper.selectActiveLoginTypes(enterpriseId);

            // 解析JSON配置
            for (DatacloudLoginTypeDTO dto : list) {
                if (dto.getLoginTypeConfig() != null && !dto.getLoginTypeConfig().trim().isEmpty()) {
                    try {
                        dto.setLoginTypeConfigObj(JSON.parseObject(dto.getLoginTypeConfig()));
                    }
                    catch (Exception e) {
                        logger.warn("解析登录类型配置JSON失败，登录类型ID" + dto.getLoginTypeId());
                    }
                }
            }

            return ResponseUtil.success(list);
        }
        catch (Exception e) {
            logger.error("查询启用的登录类型列表失败", e);
            return ResponseUtil.fail("查询启用的登录类型列表失败：" + e.getMessage());
        }
    }

    /**
     * 根据ID查询登录类型详情
     * 
     * @param loginTypeId 登录类型ID
     * @return 登录类型详情
     */
    public ResponseUtil queryLoginTypeById(Long loginTypeId) {
        try {
            DatacloudLoginType loginType = datacloudLoginTypeMapper.selectById(loginTypeId);
            if (loginType == null) {
                return ResponseUtil.fail("登录类型不存在");
            }

            DatacloudLoginTypeDTO dto = new DatacloudLoginTypeDTO();
            BeanUtils.copyProperties(loginType, dto);

            // 统计关联脚本数量
            dto.setScriptCount(datacloudLoginTypeMapper.countScriptsByLoginType(loginTypeId));

            // 解析JSON配置
            if (dto.getLoginTypeConfig() != null && !dto.getLoginTypeConfig().trim().isEmpty()) {
                try {
                    dto.setLoginTypeConfigObj(JSON.parseObject(dto.getLoginTypeConfig()));
                }
                catch (Exception e) {
                    logger.warn("解析登录类型配置JSON失败，登录类型ID" + loginTypeId);
                }
            }

            return ResponseUtil.success(dto);
        }
        catch (Exception e) {
            logger.error("查询登录类型详情失败", e);
            return ResponseUtil.fail("查询登录类型详情失败：" + e.getMessage());
        }
    }

    /**
     * 新增登录类型
     * 
     * @param dto 登录类型信息
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil addLoginType(DatacloudLoginTypeDTO dto) {
        try {
            // 检查登录类型编码是否已存在
            int existsCount = datacloudLoginTypeMapper.checkLoginTypeCodeExists(dto.getLoginTypeCode(),
                dto.getEnterpriseId(), null);
            if (existsCount > 0) {
                return ResponseUtil.fail("登录类型编码已存在");
            }

            // 验证JSON配置格式
            if (dto.getLoginTypeConfig() != null && !dto.getLoginTypeConfig().trim().isEmpty()) {
                try {
                    JSON.parseObject(dto.getLoginTypeConfig());
                }
                catch (Exception e) {
                    return ResponseUtil.fail("登录类型配置JSON格式不正确：" + e.getMessage());
                }
            }

            DatacloudLoginType loginType = new DatacloudLoginType();
            BeanUtils.copyProperties(dto, loginType);

            // 设置主键ID
            loginType.setLoginTypeId(IdUtil.getSnowflakeNextId());
            loginType.setCreateTime(new Date());

            int result = datacloudLoginTypeMapper.insert(loginType);
            if (result > 0) {
                logger.info("新增登录类型成功，登录类型ID：{}", loginType.getLoginTypeId());
                return ResponseUtil.success("新增登录类型成功");
            }
            else {
                return ResponseUtil.fail("新增登录类型失败");
            }
        }
        catch (Exception e) {
            logger.error("新增登录类型失败", e);
            return ResponseUtil.fail("新增登录类型失败：" + e.getMessage());
        }
    }

    /**
     * 更新登录类型
     * 
     * @param dto 登录类型信息
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil updateLoginType(DatacloudLoginTypeDTO dto) {
        try {
            // 检查登录类型是否存在
            DatacloudLoginType existingLoginType = datacloudLoginTypeMapper.selectById(dto.getLoginTypeId());
            if (existingLoginType == null) {
                return ResponseUtil.fail("登录类型不存在");
            }

            // 检查登录类型编码是否已存在（排除当前记录）
            int existsCount = datacloudLoginTypeMapper.checkLoginTypeCodeExists(dto.getLoginTypeCode(),
                dto.getEnterpriseId(), dto.getLoginTypeId());
            if (existsCount > 0) {
                return ResponseUtil.fail("登录类型编码已存在");
            }

            // 验证JSON配置格式
            if (dto.getLoginTypeConfig() != null && !dto.getLoginTypeConfig().trim().isEmpty()) {
                try {
                    JSON.parseObject(dto.getLoginTypeConfig());
                }
                catch (Exception e) {
                    return ResponseUtil.fail("登录类型配置JSON格式不正确：" + e.getMessage());
                }
            }

            DatacloudLoginType loginType = new DatacloudLoginType();
            BeanUtils.copyProperties(dto, loginType);
            loginType.setUpdateTime(new Date());

            int result = datacloudLoginTypeMapper.updateById(loginType);
            if (result > 0) {
                logger.info("更新登录类型成功，登录类型ID：{}", loginType.getLoginTypeId());
                return ResponseUtil.success("更新登录类型成功");
            }
            else {
                return ResponseUtil.fail("更新登录类型失败");
            }
        }
        catch (Exception e) {
            logger.error("更新登录类型失败", e);
            return ResponseUtil.fail("更新登录类型失败：" + e.getMessage());
        }
    }

    /**
     * 删除登录类型
     * 
     * @param loginTypeId 登录类型ID
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil deleteLoginType(Long loginTypeId) {
        try {
            // 检查登录类型是否存在
            DatacloudLoginType loginType = datacloudLoginTypeMapper.selectById(loginTypeId);
            if (loginType == null) {
                return ResponseUtil.fail("登录类型不存在");
            }

            // 检查是否有关联的脚本
            int scriptCount = datacloudLoginTypeMapper.countScriptsByLoginType(loginTypeId);
            if (scriptCount > 0) {
                return ResponseUtil.fail("该登录类型下存在关联脚本，无法删除");
            }

            int result = datacloudLoginTypeMapper.deleteById(loginTypeId);
            if (result > 0) {
                logger.info("删除登录类型成功，登录类型ID：{}", loginTypeId);
                return ResponseUtil.success("删除登录类型成功");
            }
            else {
                return ResponseUtil.fail("删除登录类型失败");
            }
        }
        catch (Exception e) {
            logger.error("删除登录类型失败", e);
            return ResponseUtil.fail("删除登录类型失败：" + e.getMessage());
        }
    }

    /**
     * 批量删除登录类型
     * 
     * @param qo 批量删除请求对象
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil batchDeleteLoginTypes(DatacloudLoginTypeBatchDeleteQO qo) {
        try {
            List<Long> loginTypeIds = qo.getLoginTypeIds();
            Long enterpriseId = qo.getEnterpriseId();

            if (loginTypeIds == null || loginTypeIds.isEmpty()) {
                return ResponseUtil.fail("请选择要删除的登录类型");
            }

            // 验证登录类型是否存在且属于该企业
            List<DatacloudLoginType> existingLoginTypes = datacloudLoginTypeMapper.selectBatchIds(loginTypeIds);
            if (existingLoginTypes.size() != loginTypeIds.size()) {
                return ResponseUtil.fail("部分登录类型不存在");
            }

            for (DatacloudLoginType loginType : existingLoginTypes) {
                if (!loginType.getEnterpriseId().equals(enterpriseId)) {
                    return ResponseUtil.fail("无权删除其他企业的登录类型");
                }

                // 检查是否有脚本使用该登录类型
                int scriptCount = datacloudLoginTypeMapper.countScriptsByLoginType(loginType.getLoginTypeId());
                if (scriptCount > 0) {
                    return ResponseUtil.fail("登录类型【" + loginType.getLoginTypeName() + "】被脚本使用，无法删除");
                }
            }

            // 使用批量删除方法
            int result = datacloudLoginTypeMapper.batchDeleteLoginTypes(loginTypeIds, enterpriseId);
            if (result > 0) {
                logger.info("批量删除登录类型成功，共删除 {} 个登录类型", result);
                return ResponseUtil.success("批量删除成功，共删除 " + result + " 个登录类型");
            }
            else {
                return ResponseUtil.fail("批量删除登录类型失败");
            }
        }
        catch (Exception e) {
            logger.error("批量删除登录类型失败", e);
            return ResponseUtil.fail("批量删除登录类型失败：" + e.getMessage());
        }
    }

    /**
     * 启用/禁用登录类型
     * 
     * @param loginTypeId 登录类型ID
     * @param isActive 是否启用
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil updateLoginTypeStatus(Long loginTypeId, Integer isActive) {
        try {
            // 检查登录类型是否存在
            DatacloudLoginType loginType = datacloudLoginTypeMapper.selectById(loginTypeId);
            if (loginType == null) {
                return ResponseUtil.fail("登录类型不存在");
            }

            loginType.setIsActive(isActive);
            loginType.setUpdateTime(new Date());

            int result = datacloudLoginTypeMapper.updateById(loginType);
            if (result > 0) {
                String statusText = isActive == 1 ? "启用" : "禁用";
                logger.info("{}登录类型成功，登录类型ID：{}", statusText, loginTypeId);
                return ResponseUtil.success(statusText + "登录类型成功");
            }
            else {
                return ResponseUtil.fail("更新登录类型状态失败");
            }
        }
        catch (Exception e) {
            logger.error("更新登录类型状态失败", e);
            return ResponseUtil.fail("更新登录类型状态失败：" + e.getMessage());
        }
    }

    /**
     * 查询登录类型统计信息
     * 
     * @param enterpriseId 企业ID
     * @return 统计信息
     */
    public ResponseUtil queryLoginTypeStatistics(Long enterpriseId) {
        try {
            Map<String, Object> statistics = datacloudLoginTypeMapper.selectLoginTypeStatistics(enterpriseId);
            return ResponseUtil.success(statistics);
        }
        catch (Exception e) {
            logger.error("查询登录类型统计信息失败", e);
            return ResponseUtil.fail("查询登录类型统计信息失败：" + e.getMessage());
        }
    }
}
