package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.devloop.OperationRequirement;
import com.iwhalecloud.byai.manager.mapper.devloop.OperationRequirementMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;

/**
 * 运营需求领域服务。
 * 与研发扫描服务分离，防止运营项目的状态与配置字段侵入扫描需求链路。
 */
@Service
public class OperationRequirementService {

    @Autowired
    private OperationRequirementMapper operationRequirementMapper;

    @Autowired
    private SequenceService sequenceService;

    /** 创建运营需求并补齐系统字段。 */
    public OperationRequirement create(OperationRequirement requirement) {
        requirement.setItemId(sequenceService.nextVal());
        requirement.setCreateTime(new Date());
        requirement.setDeleteFlag("0");
        operationRequirementMapper.insert(requirement);
        return requirement;
    }

    /** 按主键查询有效运营需求。 */
    public OperationRequirement findById(Long itemId) {
        OperationRequirement requirement = operationRequirementMapper.selectById(itemId);
        return requirement != null && "0".equals(requirement.getDeleteFlag()) ? requirement : null;
    }

    /** 更新非空字段，并记录更新时间。 */
    public void update(OperationRequirement requirement) {
        requirement.setUpdateTime(new Date());
        operationRequirementMapper.updateById(requirement);
    }

    /** 逻辑删除运营需求，保留审计与历史执行记录。 */
    public void delete(Long itemId, Long updateBy) {
        OperationRequirement requirement = new OperationRequirement();
        requirement.setItemId(itemId);
        requirement.setDeleteFlag("1");
        requirement.setUpdateBy(updateBy);
        requirement.setUpdateTime(new Date());
        operationRequirementMapper.updateById(requirement);
    }

    /** 按项目分页查询运营需求，名称筛选统一忽略大小写。 */
    public Page<OperationRequirement> pageByProjectId(Long projectId, String keyword, int pageNum, int pageSize) {
        LambdaQueryWrapper<OperationRequirement> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(OperationRequirement::getProjectId, projectId).eq(OperationRequirement::getDeleteFlag, "0");
        String normalizedKeyword = StringUtils.trimToNull(keyword);
        if (normalizedKeyword != null) {
            // PostgreSQL 的 LIKE 区分大小写，运营需求搜索与项目空间其他列表保持相同口径。
            wrapper.apply("LOWER(title) LIKE {0}", "%" + normalizedKeyword.toLowerCase(java.util.Locale.ROOT) + "%");
        }
        wrapper.orderByDesc(OperationRequirement::getCreateTime).orderByDesc(OperationRequirement::getItemId);
        return operationRequirementMapper.selectPage(new Page<>(pageNum, pageSize), wrapper);
    }
}
