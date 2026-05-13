package com.iwhalecloud.byai.manager.mapper.ontology;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.ontology.SsResExtOntology;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Collection;
import java.util.List;

/**
 * 本体资源扩展表Mapper接口
 * 
 * @author system
 * @date 2025-01-XX
 */
@Mapper
public interface SsResExtOntologyMapper extends BaseMapper<SsResExtOntology> {

    /**
     * 根据资源ID查询本体扩展信息
     * 
     * @param resourceId 资源标识
     * @return 本体扩展信息
     */
    SsResExtOntology selectByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 根据资源ID列表批量查询本体扩展信息
     * 
     * @param resourceIds 资源标识列表
     * @return 本体扩展信息列表
     */
    List<SsResExtOntology> selectByResourceIds(@Param("resourceIds") Collection<Long> resourceIds);

    /**
     * 根据项目ID查询本体扩展信息列表
     * 
     * @param pid 项目ID
     * @return 本体扩展信息列表
     */
    List<SsResExtOntology> selectByPid(@Param("pid") String pid);

    /**
     * 插入本体扩展信息
     * 
     * @param ssResExtOntology 本体扩展信息
     * @return 插入的记录数
     */
    int insert(SsResExtOntology ssResExtOntology);

    /**
     * 批量插入本体扩展信息
     * 
     * @param list 本体扩展信息列表
     * @return 插入的记录数
     */
    int insertBatch(@Param("list") List<SsResExtOntology> list);

    /**
     * 根据资源ID删除本体扩展信息
     * 
     * @param resourceId 资源标识
     * @return 删除的记录数
     */
    int deleteByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 根据资源ID列表批量删除本体扩展信息
     * 
     * @param resourceIds 资源标识列表
     * @return 删除的记录数
     */
    int deleteByResourceIds(@Param("resourceIds") Collection<Long> resourceIds);

}

