package com.iwhalecloud.byai.manager.domain.datacloud.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Date;
import java.util.List;

import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScript;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptStep;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudTargetScript;
import com.iwhalecloud.byai.manager.domain.datacloud.enums.DataCloudPublishStatusEnum;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudScriptMapper;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudScriptStepMapper;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudTargetScriptMapper;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptScenarioConfigDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptScenarioConfigQueryDTO;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import cn.hutool.core.util.IdUtil;
import lombok.extern.slf4j.Slf4j;

/**
 * 场景配置服务 用于处理脚本场景配置的保存和管理
 * 
 * @author system
 * @date 2025-01-15
 */
@Slf4j
@Service
public class DatacloudScriptScenarioConfigService {

    private static final Logger logger = LoggerFactory.getLogger(DatacloudScriptScenarioConfigService.class);


    @Autowired
    private DatacloudScriptMapper datacloudScriptMapper;

    @Autowired
    private DatacloudScriptStepMapper datacloudScriptStepMapper;

    @Autowired
    private DatacloudTargetScriptMapper datacloudTargetScriptMapper;

    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil saveScenarioConfig(DatacloudScriptScenarioConfigDTO configDTO) {
        try {
            Long scriptId = configDTO.getScriptId();
            updateScriptStatus(scriptId);
            clearOldConfigs(scriptId);
            saveScriptSteps(configDTO, scriptId);
            saveTargetScripts(configDTO, scriptId);
            return ResponseUtil.success("保存成功，脚本ID：" + scriptId);
        }
        catch (Exception e) {
            logger.error("保存失败", e);
            return ResponseUtil.fail("保存失败：" + e.getMessage());
        }
    }

    private void updateScriptStatus(Long scriptId) {
        DatacloudScript script = datacloudScriptMapper.selectById(scriptId);
        if (script != null) {
            script.setPublishStatus(DataCloudPublishStatusEnum.UNPUBLISHED.getValue());
            script.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            script.setUpdateTime(new Date());
            datacloudScriptMapper.updateById(script);
        }
    }

    private void clearOldConfigs(Long scriptId) {
        datacloudScriptStepMapper
            .delete(new LambdaQueryWrapper<DatacloudScriptStep>().eq(DatacloudScriptStep::getScriptId, scriptId));
        datacloudTargetScriptMapper
            .delete(new LambdaQueryWrapper<DatacloudTargetScript>().eq(DatacloudTargetScript::getScriptId, scriptId));
    }

    private void saveScriptSteps(DatacloudScriptScenarioConfigDTO configDTO, Long scriptId) {
        if (configDTO.getScriptStepList() == null) {
            return;
        }
        int size = configDTO.getScriptStepList().size();
        for (int index = 0; index < size; index++) {
            DatacloudScriptScenarioConfigDTO.ScriptStepDTO stepDTO = configDTO.getScriptStepList().get(index);
            DatacloudScriptStep step = buildScriptStep(stepDTO, scriptId, index);
            if (datacloudScriptStepMapper.insert(step) <= 0) {
                throw new BaseException(I18nUtil.get("datacloud.script.step.save.failed", index));
            }
        }
    }

    private DatacloudScriptStep buildScriptStep(DatacloudScriptScenarioConfigDTO.ScriptStepDTO stepDTO, Long scriptId,
        int index) {
        DatacloudScriptStep step = new DatacloudScriptStep();
        step.setStepId(IdUtil.getSnowflakeNextId());
        step.setScriptId(scriptId);
        step.setScriptDesc(stepDTO.getScriptDesc());
        step.setTemplateId(stepDTO.getTemplateId());
        step.setStepOrder(index + 1);
        step.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        step.setCreatorId(CurrentUserHolder.getCurrentUserId());
        step.setCreateTime(new Date());
        if (stepDTO.getScriptContent() != null) {
            step.setScriptContent(JSON.toJSONString(stepDTO.getScriptContent()));
        }
        if (stepDTO.getMetaInfos() != null && !stepDTO.getMetaInfos().isEmpty()) {
            step.setMetaInfos(JSON.toJSONString(stepDTO.getMetaInfos()));
        }
        return step;
    }

    private void saveTargetScripts(DatacloudScriptScenarioConfigDTO configDTO, Long scriptId) {
        if (configDTO.getTargetScriptList() == null) {
            return;
        }
        int size = configDTO.getTargetScriptList().size();
        for (int index = 0; index < size; index++) {
            DatacloudScriptScenarioConfigDTO.TargetScriptDTO targetDTO = configDTO.getTargetScriptList().get(index);
            DatacloudTargetScript target = buildTargetScript(targetDTO, scriptId, index);
            if (datacloudTargetScriptMapper.insert(target) <= 0) {
                throw new BaseException(I18nUtil.get("datacloud.script.target.save.failed", index));
            }
        }
    }

    private DatacloudTargetScript buildTargetScript(DatacloudScriptScenarioConfigDTO.TargetScriptDTO targetDTO,
        Long scriptId, int index) {
        DatacloudTargetScript target = new DatacloudTargetScript();
        target.setTargetScriptId(IdUtil.getSnowflakeNextId());
        target.setScriptId(scriptId);
        target.setTargetSelector(targetDTO.getTargetSelector());
        target.setType(targetDTO.getType());
        target.setTargetOrder(index + 1);
        target.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        target.setCreatorId(CurrentUserHolder.getCurrentUserId());
        target.setCreateTime(new Date());
        if (StringUtils.isNotBlank(targetDTO.getNextPageSelector())) {
            target.setNextPageSelector(targetDTO.getNextPageSelector());
        }
        if (StringUtils.isNotBlank(targetDTO.getMaxPages())) {
            target.setMaxPages(targetDTO.getMaxPages());
        }
        if (targetDTO.getActionScript() != null) {
            target.setPyScriptContent(targetDTO.getActionScript().getPython());
            target.setNodeScriptContent(targetDTO.getActionScript().getNodejs());
        }
        if (targetDTO.getExtParams() != null) {
            target.setExtParams(JSON.toJSONString(targetDTO.getExtParams()));
        }
        if (CollectionUtils.isNotEmpty(targetDTO.getMetaInfos())) {
            target.setMetaInfos(JSON.toJSONString(targetDTO.getMetaInfos()));
        }
        return target;
    }

    /**
     * 分页查询场景配置列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    public ResponseUtil queryScenarioConfigList(DatacloudScriptScenarioConfigQueryDTO query) {
        try {
            logger.info("分页查询场景配置列表，查询条件：{}", query);

            // 构建分页对象
            Page<DatacloudScriptStep> page = new Page<>(query.getPageNum(), query.getPageSize());
            // 构建查询条件
            LambdaQueryWrapper<DatacloudScriptStep> queryWrapper = Wrappers.lambdaQuery(DatacloudScriptStep.class)
                .eq(DatacloudScriptStep::getScriptId, query.getScriptId())
                .orderByAsc(DatacloudScriptStep::getStepOrder);

            // 执行查询
            List<DatacloudScriptStep> datacloudScriptStepList = datacloudScriptStepMapper.selectList(page,
                queryWrapper);
            page.setRecords(datacloudScriptStepList);

            return ResponseUtil.success(PageHelperUtil.toPageInfo(page));
        }
        catch (Exception e) {
            logger.error("分页查询场景配置列表失败", e);
            return ResponseUtil.fail("分页查询场景配置列表失败：" + e.getMessage());
        }
    }

}
