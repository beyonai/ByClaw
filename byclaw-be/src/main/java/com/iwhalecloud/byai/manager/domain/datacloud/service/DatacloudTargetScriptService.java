package com.iwhalecloud.byai.manager.domain.datacloud.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudTargetScript;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudTargetScriptMapper;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptScenarioConfigQueryDTO;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 目标脚本表服务接口 用于管理目标脚本的业务逻辑操作
 * 
 * @author system
 * @date 2025-01-15
 */
@Service
public class DatacloudTargetScriptService {

    private static final Logger logger = LoggerFactory.getLogger(DatacloudTargetScriptService.class);


    @Autowired
    private DatacloudTargetScriptMapper datacloudTargetScriptMapper;

    /**
     * 分页查询目标脚本列表
     *
     * @param query 查询条件
     * @return 分页结果
     */
    /**
     * 分页查询场景配置列表
     *
     * @param query 查询条件
     * @return 分页结果
     */
    public ResponseUtil queryList(DatacloudScriptScenarioConfigQueryDTO query) {
        try {
            logger.info("分页查询场景配置列表，查询条件：{}", query);

            // 构建分页对象
            Page<DatacloudTargetScript> page = new Page<>(query.getPageNum(), query.getPageSize());
            // 构建查询条件
            LambdaQueryWrapper<DatacloudTargetScript> queryWrapper = Wrappers.lambdaQuery(DatacloudTargetScript.class)
                .eq(DatacloudTargetScript::getScriptId, query.getScriptId())
                .orderByDesc(DatacloudTargetScript::getTargetOrder);

            // DatacloudTargetScript
            List<DatacloudTargetScript> list = datacloudTargetScriptMapper.selectList(page, queryWrapper);
            page.setRecords(list);

            return ResponseUtil.success(PageHelperUtil.toPageInfo(page));
        }
        catch (Exception e) {
            logger.error("分页查询场景配置列表失败", e);
            return ResponseUtil.fail("分页查询场景配置列表失败：" + e.getMessage());
        }
    }

}
