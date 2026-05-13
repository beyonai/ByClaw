package com.iwhalecloud.byai.manager.mapper.operations;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.operations.QueryConfigListDTO;
import com.iwhalecloud.byai.manager.entity.operations.QueryConfig;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Param;

/**
 * 查询配置Mapper接口
 * 
 * @author ByAI Team
 * @date 2025-10-30
 */
public interface QueryConfigMapper extends BaseMapper<QueryConfig> {

    /**
     * 根据查询编码获取查询配置
     * 
     * @param queryCode 查询编码
     * @return 查询配置
     */
    QueryConfig selectByQueryCode(@Param("queryCode") String queryCode);

    /**
     * 根据查询编码和查询类型获取查询配置
     * 
     * @param queryCode 查询编码
     * @return 查询配置
     */
    QueryConfig selectByQueryCodeAndType(@Param("queryCode") String queryCode);

    /**
     * 执行动态SQL查询
     * 
     * @param sqlTemplate SQL模板
     * @return 查询结果列表
     */
    List<Map<String, Object>> executeDynamicSql(@Param("sqlTemplate") String sqlTemplate);

    /**
     * 查询所有启用的查询配置列表（不包含SQL模板�?
     * 
     * @return 查询配置列表
     */
    List<QueryConfigListDTO> selectAllConfigList();
}
