package com.iwhalecloud.byai.manager.domain.datacloud.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import cn.hutool.core.util.IdUtil;
import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptExecution;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudScriptExecutionMapper;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptExecutionBatchDeleteQO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptExecutionDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptExecutionQueryDTO;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
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
 * 脚本执行记录管理服务
 * 
 * @author system
 * @date 2025-01-15
 */
@Service
public class DatacloudScriptExecutionService {

    private static final Logger logger = LoggerFactory.getLogger(DatacloudScriptExecutionService.class);


    @Autowired
    private DatacloudScriptExecutionMapper datacloudScriptExecutionMapper;

    /**
     * 分页查询脚本执行记录列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    public ResponseUtil queryScriptExecutionList(DatacloudScriptExecutionQueryDTO query) {
        try {
            Page<DatacloudScriptExecutionDTO> page = new Page<>(query.getPageNum(), query.getPageSize());

            List<DatacloudScriptExecutionDTO> list = datacloudScriptExecutionMapper
                .selectScriptExecutionListByPage(page, query);
            page.setRecords(list);

            // 如果需要包含JSON对象解析，则解析JSON字段
            if (Boolean.TRUE.equals(query.getIncludeJsonObjects())) {
                parseJsonFields(list);
            }

            // 格式化显示字段
            formatDisplayFields(list);

            return ResponseUtil.success(PageHelperUtil.toPageInfo(page));
        }
        catch (Exception e) {
            logger.error("查询脚本执行记录列表失败", e);
            return ResponseUtil.fail("查询脚本执行记录列表失败：" + e.getMessage());
        }
    }

    /**
     * 根据脚本ID查询执行记录列表
     * 
     * @param scriptId 脚本ID
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 执行记录列表
     */
    public ResponseUtil queryExecutionsByScriptId(Long scriptId, Long enterpriseId, Integer limit) {
        try {
            List<DatacloudScriptExecutionDTO> list = datacloudScriptExecutionMapper.selectExecutionsByScriptId(scriptId,
                enterpriseId, limit);

            // 解析JSON字段和格式化显示字段
            parseJsonFields(list);
            formatDisplayFields(list);

            return ResponseUtil.success(list);
        }
        catch (Exception e) {
            logger.error("根据脚本ID查询执行记录列表失败", e);
            return ResponseUtil.fail("根据脚本ID查询执行记录列表失败：" + e.getMessage());
        }
    }

    /**
     * 根据ID查询脚本执行记录详情
     * 
     * @param executionId 执行记录ID
     * @return 执行记录详情
     */
    public ResponseUtil queryScriptExecutionById(Long executionId) {
        try {
            DatacloudScriptExecution execution = datacloudScriptExecutionMapper.selectById(executionId);
            if (execution == null) {
                return ResponseUtil.fail("脚本执行记录不存在");
            }

            DatacloudScriptExecutionDTO dto = new DatacloudScriptExecutionDTO();
            BeanUtils.copyProperties(execution, dto);

            // 解析JSON字段和格式化显示字段
            parseJsonFields(dto);
            formatDisplayFields(dto);

            return ResponseUtil.success(dto);
        }
        catch (Exception e) {
            logger.error("查询脚本执行记录详情失败", e);
            return ResponseUtil.fail("查询脚本执行记录详情失败：" + e.getMessage());
        }
    }

    /**
     * 新增脚本执行记录
     * 
     * @param dto 执行记录信息
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil addScriptExecution(DatacloudScriptExecutionDTO dto) {
        try {
            // 验证JSON格式
            validateJsonFields(dto);

            DatacloudScriptExecution execution = new DatacloudScriptExecution();
            BeanUtils.copyProperties(dto, execution);

            // 设置主键ID
            execution.setExecutionId(IdUtil.getSnowflakeNextId());
            execution.setCreateTime(new Date());

            // 如果状态为running，设置开始时间
            if ("running".equals(execution.getExecutionStatus()) && execution.getStartTime() == null) {
                execution.setStartTime(new Date());
            }

            int result = datacloudScriptExecutionMapper.insert(execution);
            if (result > 0) {
                logger.info("新增脚本执行记录成功，执行记录ID：{}", execution.getExecutionId());
                return ResponseUtil.success("新增脚本执行记录成功");
            }
            else {
                return ResponseUtil.fail("新增脚本执行记录失败");
            }
        }
        catch (Exception e) {
            logger.error("新增脚本执行记录失败", e);
            return ResponseUtil.fail("新增脚本执行记录失败：" + e.getMessage());
        }
    }

    /**
     * 更新脚本执行记录
     * 
     * @param dto 执行记录信息
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil updateScriptExecution(DatacloudScriptExecutionDTO dto) {
        try {
            // 检查执行记录是否存在
            DatacloudScriptExecution existingExecution = datacloudScriptExecutionMapper
                .selectById(dto.getExecutionId());
            if (existingExecution == null) {
                return ResponseUtil.fail("脚本执行记录不存在");
            }

            // 验证JSON格式
            validateJsonFields(dto);

            DatacloudScriptExecution execution = new DatacloudScriptExecution();
            BeanUtils.copyProperties(dto, execution);

            // 如果状态发生变化，更新相应的时间字段
            if (!existingExecution.getExecutionStatus().equals(execution.getExecutionStatus())) {
                if ("running".equals(execution.getExecutionStatus()) && execution.getStartTime() == null) {
                    execution.setStartTime(new Date());
                }
                else if (("success".equals(execution.getExecutionStatus())
                    || "failed".equals(execution.getExecutionStatus())) && execution.getEndTime() == null) {
                    execution.setEndTime(new Date());

                    // 计算执行时长
                    if (execution.getStartTime() != null) {
                        long duration = execution.getEndTime().getTime() - execution.getStartTime().getTime();
                        execution.setDuration(duration);
                    }
                }
            }

            int result = datacloudScriptExecutionMapper.updateById(execution);
            if (result > 0) {
                logger.info("更新脚本执行记录成功，执行记录ID：{}", execution.getExecutionId());
                return ResponseUtil.success("更新脚本执行记录成功");
            }
            else {
                return ResponseUtil.fail("更新脚本执行记录失败");
            }
        }
        catch (Exception e) {
            logger.error("更新脚本执行记录失败", e);
            return ResponseUtil.fail("更新脚本执行记录失败：" + e.getMessage());
        }
    }

    /**
     * 删除脚本执行记录
     * 
     * @param executionId 执行记录ID
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil deleteScriptExecution(Long executionId) {
        try {
            // 检查执行记录是否存在
            DatacloudScriptExecution execution = datacloudScriptExecutionMapper.selectById(executionId);
            if (execution == null) {
                return ResponseUtil.fail("脚本执行记录不存在");
            }

            int result = datacloudScriptExecutionMapper.deleteById(executionId);
            if (result > 0) {
                logger.info("删除脚本执行记录成功，执行记录ID：{}", executionId);
                return ResponseUtil.success("删除脚本执行记录成功");
            }
            else {
                return ResponseUtil.fail("删除脚本执行记录失败");
            }
        }
        catch (Exception e) {
            logger.error("删除脚本执行记录失败", e);
            return ResponseUtil.fail("删除脚本执行记录失败：" + e.getMessage());
        }
    }

    /**
     * 批量删除脚本执行记录
     * 
     * @param qo 批量删除请求对象
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil batchDeleteScriptExecutions(DatacloudScriptExecutionBatchDeleteQO qo) {
        try {
            List<Long> executionIds = qo.getExecutionIds();
            Long enterpriseId = qo.getEnterpriseId();

            if (executionIds == null || executionIds.isEmpty()) {
                return ResponseUtil.fail("请选择要删除的执行记录");
            }

            // 验证执行记录是否存在且属于该企业
            List<DatacloudScriptExecution> existingExecutions = datacloudScriptExecutionMapper
                .selectBatchIds(executionIds);
            if (existingExecutions.size() != executionIds.size()) {
                return ResponseUtil.fail("部分执行记录不存在");
            }

            for (DatacloudScriptExecution execution : existingExecutions) {
                if (!execution.getEnterpriseId().equals(enterpriseId)) {
                    return ResponseUtil.fail("无权删除其他企业的执行记录");
                }

                // 检查是否正在执行
                if ("running".equals(execution.getExecutionStatus())) {
                    return ResponseUtil.fail("执行记录【" + execution.getExecutionName() + "】正在执行中，无法删除");
                }
            }

            // 使用批量删除方法
            int result = datacloudScriptExecutionMapper.batchDeleteScriptExecutions(executionIds, enterpriseId);
            if (result > 0) {
                logger.info("批量删除脚本执行记录成功，共删除 {} 个执行记录", result);
                return ResponseUtil.success("批量删除成功，共删除 " + result + " 个执行记录");
            }
            else {
                return ResponseUtil.fail("批量删除脚本执行记录失败");
            }
        }
        catch (Exception e) {
            logger.error("批量删除脚本执行记录失败", e);
            return ResponseUtil.fail("批量删除脚本执行记录失败：" + e.getMessage());
        }
    }

    /**
     * 取消正在执行的脚本
     * 
     * @param executionId 执行记录ID
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil cancelScriptExecution(Long executionId) {
        try {
            // 检查执行记录是否存在
            DatacloudScriptExecution execution = datacloudScriptExecutionMapper.selectById(executionId);
            if (execution == null) {
                return ResponseUtil.fail("脚本执行记录不存在");
            }

            if (!"running".equals(execution.getExecutionStatus())) {
                return ResponseUtil.fail("只能取消正在执行的脚本");
            }

            execution.setExecutionStatus("cancelled");
            execution.setEndTime(new Date());

            // 计算执行时长
            if (execution.getStartTime() != null) {
                long duration = execution.getEndTime().getTime() - execution.getStartTime().getTime();
                execution.setDuration(duration);
            }

            int result = datacloudScriptExecutionMapper.updateById(execution);
            if (result > 0) {
                logger.info("取消脚本执行成功，执行记录ID：{}", executionId);
                return ResponseUtil.success("取消脚本执行成功");
            }
            else {
                return ResponseUtil.fail("取消脚本执行失败");
            }
        }
        catch (Exception e) {
            logger.error("取消脚本执行失败", e);
            return ResponseUtil.fail("取消脚本执行失败：" + e.getMessage());
        }
    }

    /**
     * 查询执行记录统计信息
     * 
     * @param enterpriseId 企业ID
     * @return 统计信息
     */
    public ResponseUtil queryExecutionStatistics(Long enterpriseId) {
        try {
            Map<String, Object> statistics = datacloudScriptExecutionMapper.selectExecutionStatistics(enterpriseId);
            return ResponseUtil.success(statistics);
        }
        catch (Exception e) {
            logger.error("查询执行记录统计信息失败", e);
            return ResponseUtil.fail("查询执行记录统计信息失败：" + e.getMessage());
        }
    }

    /**
     * 查询执行状态统计
     * 
     * @param enterpriseId 企业ID
     * @return 执行状态统计
     */
    public ResponseUtil queryExecutionStatusStatistics(Long enterpriseId) {
        try {
            List<Map<String, Object>> statistics = datacloudScriptExecutionMapper
                .selectExecutionStatusStatistics(enterpriseId);
            return ResponseUtil.success(statistics);
        }
        catch (Exception e) {
            logger.error("查询执行状态统计失败", e);
            return ResponseUtil.fail("查询执行状态统计失败：" + e.getMessage());
        }
    }

    /**
     * 查询脚本执行统计
     * 
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 脚本执行统计
     */
    public ResponseUtil queryScriptExecutionStatistics(Long enterpriseId, Integer limit) {
        try {
            List<Map<String, Object>> statistics = datacloudScriptExecutionMapper
                .selectScriptExecutionStatistics(enterpriseId, limit);
            return ResponseUtil.success(statistics);
        }
        catch (Exception e) {
            logger.error("查询脚本执行统计失败", e);
            return ResponseUtil.fail("查询脚本执行统计失败：" + e.getMessage());
        }
    }

    /**
     * 查询最近执行记录
     * 
     * @param enterpriseId 企业ID
     * @param limit 限制数量
     * @return 最近执行记录列表
     */
    public ResponseUtil queryRecentExecutions(Long enterpriseId, Integer limit) {
        try {
            List<DatacloudScriptExecutionDTO> list = datacloudScriptExecutionMapper.selectRecentExecutions(enterpriseId,
                limit);

            // 解析JSON字段和格式化显示字段
            parseJsonFields(list);
            formatDisplayFields(list);

            return ResponseUtil.success(list);
        }
        catch (Exception e) {
            logger.error("查询最近执行记录失败", e);
            return ResponseUtil.fail("查询最近执行记录失败：" + e.getMessage());
        }
    }

    /**
     * 解析JSON字段
     * 
     * @param list 执行记录列表
     */
    private void parseJsonFields(List<DatacloudScriptExecutionDTO> list) {
        for (DatacloudScriptExecutionDTO dto : list) {
            parseJsonFields(dto);
        }
    }

    /**
     * 解析JSON字段
     * 
     * @param dto 执行记录DTO
     */
    private void parseJsonFields(DatacloudScriptExecutionDTO dto) {
        try {
            if (dto.getExecutionParams() != null && !dto.getExecutionParams().trim().isEmpty()) {
                dto.setExecutionParamsObj(JSON.parseObject(dto.getExecutionParams()));
            }
            if (dto.getExecutionResult() != null && !dto.getExecutionResult().trim().isEmpty()) {
                dto.setExecutionResultObj(JSON.parseObject(dto.getExecutionResult()));
            }
        }
        catch (Exception e) {
            logger.warn("解析执行记录JSON字段失败，执行记录ID" + dto.getExecutionId());
        }
    }

    /**
     * 格式化显示字段
     * 
     * @param list 执行记录列表
     */
    private void formatDisplayFields(List<DatacloudScriptExecutionDTO> list) {
        for (DatacloudScriptExecutionDTO dto : list) {
            formatDisplayFields(dto);
        }
    }

    /**
     * 格式化显示字段
     * 
     * @param dto 执行记录DTO
     */
    private void formatDisplayFields(DatacloudScriptExecutionDTO dto) {
        // 格式化执行状态
        switch (dto.getExecutionStatus()) {
            case "running":
                dto.setExecutionStatusText("执行中");
                break;
            case "success":
                dto.setExecutionStatusText("成功");
                break;
            case "failed":
                dto.setExecutionStatusText("失败");
                break;
            case "cancelled":
                dto.setExecutionStatusText("已取消");
                break;
            default:
                dto.setExecutionStatusText(dto.getExecutionStatus());
        }

        // 格式化执行时长
        if (dto.getDuration() != null) {
            dto.setDurationText(formatDuration(dto.getDuration()));
        }
    }

    /**
     * 格式化执行时长
     * 
     * @param duration 执行时长（毫秒）
     * @return 格式化后的时长文本
     */
    private String formatDuration(Long duration) {
        if (duration == null) {
            return "0秒";
        }

        long seconds = duration / 1000;
        long minutes = seconds / 60;
        long hours = minutes / 60;

        if (hours > 0) {
            return hours + "小时" + (minutes % 60) + "分钟" + (seconds % 60) + "秒";
        }
        else if (minutes > 0) {
            return minutes + "分钟" + (seconds % 60) + "秒";
        }
        else {
            return seconds + "秒";
        }
    }

    /**
     * 验证JSON字段格式
     * 
     * @param dto 执行记录DTO
     */
    private void validateJsonFields(DatacloudScriptExecutionDTO dto) {
        try {
            if (dto.getExecutionParams() != null && !dto.getExecutionParams().trim().isEmpty()) {
                JSON.parseObject(dto.getExecutionParams());
            }
            if (dto.getExecutionResult() != null && !dto.getExecutionResult().trim().isEmpty()) {
                JSON.parseObject(dto.getExecutionResult());
            }
        }
        catch (Exception e) {
            throw new IllegalArgumentException(I18nUtil.get("datacloud.script.execution.json.format.invalid", e.getMessage()));
        }
    }
}
