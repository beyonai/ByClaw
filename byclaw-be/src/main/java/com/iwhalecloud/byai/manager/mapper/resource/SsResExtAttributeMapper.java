package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAttribute;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Collection;
import java.util.List;

/**
 * 资源扩展属性表Mapper接口
 */
@Mapper
public interface SsResExtAttributeMapper extends BaseMapper<SsResExtAttribute> {

    /**
     * 根据资源ID查询扩展属性列表
     * 
     * @param resourceId 资源标识
     * @return 扩展属性列表
     */
    List<SsResExtAttribute> selectByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 根据资源ID列表批量查询扩展属性列表
     * 
     * @param resourceIds 资源标识列表
     * @return 扩展属性列表
     */
    List<SsResExtAttribute> selectByResourceIds(@Param("resourceIds") Collection<Long> resourceIds);

    /**
     * 根据资源ID和属性类型查询扩展属性列表
     * 
     * @param resourceId 资源标识
     * @param attributeType 属性类型
     * @return 扩展属性列表
     */
    List<SsResExtAttribute> selectByResourceIdAndType(@Param("resourceId") Long resourceId, 
                                                      @Param("attributeType") String attributeType);

    /**
     * 批量插入扩展属性
     * 
     * @param list 扩展属性列表
     * @return 插入的记录数
     */
    int insertBatch(@Param("list") List<SsResExtAttribute> list);

    /**
     * 批量更新扩展属性
     * 
     * @param list 扩展属性列表
     * @return 更新的记录数
     */
    int updateBatch(@Param("list") List<SsResExtAttribute> list);

}

