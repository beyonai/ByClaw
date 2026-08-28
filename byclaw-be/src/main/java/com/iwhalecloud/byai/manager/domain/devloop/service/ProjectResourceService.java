package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.devloop.DeleteFlag;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectBoundResourceDto;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectResource;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectResourceMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;

/**
 * 项目资源绑定领域服务。
 * <p>
 * 负责项目与知识库、数字员工、本体之间绑定关系的增删改查。
 */
@Service
public class ProjectResourceService {

    @Autowired
    private ProjectResourceMapper projectResourceMapper;

    /**
     * 新增一条项目资源绑定。
     *
     * @param projectResource 绑定实体
     */
    public void save(ProjectResource projectResource) {
        projectResourceMapper.insert(projectResource);
    }

    /**
     * 按主键更新项目资源绑定。
     *
     * @param projectResource 绑定实体
     */
    public void update(ProjectResource projectResource) {
        projectResourceMapper.updateById(projectResource);
    }

    /**
     * 按主键查询绑定。
     *
     * @param id 绑定主键
     * @return 绑定实体，不存在则返回 null
     */
    public ProjectResource findById(Long id) {
        return projectResourceMapper.selectById(id);
    }

    /**
     * 按项目 ID 查询未删除的资源绑定，按类型、排序号、主键升序。
     *
     * @param projectId 项目 ID
     * @return 绑定列表；无数据时返回空列表
     */
    public List<ProjectResource> listByProjectId(Long projectId) {
        LambdaQueryWrapper<ProjectResource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectResource::getProjectId, projectId)
            .and(item -> item.isNull(ProjectResource::getDeleteFlag)
                .or().ne(ProjectResource::getDeleteFlag, DeleteFlag.DELETED))
            .orderByAsc(ProjectResource::getResourceType)
            .orderByAsc(ProjectResource::getSortNo)
            .orderByAsc(ProjectResource::getId);
        return projectResourceMapper.selectList(wrapper);
    }

    /**
     * 按项目 ID 物理删除全部资源绑定，供全量覆盖保存复用。
     *
     * @param projectId 项目 ID
     */
    public void deleteByProjectId(Long projectId) {
        projectResourceMapper.delete(new LambdaQueryWrapper<ProjectResource>()
            .eq(ProjectResource::getProjectId, projectId));
    }


    /**
     * 按项目 ID 关联查询平台资源实时信息（resource_id / name / code）及绑定类型。
     *
     * @param projectId 项目 ID
     * @return 绑定资源列表；projectId 为空或无数据时返回空列表
     */
    public List<ProjectBoundResourceDto> listBoundResourceByProjectId(Long projectId) {
        if (projectId == null) {
            return Collections.emptyList();
        }
        return projectResourceMapper.listResourceByProjectId(projectId);
    }

}
