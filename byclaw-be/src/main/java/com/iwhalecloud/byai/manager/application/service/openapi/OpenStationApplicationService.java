package com.iwhalecloud.byai.manager.application.service.openapi;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.domain.station.service.StationService;
import com.iwhalecloud.byai.manager.dto.openapi.OpenStationDTO;
import com.iwhalecloud.byai.manager.entity.station.Station;
import com.iwhalecloud.byai.common.qo.QueryObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 外部驻地应用服务 用于外部接口驻地增删改
 */
@Service
public class OpenStationApplicationService {

    @Autowired
    private StationService stationService;

    @Autowired
    private SequenceService SequenceService;

    /**
     * 递归构建stationIdPath，格式为 -1.父ID.父ID...当前ID 数据库字段描述：驻地路径，格式为 -1.父ID.父ID...当前ID
     *
     * @param pStationId 父驻地ID
     * @param stationId 当前驻地ID
     * @return 驻地路径
     */
    private String buildStationPath(Long pStationId, Long stationId) {
        // 根节点判断，-1 代表无父节点
        if (pStationId == null || pStationId == -1) {
            return "-1." + stationId;
        }
        // 递归获取父节点路径
        Station parent = stationService.getById(pStationId);
        if (parent == null) {
            // 父节点不存在，视为根节点
            return "-1." + stationId;
        }
        // 递归拼接父节点路径
        return buildStationPath(parent.getPStationId(), parent.getStationId()) + "." + stationId;
    }

    /**
     * 新增驻地
     *
     * @param openStationDTO 入参
     * @return 驻地主键
     */
    public Long addStation(OpenStationDTO openStationDTO) {
        Station station = new Station();
        if (openStationDTO.isNewPrimaryKey()) {
            station.setStationId(SequenceService.nextVal());
        }
        else {
            station.setStationId(openStationDTO.getStationId());
        }
        station.setStationName(openStationDTO.getStationName());
        station.setStationType(openStationDTO.getStationType());
        station.setPStationId(openStationDTO.getPStationId());
        station.setIsAbroad(openStationDTO.getIsAbroad());
        station.setComAcctId(CurrentUserHolder.getEnterpriseId());
        station.setCreateBy(CurrentUserHolder.getCurrentUserId());
        // 设置路径
        station.setStationIdPath(buildStationPath(station.getPStationId(), station.getStationId()));
        stationService.save(station);
        return station.getStationId();
    }

    /**
     * 修改驻地
     *
     * @param openStationDTO 入参
     * @return 驻地主键
     */
    public Long updateStation(OpenStationDTO openStationDTO) {
        Station station = stationService.getById(openStationDTO.getStationId());
        station.setStationName(openStationDTO.getStationName());
        station.setStationType(openStationDTO.getStationType());
        station.setPStationId(openStationDTO.getPStationId());
        station.setIsAbroad(openStationDTO.getIsAbroad());
        station.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        stationService.update(station);
        return station.getStationId();
    }

    /**
     * 删除驻地
     *
     * @param stationId 驻地ID
     */
    public void delStation(Long stationId) {
        stationService.deleteById(stationId);
    }

    /**
     * 查询驻地列表
     *
     * @param qo 查询对象
     * @return 分页结果
     */
    public PageInfo<Station> listStation(QueryObject qo) {

        LambdaQueryWrapper<Station> queryWrapper = new LambdaQueryWrapper<>();

        if (StringUtil.isNotEmpty(qo.getKeyword())) {
            queryWrapper.like(Station::getStationName, qo.getKeyword());
        }

        Page<Station> page = new Page<>(qo.getPageNum(), qo.getPageSize(), true);
        stationService.selectList(page, queryWrapper);
        return PageHelperUtil.toPageInfo(page);
    }
}