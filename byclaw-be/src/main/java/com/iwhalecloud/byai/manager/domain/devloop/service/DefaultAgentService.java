package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.DefaultAgent;
import com.iwhalecloud.byai.manager.mapper.devloop.DefaultAgentMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.function.Function;

/**
 * 默认助理领域服务。
 * 每个作用域(全局 project_id=0 或某项目)仅一行有效配置,保存走 upsert;
 * 解析时把项目覆盖合并到全局默认之上,得到各角色生效员工。
 */
@Slf4j
@Service
public class DefaultAgentService {

    /** 全局默认作用域的固定 project_id。 */
    public static final long GLOBAL_SCOPE = 0L;

    @Autowired
    private DefaultAgentMapper defaultAgentMapper;

    @Autowired
    private SequenceService sequenceService;

    /** 查询某作用域(全局或项目)的原始配置行,不存在返回 null。 */
    public DefaultAgent findByScope(Long projectId) {
        long scope = projectId == null ? GLOBAL_SCOPE : projectId;
        LambdaQueryWrapper<DefaultAgent> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(DefaultAgent::getProjectId, scope)
               .eq(DefaultAgent::getDeleteFlag, "0")
               .last("LIMIT 1");
        return defaultAgentMapper.selectOne(wrapper);
    }

    /** 保存某作用域配置:已存在则更新,否则新建(每作用域唯一)。 */
    public DefaultAgent save(DefaultAgent input, Long operatorId) {
        long scope = input.getProjectId() == null ? GLOBAL_SCOPE : input.getProjectId();
        input.setProjectId(scope);
        DefaultAgent existing = findByScope(scope);
        Date now = new Date();
        if (existing == null) {
            input.setId(sequenceService.nextVal());
            input.setCreateBy(operatorId);
            input.setCreateTime(now);
            input.setDeleteFlag("0");
            defaultAgentMapper.insert(input);
            return input;
        }
        // 覆盖式更新:各角色字段整体以入参为准(空即清除该角色指定),避免残留旧值造成"删不掉"。
        existing.setArchitectAgentId(input.getArchitectAgentId());
        existing.setArchitectAgentName(input.getArchitectAgentName());
        existing.setRequirementAgentId(input.getRequirementAgentId());
        existing.setRequirementAgentName(input.getRequirementAgentName());
        existing.setCoderAgentId(input.getCoderAgentId());
        existing.setCoderAgentName(input.getCoderAgentName());
        existing.setTesterAgentId(input.getTesterAgentId());
        existing.setTesterAgentName(input.getTesterAgentName());
        existing.setUpdateBy(operatorId);
        existing.setUpdateTime(now);
        defaultAgentMapper.updateById(existing);
        return existing;
    }

    /**
     * 解析项目各角色生效的默认员工:项目覆盖优先,缺省回退全局默认。
     * 返回的 DefaultAgent 仅承载合并后的各角色字段(id/时间等无意义)。
     */
    public DefaultAgent resolveForProject(Long projectId) {
        DefaultAgent global = findByScope(GLOBAL_SCOPE);
        DefaultAgent override = projectId == null ? null : findByScope(projectId);
        DefaultAgent merged = new DefaultAgent();
        merged.setProjectId(projectId);
        merged.setArchitectAgentId(pick(override, global, DefaultAgent::getArchitectAgentId));
        merged.setArchitectAgentName(pick(override, global, DefaultAgent::getArchitectAgentName));
        merged.setRequirementAgentId(pick(override, global, DefaultAgent::getRequirementAgentId));
        merged.setRequirementAgentName(pick(override, global, DefaultAgent::getRequirementAgentName));
        merged.setCoderAgentId(pick(override, global, DefaultAgent::getCoderAgentId));
        merged.setCoderAgentName(pick(override, global, DefaultAgent::getCoderAgentName));
        merged.setTesterAgentId(pick(override, global, DefaultAgent::getTesterAgentId));
        merged.setTesterAgentName(pick(override, global, DefaultAgent::getTesterAgentName));
        return merged;
    }

    /** 取单个角色字段:项目覆盖值优先,空(null/空串)或无覆盖行则回退全局默认行。 */
    private String pick(DefaultAgent override, DefaultAgent global, Function<DefaultAgent, String> field) {
        String value = override == null ? null : field.apply(override);
        if (value != null && !value.isEmpty()) {
            return value;
        }
        return global == null ? null : field.apply(global);
    }
}
