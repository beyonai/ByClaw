package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationEnv;
import com.iwhalecloud.byai.manager.mapper.devloop.IntegrationEnvMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

/**
 * 集成测试环境领域服务
 * 提供集成测试环境的增删改查
 */
@Slf4j
@Service
public class IntegrationEnvService {

    @Autowired
    private IntegrationEnvMapper integrationEnvMapper;

    @Autowired
    private SequenceService sequenceService;

    /** 创建集成测试环境，自动生成ID和初始状态 */
    public IntegrationEnv create(IntegrationEnv env) {
        env.setEnvId(sequenceService.nextVal());
        env.setCreateTime(new Date());
        env.setDeleteFlag("0");
        if (env.getOrchestrator() == null) {
            env.setOrchestrator("script");
        }
        if (env.getConnProtocol() == null) {
            env.setConnProtocol("ssh");
        }
        integrationEnvMapper.insert(env);
        return env;
    }

    /** 更新集成测试环境字段（仅更新非null属性） */
    public void update(IntegrationEnv env) {
        env.setUpdateTime(new Date());
        integrationEnvMapper.updateById(env);
    }

    /** 根据ID查询集成测试环境 */
    public IntegrationEnv findById(Long envId) {
        return integrationEnvMapper.selectById(envId);
    }

    /** 软删除集成测试环境 */
    public void delete(Long envId) {
        IntegrationEnv env = new IntegrationEnv();
        env.setEnvId(envId);
        env.setDeleteFlag("1");
        env.setUpdateTime(new Date());
        integrationEnvMapper.updateById(env);
    }

    /** 查询项目下未删除的集成测试环境列表 */
    public List<IntegrationEnv> listByProjectId(Long projectId) {
        LambdaQueryWrapper<IntegrationEnv> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(IntegrationEnv::getProjectId, projectId)
               .eq(IntegrationEnv::getDeleteFlag, "0")
               .orderByDesc(IntegrationEnv::getCreateTime);
        return integrationEnvMapper.selectList(wrapper);
    }
}
