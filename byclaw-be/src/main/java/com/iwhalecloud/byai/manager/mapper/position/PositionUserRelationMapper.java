package com.iwhalecloud.byai.manager.mapper.position;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.position.PositionUserRelation;
import com.iwhalecloud.byai.manager.qo.position.PositionAdminSearchQO;
import com.iwhalecloud.byai.manager.vo.position.PositionUsersVo;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 数字岗位与管理员用户关系 Mapper
 */
public interface PositionUserRelationMapper extends BaseMapper<PositionUserRelation> {

    /**
     * 查询数字岗位下的管理员用户信息（分页）
     *
     * @param page 分页对象
     * @param searchQO 查询条件
     * @return 用户信息分页列表
     */
    Page<PositionUsersVo> selectUsersByPositionIdPage(Page<PositionUsersVo> page,
        @Param("searchQO") PositionAdminSearchQO searchQO);

    /**
     * 批量保存数字岗位与管理员用户关系
     *
     * @param list 关系列表
     * @return 影响行数
     */
    int saveBatch(@Param("list") List<PositionUserRelation> list);
}
