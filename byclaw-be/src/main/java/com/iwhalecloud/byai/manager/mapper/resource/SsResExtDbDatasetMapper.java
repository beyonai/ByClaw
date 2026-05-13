package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDbDataset;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;

/**
 * 数据集扩展表Mapper接口
 */
@Mapper
public interface SsResExtDbDatasetMapper extends BaseMapper<SsResExtDbDataset> {

    /**
     * 根据资源ID查询数据集信息
     * 
     * @param resourceId 资源标识
     * @return 数据集信息
     */
    SsResExtDbDataset selectByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 根据资源ID查询数据集信息列表（防御性，不加LIMIT）
     *
     * @param resourceId 资源标识
     * @return 数据集信息列表
     */
    List<SsResExtDbDataset> selectListByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 根据资源ID列表批量查询数据集信息
     *
     * @param resourceIds 资源ID列表
     * @return 数据集信息列表
     */
    List<SsResExtDbDataset> selectListByResourceIds(@Param("resourceIds") List<Long> resourceIds);

}

