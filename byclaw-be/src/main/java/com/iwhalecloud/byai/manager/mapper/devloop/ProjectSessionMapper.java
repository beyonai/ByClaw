package com.iwhalecloud.byai.manager.mapper.devloop;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectSession;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectSessionQo;

@Mapper
public interface ProjectSessionMapper extends BaseMapper<ProjectSession> {

    /**
     * 查询项目下的有效会话，按最近更新时间排序。
     */
    List<ByaiSessionDto> selectSessionsByProjectId(@Param("projectId") Long projectId);

    /**
     * 按查询条件查询项目下的有效会话。
     */
    List<ByaiSessionDto> selectSessionsByProjectByQo(ProjectSessionQo qo);

    /**
     * 统计项目下的有效会话数量。
     */
    Long countSessionsByProjectId(@Param("projectId") Long projectId);
}
