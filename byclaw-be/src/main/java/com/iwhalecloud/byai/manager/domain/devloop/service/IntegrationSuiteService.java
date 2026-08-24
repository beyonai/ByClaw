package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationSuite;
import com.iwhalecloud.byai.manager.mapper.devloop.IntegrationSuiteMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

/**
 * 端到端测试用例集领域服务
 * 提供用例集的增删改查及启用状态管理
 */
@Slf4j
@Service
public class IntegrationSuiteService {

    @Autowired
    private IntegrationSuiteMapper integrationSuiteMapper;

    @Autowired
    private SequenceService sequenceService;

    /** 创建用例集，自动生成ID和初始状态 */
    public IntegrationSuite create(IntegrationSuite suite) {
        suite.setSuiteId(sequenceService.nextVal());
        suite.setCreateTime(new Date());
        suite.setDeleteFlag("0");
        if (suite.getEnabled() == null) {
            suite.setEnabled("1");
        }
        if (suite.getRunner() == null) {
            suite.setRunner("pytest");
        }
        // source_type 不再参与运行时判定(用例来源已上移到 byai_integration_env.case_source),
        // 留空而不是补一个运行时没人认的默认值,免得后来人以为它还在决定用例从哪来。
        integrationSuiteMapper.insert(suite);
        return suite;
    }

    /** 更新用例集字段（仅更新非null属性） */
    public void update(IntegrationSuite suite) {
        suite.setUpdateTime(new Date());
        integrationSuiteMapper.updateById(suite);
    }

    /** 根据ID查询用例集 */
    public IntegrationSuite findById(Long suiteId) {
        return integrationSuiteMapper.selectById(suiteId);
    }

    /** 软删除用例集 */
    public void delete(Long suiteId) {
        IntegrationSuite suite = new IntegrationSuite();
        suite.setSuiteId(suiteId);
        suite.setDeleteFlag("1");
        suite.setUpdateTime(new Date());
        integrationSuiteMapper.updateById(suite);
    }

    /** 启用/停用用例集 */
    public void toggle(Long suiteId, String enabled) {
        IntegrationSuite suite = new IntegrationSuite();
        suite.setSuiteId(suiteId);
        suite.setEnabled(enabled);
        suite.setUpdateTime(new Date());
        integrationSuiteMapper.updateById(suite);
    }

    /** 查询项目下未删除的用例集列表 */
    public List<IntegrationSuite> listByProjectId(Long projectId) {
        LambdaQueryWrapper<IntegrationSuite> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(IntegrationSuite::getProjectId, projectId)
               .eq(IntegrationSuite::getDeleteFlag, "0")
               .orderByDesc(IntegrationSuite::getCreateTime);
        return integrationSuiteMapper.selectList(wrapper);
    }
}
