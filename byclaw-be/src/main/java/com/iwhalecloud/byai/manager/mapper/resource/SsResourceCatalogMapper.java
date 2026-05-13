package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.resource.ResourceCatalogDto;
import com.iwhalecloud.byai.manager.dto.resource.ResourceCatalogTreeVO;
import com.iwhalecloud.byai.manager.qo.organization.CatalogQo;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import com.iwhalecloud.byai.manager.qo.resource.CatalogDto;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;
import org.apache.ibatis.annotations.Param;

/**
 * 资源发布目录表Mapper接口
 */
@Mapper
public interface SsResourceCatalogMapper extends BaseMapper<SsResourceCatalog> {

    List<SsResourceCatalog> queryCatalogTree(CatalogQo catalogQo);

    /**
     * 根据父目录ID查询子目录
     * @param pCatalogId 父目录ID
     * @return 子目录列表
     */
    List<SsResourceCatalog> queryChildrenByParentId(@Param("pCatalogId") Long pCatalogId);

    CatalogDto queryCatalogById(@Param("catalogId") Long catalogId);

    List<ResourceCatalogDto> queryResourceListByCatalogId(@Param("catalogDto") CatalogDto catalogDto);

    /**
     * 查询当前目录及其所有子目录ID。
     *
     * @param catalogId 目录ID
     * @param catalogPath 目录路径
     * @return 目录ID列表
     */
    List<Long> querySelfAndDescendantIds(@Param("catalogId") Long catalogId, @Param("catalogPath") String catalogPath);

    /**
     * 查询资源目录关联树
     * 关联查询 ss_resource 和 ss_resource_catalog 表
     * 查询条件：resource_biz_type = 'OBJECT'，catalog_type IN (6, 7)
     * 
     * @param catalogType 目录类型（可选，6-领域活动对象，7-核心业务对象）
     * @return 资源目录关联列表
     */
    List<ResourceCatalogTreeVO> queryResourceCatalogTree(@Param("catalogType") Integer catalogType);
}
