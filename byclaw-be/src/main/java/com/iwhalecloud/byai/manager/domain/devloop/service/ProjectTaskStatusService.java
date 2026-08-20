package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectTaskStatus;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectTaskStatusMapper;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;

/**
 * 项目状态领域服务。
 */
@Service
public class ProjectTaskStatusService {

    private static final String STATUS_CD_VALID = "00A";

    @Autowired
    private ProjectTaskStatusMapper projectTaskStatusMapper;

    /**
     * 查询项目下有效的状态字典。
     *
     * @param projectId 项目ID
     * @param dimensionName 状态维度，空则返回全部维度
     * @return 按 sort_order 排序的状态列表
     */
    public List<ProjectTaskStatus> listByProjectId(Long projectId, String dimensionName) {
        if (projectId == null) {
            return Collections.emptyList();
        }
        return projectTaskStatusMapper.selectList(new LambdaQueryWrapper<ProjectTaskStatus>()
            .eq(ProjectTaskStatus::getProjectId, projectId)
            .eq(ProjectTaskStatus::getStatusCd, STATUS_CD_VALID)
            .eq(StringUtils.isNotBlank(dimensionName), ProjectTaskStatus::getDimensionName, dimensionName)
            .orderByAsc(ProjectTaskStatus::getSortOrder)
            .orderByAsc(ProjectTaskStatus::getStatusId));
    }
}
