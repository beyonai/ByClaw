package com.iwhalecloud.byai.manager.mapper.datasource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.datasource.Datasource;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import java.util.List;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourceQueryDto;

@Mapper
public interface DataSourceMapper extends BaseMapper<Datasource> {
    // 普通 UPDATE 获取事务写锁，避免不同数据库的 SELECT 锁定语法差异。
    @Update("UPDATE byai_datasource SET datasource_id = datasource_id WHERE datasource_id = #{id}")
    int lockRow(@Param("id") Long id);

    default Datasource lockById(Long id) {
        lockRow(id);
        return selectById(id);
    }

    @Select("SELECT d.* FROM byai_datasource d JOIN byai_project_datasource r "
        + "ON r.datasource_id = d.datasource_id WHERE r.project_id = #{projectId} "
        + "ORDER BY d.create_time DESC, d.datasource_id DESC")
    List<Datasource> listByProject(@Param("projectId") Long projectId);

    @Select("SELECT d.* FROM byai_datasource d WHERE d.create_by = #{userId} "
        + "AND NOT EXISTS (SELECT 1 FROM byai_project_datasource r WHERE r.datasource_id = d.datasource_id "
        + "AND r.project_id = #{projectId}) ORDER BY d.create_time DESC, d.datasource_id DESC")
    List<Datasource> listAvailable(@Param("projectId") Long projectId, @Param("userId") Long userId);
    String QUERY_FILTER = " FROM byai_datasource d JOIN byai_project_datasource r "
        + "ON r.datasource_id = d.datasource_id WHERE r.project_id = #{projectId} "
        + "<if test='query.resourceId != null'> AND d.datasource_id = #{query.resourceId}</if>"
        + "<if test='query.keyword != null'> AND LOWER(d.datasource_name) LIKE LOWER(#{keywordPattern}) ESCAPE '!'</if>"
        + "<if test='query.datasourceType != null'> AND d.datasource_type = #{query.datasourceType}</if>";

    // 模式值在 Java 中拼接并转义，始终通过参数绑定传入 SQL。
    static String keywordPattern(SessionResourceQueryDto query) {
        return query.getKeyword() == null ? null : "%" + query.getKeyword()
            .replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
    }

    default List<Datasource> query(Long projectId, SessionResourceQueryDto query, long offset) {
        Page<Datasource> page = new Page<>(offset / query.getPageSize() + 1, query.getPageSize(), false);
        return queryPage(page, projectId, query, keywordPattern(query));
    }

    @Select("<script>SELECT d.*" + QUERY_FILTER
        + " ORDER BY d.create_time DESC, d.datasource_id DESC</script>")
    List<Datasource> queryPage(Page<Datasource> page, @Param("projectId") Long projectId,
        @Param("query") SessionResourceQueryDto query, @Param("keywordPattern") String keywordPattern);

    @Select("<script>SELECT COUNT(*)" + QUERY_FILTER + "</script>")
    long countFiltered(@Param("projectId") Long projectId, @Param("query") SessionResourceQueryDto query,
        @Param("keywordPattern") String keywordPattern);

    default long countQuery(Long projectId, SessionResourceQueryDto query) {
        return countFiltered(projectId, query, keywordPattern(query));
    }
}
