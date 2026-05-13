package com.iwhalecloud.byai.manager.mapper.position;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.position.CatalogWithPositionsDTO;
import com.iwhalecloud.byai.manager.dto.position.DigitalPositionDTO;
import com.iwhalecloud.byai.manager.entity.position.PositionExtCatalog;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 领域与岗位关系 Mapper
 */
public interface PositionExtCatalogMapper extends BaseMapper<PositionExtCatalog> {

    /**
     * 校验指定领域下数字岗位名称是否重复
     *
     * @param catalogIds 领域ID集合
     * @param positionName 岗位名称
     * @return 重复数量
     */
    Long countPositionNameInCatalogs(@Param("catalogIds") List<Long> catalogIds,
        @Param("positionName") String positionName);

    /**
     * 批量插入岗位-领域关系
     *
     * @param list 关系集合
     * @return 影响行数
     */
    int saveBatch(@Param("list") List<PositionExtCatalog> list);

    /**
     * 查询数字岗位列表（包含领域信息）
     *
     * @param catalogId 领域ID（可选，为空时查询所有数字岗位）
     * @param positionName 岗位名称（可选，模糊查询）
     * @return 数字岗位列表
     */
    List<DigitalPositionDTO> selectDigitalPositionsByCatalog(
        @Param("catalogId") Long catalogId,
        @Param("positionName") String positionName);

    /**
     * 查询领域及其关联的数字岗位列表
     *
     * @param catalogId 领域ID（可选，为空时查询所有领域）
     * @param positionName 岗位名称（可选，模糊查询）
     * @return 领域及其岗位列表
     */
    List<CatalogWithPositionsDTO> selectCatalogsWithPositions(
        @Param("catalogId") Long catalogId,
        @Param("positionName") String positionName);
}

