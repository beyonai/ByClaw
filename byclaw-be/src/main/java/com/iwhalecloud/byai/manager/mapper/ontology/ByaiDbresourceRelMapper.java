package com.iwhalecloud.byai.manager.mapper.ontology;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.ontology.ByaiDbresourceRel;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 数据库资源关联表Mapper接口
 */
@Mapper
public interface ByaiDbresourceRelMapper extends BaseMapper<ByaiDbresourceRel> {

    /**
     * 根据用户ID查询关联关系
     *
     * @param objId 用户ID
     * @return 关联关系列表
     */
    List<ByaiDbresourceRel> findByObjId(@Param("objId") Long objId);

    /**
     * 根据用户ID和对象类型查询关联关系
     *
     * @param objId   用户ID
     * @param objType 对象类型
     * @return 关联关系列表
     */
    List<ByaiDbresourceRel> findByObjIdAndObjType(@Param("objId") Long objId, @Param("objType") String objType);

    /**
     * 根据库ID查询关联关系
     *
     * @param recordId 库ID
     * @return 关联关系列表
     */
    List<ByaiDbresourceRel> findByRecordId(@Param("recordId") Long recordId);

    /**
     * 根据用户ID和库ID查询关联关系
     *
     * @param objId    用户ID
     * @param recordId 库ID
     * @return 关联关系
     */
    ByaiDbresourceRel findByObjIdAndRecordId(@Param("objId") Long objId, @Param("recordId") Long recordId);

    /**
     * 根据用户ID删除关联关系
     *
     * @param objId 用户ID
     * @return 删除的记录数
     */
    int deleteByObjId(@Param("objId") Long objId);

    /**
     * 根据库ID删除关联关系
     *
     * @param recordId 库ID
     * @return 删除的记录数
     */
    int deleteByRecordId(@Param("recordId") Long recordId);

    /**
     * 批量插入关联关系
     *
     * @param list 关联关系列表
     * @return 插入成功的记录数
     */
    int insertBatch(@Param("list") List<ByaiDbresourceRel> list);
}

