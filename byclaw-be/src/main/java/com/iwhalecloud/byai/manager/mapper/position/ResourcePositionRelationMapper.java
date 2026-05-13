package com.iwhalecloud.byai.manager.mapper.position;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.position.ResourcePositionRelation;
import com.iwhalecloud.byai.manager.qo.position.PositionResourceSearchQO;
import com.iwhalecloud.byai.manager.vo.position.PositionDigitalEmployeeVo;
import org.apache.ibatis.annotations.Param;

/**
 * 数字岗位与数字员工关系 Mapper
 */
public interface ResourcePositionRelationMapper extends BaseMapper<ResourcePositionRelation> {


    /**
     * 查询岗位下的数字员工信息（分页）
     *
     * @param page 分页对象
     * @param searchQO 查询条件
     * @return 岗位数字员工信息分页列表
     */
    Page<PositionDigitalEmployeeVo> selectDigitalEmployeesByPositionIdPage(Page<PositionDigitalEmployeeVo> page,
        @Param("searchQO") PositionResourceSearchQO searchQO);
}
