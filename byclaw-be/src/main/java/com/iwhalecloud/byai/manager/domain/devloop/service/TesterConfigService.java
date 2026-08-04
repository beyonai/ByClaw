package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.TesterConfig;
import com.iwhalecloud.byai.manager.mapper.devloop.TesterConfigMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;

/**
 * 独立测试数字员工配置领域服务。
 * 每个研发项目仅一行有效配置,保存走 upsert;查询不存在时上层回填出厂默认。
 */
@Slf4j
@Service
public class TesterConfigService {

    @Autowired
    private TesterConfigMapper testerConfigMapper;

    @Autowired
    private SequenceService sequenceService;

    /** 查询项目配置行,不存在返回 null(上层按出厂默认回填)。 */
    public TesterConfig findByProject(Long projectId) {
        LambdaQueryWrapper<TesterConfig> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(TesterConfig::getProjectId, projectId)
               .eq(TesterConfig::getDeleteFlag, "0")
               .last("LIMIT 1");
        return testerConfigMapper.selectOne(wrapper);
    }

    /** 全部启用(enabled != '0')的项目测试配置,供定时批量集成 job 枚举待调度项目。 */
    public java.util.List<TesterConfig> listEnabled() {
        LambdaQueryWrapper<TesterConfig> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(TesterConfig::getDeleteFlag, "0")
               .ne(TesterConfig::getEnabled, "0");
        return testerConfigMapper.selectList(wrapper);
    }

    /** 保存项目配置:已存在则整体覆盖更新,否则新建(每项目唯一)。 */
    public TesterConfig save(TesterConfig input, Long operatorId) {
        TesterConfig existing = findByProject(input.getProjectId());
        Date now = new Date();
        if (existing == null) {
            input.setId(sequenceService.nextVal());
            input.setCreateBy(operatorId);
            input.setCreateTime(now);
            input.setDeleteFlag("0");
            testerConfigMapper.insert(input);
            return input;
        }
        // 覆盖式更新:策略字段整体以入参为准,避免残留旧值。
        existing.setEnabled(input.getEnabled());
        existing.setCron(input.getCron());
        existing.setCronLabel(input.getCronLabel());
        existing.setTimezone(input.getTimezone());
        existing.setRequireAllCoded(input.getRequireAllCoded());
        existing.setMaxConcurrentReqs(input.getMaxConcurrentReqs());
        existing.setAutoAttribute(input.getAutoAttribute());
        existing.setCreateDefectWhenUnclear(input.getCreateDefectWhenUnclear());
        existing.setMaxRounds(input.getMaxRounds());
        existing.setUpdateBy(operatorId);
        existing.setUpdateTime(now);
        testerConfigMapper.updateById(existing);
        return existing;
    }
}
