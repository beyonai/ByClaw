package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
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

    /**
     * 新增项目。
     *
     * @param project 项目实体
     */
    public void save(Project project) {
        projectMapper.insert(project);
    }

    /**
     * 按主键更新项目。
     *
     * @param project 项目实体
     */
    public void update(Project project) {
        projectMapper.updateById(project);
    }

    /**
     * 按项目 ID 查询。
     *
     * @param projectId 项目 ID
     * @return 项目实体，不存在则返回 null
     */
    public Project findById(Long projectId) {
        return projectMapper.selectById(projectId);
    }


    /**
     * 按项目编码查询。
     *
     * @param projectCode 项目编码
     * @return 项目实体，不存在则返回 null
     */
    public Project findByProjectCode(String projectCode) {
        LambdaQueryWrapper<Project> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Project::getProjectCode, projectCode);
        return projectMapper.selectOne(wrapper, false);
    }

    /**
     * 分页查询用户可见项目
     *
     * @param projectQo 查询对象
     * @return PageInfo<ProjectListDto>
     */
    public PageInfo<ProjectListDto> selectProjectsByQo(ProjectQo projectQo) {
        Long defaultCount = projectMapper.countDefaultProject(projectQo.getCreateBy());
        projectQo.setDefaultCount(defaultCount == null ? 0L : defaultCount);

        Page<ProjectListDto> page = PageHelper.startPage(projectQo.getPageNum(), projectQo.getPageSize());
        projectMapper.selectProjectsByQo(projectQo);
        return PageHelperUtil.toPageInfo(page);
    }


    /**
     * 判断项目名称是否已存在。
     *
     * @param projectName      项目名称
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
