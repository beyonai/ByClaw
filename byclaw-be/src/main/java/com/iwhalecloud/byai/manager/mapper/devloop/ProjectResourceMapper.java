package com.iwhalecloud.byai.manager.mapper.devloop;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectBoundResourceDto;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectResource;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface ProjectResourceMapper extends BaseMapper<ProjectResource> {

    /**
     * 按项目 ID 关联查询平台资源（名称、编码）及项目绑定类型。
     *
     * @param projectId 项目 ID
     * @return 绑定资源列表
     */
    List<ProjectBoundResourceDto> listResourceByProjectId(@Param("projectId") Long projectId);
}
