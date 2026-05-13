package com.iwhalecloud.byai.manager.mapper.station;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.station.Station;
import com.iwhalecloud.byai.manager.qo.station.StationTreeQo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 驻地信息Mapper
 * 对应表：po_station
 */
@Mapper
public interface StationMapper extends BaseMapper<Station> {

    /**
     * 查询驻地树
     *
     * @param stationTreeQo 查询条件
     * @return 驻地树列表
     */
    List<Station> getStationTree(StationTreeQo stationTreeQo);

    Station getStationByUserId(@Param("userId") Long userId);

    /**
     * 通过模糊查询驻地路径获取所有下属驻地ID（包含自身）
     * 
     * @param stationId 驻地ID
     * @return 驻地ID列表
     */
    List<Long> selectUnderlingStationList(@Param("stationId") Long stationId);

}
