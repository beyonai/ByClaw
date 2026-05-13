package com.iwhalecloud.byai.manager.mapper.tag;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.tag.ByaiTagRelation;
import java.util.List;
import org.apache.ibatis.annotations.Param;

/**
 * 标签关系表Mapper
 */
public interface ByaiTagRelationMapper extends BaseMapper<ByaiTagRelation> {

    /**
     * 根据对象类型和对象ID列表批量查询标签ID
     *
     * @param objType 对象类型
     * @param objIds  对象ID列表
     * @return 标签ID列表（去重）
     */
    List<Long> findTagIdsByObjTypeAndObjIds(@Param("objType") String objType, @Param("objIds") List<Long> objIds);

    /**
     * 按对象类型+对象ID删除该对象下所有标签关系（用于模型能力关联先删后插）
     *
     * @param objType 对象类型（如 byai_aimodel）
     * @param objId   对象ID（如模型主键）
     * @return 删除行数
     */
    int deleteByObjTypeAndObjId(@Param("objType") String objType, @Param("objId") String objId);

    /**
     * 批量插入标签关系（用于模型-能力关联一次性写入）
     *
     * @param list 待插入实体列表（relation_id、tag_id 等已填充）
     * @return 插入行数
     */
    int insertBatch(@Param("list") List<ByaiTagRelation> list);

}


