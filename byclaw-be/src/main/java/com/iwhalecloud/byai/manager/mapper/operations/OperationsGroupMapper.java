package com.iwhalecloud.byai.manager.mapper.operations;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 公共库工作组的运营只读投影。 */
@Mapper
public interface OperationsGroupMapper {
    List<Map<String, Object>> sources(@Param("afterId") long afterId);
    List<Map<String, Object>> groups(@Param("enterpriseId") long enterpriseId,
        @Param("keyword") String keyword, @Param("status") String status);
    Map<String, Object> detail(@Param("enterpriseId") long enterpriseId, @Param("id") long id);
    List<Map<String, Object>> members(@Param("enterpriseId") long enterpriseId, @Param("id") long id);
    List<Map<String, Object>> conversations(@Param("enterpriseId") long enterpriseId, @Param("id") long id);
}
