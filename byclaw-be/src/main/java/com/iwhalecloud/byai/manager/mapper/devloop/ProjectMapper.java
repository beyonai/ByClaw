package com.iwhalecloud.byai.manager.mapper.devloop;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectListDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectQo;

@Mapper
public interface ProjectMapper extends BaseMapper<Project> {

    /**
     * 按条件查询项目列表。
     */
    List<ProjectListDto> selectProjectsByQo(ProjectQo qo);
}
