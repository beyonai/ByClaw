package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectListDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectQo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-07-22 16:27:27
 * @description TODO
 */
@Service
public class ProjectService {

    private static final String DELETE_FLAG_NORMAL = "0";

    @Autowired
    private ProjectMapper projectMapper;

    public void save(Project project) {
        projectMapper.insert(project);
    }

    public void update(Project project) {
        projectMapper.updateById(project);
    }

    public Project findById(Long projectId) {
        return projectMapper.selectById(projectId);
    }

    public List<ProjectListDto> selectProjectsByQo(ProjectQo projectQo) {
        return projectMapper.selectProjectsByQo(projectQo);
    }

    /**
     * 判断项目名称是否已存在。
     *
     * @param projectName 项目名称
     * @param excludeProjectId 编辑时排除自身，可为 null
     */
    public boolean existsProjectName(String projectName, Long excludeProjectId) {
        LambdaQueryWrapper<Project> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Project::getDeleteFlag, DELETE_FLAG_NORMAL).eq(Project::getProjectName, projectName);
        if (excludeProjectId != null) {
            wrapper.ne(Project::getProjectId, excludeProjectId);
        }
        // 新建/编辑统一以后端最终入库名称为准查重，避免并发或绕过前端导致同名项目。
        Long count = projectMapper.selectCount(wrapper);
        return count != null && count > 0;
    }

}
