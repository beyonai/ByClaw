package com.iwhalecloud.byai.manager.domain.station.service;

import cn.hutool.core.collection.CollectionUtil;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.mapper.station.StationMapper;
import com.iwhalecloud.byai.manager.entity.station.Station;
import com.iwhalecloud.byai.manager.qo.station.StationTreeQo;
import com.iwhalecloud.byai.common.util.StringUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 驻地信息表服务实现类
 * 对应表：po_station
 */
@Service
public class StationService {
    @Autowired
    private StationMapper stationMapper;

    /**
     * 根据ID查询驻地
     * @param stationId 驻地标识
     * @return 驻地实体
     */
    public Station getById(Long stationId) {
        return stationMapper.selectById(stationId);
    }

    /**
     * 根据父驻地ID查询子驻地列表
     * @return 驻地列表
     */
    public List<Station> getStationsByParent(Long pStationId) {
        LambdaQueryWrapper<Station> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(Station::getPStationId, pStationId);
        return stationMapper.selectList(queryWrapper);
    }

    /**
     * 分页查询驻地列表
     * @param page 分页对象
     * @param queryWrapper 查询条件
     * @return 驻地列表
     */
    public List<Station> selectList(Page<Station> page, Wrapper<Station> queryWrapper) {
        return stationMapper.selectPage(page, queryWrapper).getRecords();
    }

    /**
     * 新增驻地
     * @param station 驻地实体
     */
    public void save(Station station) {
        station.setCreateTime(new Date());
        stationMapper.insert(station);
    }

    /**
     * 修改驻地
     * @param station 驻地实体
     */
    public void update(Station station) {
        station.setUpdateTime(new Date());
        stationMapper.updateById(station);
    }

    /**
     * 删除驻地
     * @param stationId 驻地ID
     */
    public void deleteById(Long stationId) {
        stationMapper.deleteById(stationId);
    }

    /**
     * 根据userId查询驻地
     * @param userId
     * @return 驻地实体
     */
    public Station getStationByUserId(Long userId) {
        return stationMapper.getStationByUserId(userId);
    }

    /**
     * 查询驻地�?
     *
     * @param stationTreeQo 入参
     * @return 驻地树列�?
     */
    public List<Station> getStationTree(StationTreeQo stationTreeQo) {
        List<Station> stationTree = stationMapper.getStationTree(stationTreeQo);

        //如果都没有id条件的那就是全部返回了都�?
        if (null == stationTreeQo.getParentStationId() && CollectionUtil.isEmpty(stationTreeQo.getStationIds())) {
            return stationTree;
        }

        // 如果不需要返回上级驻地信息，直接返回
        if (stationTree.isEmpty() || !stationTreeQo.isContainsParent()) {
            return stationTree;
        }

        // 查询当前驻地信息，包含上级驻地信息一起返�?
        Set<Long> stationIds = new HashSet<>(100);
        for (Station station : stationTree) {
            String stationIdPath = station.getStationIdPath();
            if (StringUtil.isEmpty(stationIdPath)) {
                continue;
            }
            String[] split = stationIdPath.split("\\.");
            for (String stationIdStr : split) {
                stationIds.add(Long.parseLong(stationIdStr));
            }
        }
        return stationMapper.getStationTree(new StationTreeQo(stationIds));
    }

    /**
     * 查询驻地及其所有子驻地的ID列表（包含自身）
     * 通过模糊查询 station_id_path 字段实现
     * 
     * @param stationId 驻地ID
     * @return 包含自身和所有子驻地的ID列表
     */
    public List<Long> selectUnderlingStationList(Long stationId) {
        if (stationId == null) {
            return List.of();
        }
        
        // 直接使用驻地ID进行模糊查询
        return stationMapper.selectUnderlingStationList(stationId);
    }

 }
