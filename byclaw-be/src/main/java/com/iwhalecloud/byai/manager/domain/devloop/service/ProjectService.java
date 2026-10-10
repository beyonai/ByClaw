package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.constants.devloop.ProjectType;
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

    /** 按实际绑定的云盘资源反查项目，避免相信客户端传入的项目身份。 */
    public List<Project> findByCloudResourceId(Long resourceId) {
        return projectMapper.selectList(new LambdaQueryWrapper<Project>()
            .eq(Project::getCloudResourceId, resourceId));
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
     * 判断同一租户、同一创建者的未删除项目中是否已有该名称。
     *
     * @param projectName      项目名称
     * @param createBy         项目创建者，共享项目不占用其他用户的名称
     * @param enterpriseId     已验证的租户 ID；默认空间兼容历史 NULL 企业值
     * @param excludeProjectId 编辑时排除自身，可为 null
     */
    public boolean existsProjectName(String projectName, Long createBy, Long enterpriseId, Long excludeProjectId) {
        return countNameConflicts(projectName, createBy, enterpriseId, excludeProjectId, false);
    }

    /** 工作组项目历史永远保留，工作组是否占名由其实际会话生命周期判断。 */
    public boolean existsNonWorkgroupProjectName(String projectName, Long createBy, Long enterpriseId) {
        return countNameConflicts(projectName, createBy, enterpriseId, null, true);
    }

    private boolean countNameConflicts(String projectName, Long createBy, Long enterpriseId,
        Long excludeProjectId, boolean excludeWorkgroups) {
        LambdaQueryWrapper<Project> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Project::getDeleteFlag, DELETE_FLAG_NORMAL)
            .eq(Project::getCreateBy, createBy)
            .eq(Project::getProjectName, projectName);
        long tenantId = enterpriseId == null ? 1L : enterpriseId;
        wrapper.and(scope -> {
            scope.eq(Project::getEnterpriseId, tenantId);
            if (tenantId == 1L) scope.or().isNull(Project::getEnterpriseId);
        });
        if (excludeWorkgroups) {
            wrapper.and(type -> type.ne(Project::getProjectType, ProjectType.HACU)
                .or().isNull(Project::getProjectType));
        }
        if (excludeProjectId != null) {
            wrapper.ne(Project::getProjectId, excludeProjectId);
        }
        // 创建者和租户共同限定名称范围；其他用户或其他租户不占名。
        Long count = projectMapper.selectCount(wrapper);
        return count != null && count > 0;
    }


}
