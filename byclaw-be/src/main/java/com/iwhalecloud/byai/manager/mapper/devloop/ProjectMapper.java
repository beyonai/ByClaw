package com.iwhalecloud.byai.manager.mapper.devloop;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectListDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectQo;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface ProjectMapper extends BaseMapper<Project> {

    /**
     * 按条件查询项目列表。
     */
    List<ProjectListDto> selectProjectsByQo(ProjectQo qo);

    /**
     * 查询用户可见的、未删除的研发项目，用于用户配置 GitHub 凭据后的文件同步。
     */
    List<Long> selectVisibleDevelopProjectIds(@Param("userId") Long userId);

    /**
     * 统计当前用户可见的默认项目数量（系统默认 project_id &lt; 0 或本人创建），
     * 供列表查询决定是否自动带上 project_type = 'default'。
     */
    Long countDefaultProject(@Param("createBy") Long createBy);
}
