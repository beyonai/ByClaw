package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.resource.ResourceRelationDto;
import com.iwhalecloud.byai.manager.dto.resource.SsResourceRelDetailDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.qo.resource.ResourceRelationQo;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 资源关联明细表Mapper接口
 */
@Mapper
public interface SsResourceRelDetailMapper extends BaseMapper<SsResourceRelDetail> {

    /**
     * 批量插入资源关联明细
     *
     * @param relDetails 关联明细列表
     * @return 插入成功的记录数
     */
    int insertBatch(@Param("list") List<SsResourceRelDetail> relDetails);


    /**
     * 根据JSON字段中的viewResourceId删除关联关系
     *
     * @param viewResourceId 视图资源ID
     */
    void deleteByViewResourceId(@Param("viewResourceId") Long viewResourceId);

    /**
     * 根据JSON字段中的viewResourceId查询关联关系
     *
     * @param viewResourceId 视图资源ID
     * @return 关联关系列表（包含资源类型字段）
     */
    List<SsResourceRelDetailDTO> findByViewResourceId(@Param("viewResourceId") Long viewResourceId);


    List<SsResourceRelDetailDTO> findByViewResourceIdExceptSelf(@Param("viewResourceId") Long viewResourceId);

    /**
     * 根据主资源ID（resource_id）查询关联关系（所有关联类型）
     *
     * @param resourceId 主资源ID
     * @return 关联关系列表（包含资源类型、业务类型字段）
     */
    List<SsResourceRelDetailDTO> findByResourceIdAsDetail(@Param("resourceId") Long resourceId);

    List<ResourceRelationDto> queryDigEmployeeRelations(@Param("request") ResourceRelationQo request);
}