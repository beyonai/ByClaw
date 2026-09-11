package com.iwhalecloud.byai.manager.mapper.datasource;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface ProjectDataSourceMapper {
    @Insert("INSERT INTO byai_project_datasource (project_id, datasource_id, create_by, create_time) "
        + "VALUES (#{projectId}, #{datasourceId}, #{userId}, CURRENT_TIMESTAMP)")
    int bind(@Param("projectId") Long projectId, @Param("datasourceId") Long datasourceId, @Param("userId") Long userId);

    @Select("SELECT COUNT(*) FROM byai_project_datasource WHERE project_id = #{projectId} AND datasource_id = #{datasourceId}")
    int countBinding(@Param("projectId") Long projectId, @Param("datasourceId") Long datasourceId);

    @Delete("DELETE FROM byai_project_datasource WHERE project_id = #{projectId} AND datasource_id = #{datasourceId}")
    int unbind(@Param("projectId") Long projectId, @Param("datasourceId") Long datasourceId);

    @Delete("DELETE FROM byai_project_datasource WHERE datasource_id = #{datasourceId}")
    int deleteForSource(@Param("datasourceId") Long datasourceId);
}
