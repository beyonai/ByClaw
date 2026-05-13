package com.iwhalecloud.byai.manager.interfaces.controller.station;

import com.iwhalecloud.byai.manager.entity.station.Station;
import com.iwhalecloud.byai.manager.qo.station.SearchStationQo;
import com.iwhalecloud.byai.manager.qo.station.StationTreeQo;
import com.iwhalecloud.byai.manager.domain.station.service.StationService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 驻地组织控制器
 */
@RestController
@RequestMapping("/system/station")
public class StationController {


    @Autowired
    private StationService stationService;


    /**
     * 查询驻地
     * 根据驻地层级关系构建驻地树结构
     * @param stationTreeQo 查询条件
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getStationTree", method = RequestMethod.POST)
    public ResponseUtil getStationTree(@RequestBody StationTreeQo stationTreeQo) {
        List<Station> stationTree = stationService.getStationTree(stationTreeQo);
        return ResponseUtil.successResponse(stationTree);
    }

    /**
     * 根据父驻地ID查询子驻地列表）
     * @param stationTreeQo 父驻地ID
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getStationsByParent", method = RequestMethod.POST)
    public ResponseUtil getStationsByParent(@RequestBody StationTreeQo stationTreeQo) {
        if (stationTreeQo.getParentStationId() == null) {
            return ResponseUtil.fail(I18nUtil.get("station.parent.id.notnull"));
        }
        List<Station> stationList = stationService.getStationsByParent(stationTreeQo.getParentStationId());
        return ResponseUtil.successResponse(stationList);
    }

    /**
     * 根据驻地ID查询驻地详情
     *
     * @param searchStationQo 驻地ID
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getStationById", method = RequestMethod.POST)
    public ResponseUtil getStationById(@Validated @RequestBody SearchStationQo searchStationQo) {
        Station station = stationService.getById(searchStationQo.getStationId());
        if (station == null) {
            return ResponseUtil.fail(I18nUtil.get("station.not.exist"));
        }
        return ResponseUtil.successResponse(station);
    }
}