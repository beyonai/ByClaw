package com.iwhalecloud.byai.manager.mapper.devloop;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectSession;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface ProjectSessionMapper extends BaseMapper<ProjectSession> {

    /**
     * 查询项目下的有效会话，按最近更新时间排序。
     */
    List<ByaiSessionDto> selectSessionsByProjectId(@Param("projectId") Long projectId);

    /**
     * 统计项目下的有效会话数量。
     */
    Long countSessionsByProjectId(@Param("projectId") Long projectId);
}
