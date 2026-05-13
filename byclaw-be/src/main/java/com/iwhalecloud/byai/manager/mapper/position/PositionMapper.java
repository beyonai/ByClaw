package com.iwhalecloud.byai.manager.mapper.position;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.qo.position.PositionQo;
import com.iwhalecloud.byai.manager.qo.position.PositionUsersQo;
import com.iwhalecloud.byai.manager.vo.position.PositionUsersVo;
import com.iwhalecloud.byai.manager.dto.position.PositionDTO;
import org.apache.ibatis.annotations.Param;

import java.util.List;

public interface PositionMapper extends BaseMapper<Position> {

    /**
     * 岗位分页查询
     * 
     * @param page 分页参数
     * @param positionQo 查询对象
     * @return List<Position>
     */
    List<Position> searchPositionList(Page<Position> page, @Param("positionQo") PositionQo positionQo);

    /**
     * 查询用户下的岗位信息
     * 
     * @param page 分页信息
     * @param positionUsersQo 查询对象
     * @return Page<PositionUsersVo>
     */
    Page<PositionUsersVo> searchPositionUsersByQo(Page<PositionUsersVo> page,
        @Param("positionUsersQo") PositionUsersQo positionUsersQo);

    /***
     * 统计数量
     * 
     * @param positionName 岗位名称
     * @param positionIdNotEqual 岗位标识
     * @return Long
     */
    Long countPosition(@Param("positionName") String positionName,
        @Param("positionIdNotEqual") Long positionIdNotEqual);

    /***
     * 统计是否被使用
     * 
     * @param positionId 岗位标识
     * @return Long
     */
    Long countUsed(@Param("positionId") Long positionId);

    /**
     * 查询用户的岗位信息
     * 
     * @param userId 用户标识
     * @return Position
     */
    List<PositionDTO> findPositionByUserId(@Param("userId") Long userId);

}
