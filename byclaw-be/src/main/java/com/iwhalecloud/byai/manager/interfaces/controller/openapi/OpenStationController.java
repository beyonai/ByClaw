package com.iwhalecloud.byai.manager.interfaces.controller.openapi;

import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Del;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.qo.QueryObject;
import com.iwhalecloud.byai.manager.application.service.openapi.OpenStationApplicationService;
import com.iwhalecloud.byai.manager.dto.openapi.OpenStationDTO;
import com.iwhalecloud.byai.manager.entity.station.Station;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

/**
 * @author he.duming
 * @date 2026-04-16 16:19:33
 * @description TODO
 */
@RestController
@RequestMapping("/open/api")
public class OpenStationController {

    @Autowired
    private OpenStationApplicationService openStationApplicationService;

    /**
     * 查询驻地列表
     *
     * @param qo 查询对象
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "查询驻地列表")
    @RequestMapping(value = "/listStation", method = RequestMethod.POST)
    public ResponseUtil<PageInfo<Station>> listStation(@RequestBody QueryObject qo) {
        PageInfo<Station> pageVO = openStationApplicationService.listStation(qo);
        return ResponseUtil.successResponse(pageVO);
    }

    /**
     * 新增驻地
     *
     * @param openStationDTO 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "新增驻地")
    @RequestMapping(value = "/addStation", method = RequestMethod.POST)
    public ResponseUtil<Long> addStation(@Validated(Add.class) @RequestBody OpenStationDTO openStationDTO) {
        Long stationId = openStationApplicationService.addStation(openStationDTO);
        return ResponseUtil.successResponse(I18nUtil.get("station.add.success"), stationId);
    }

    /**
     * 修改驻地
     *
     * @param openStationDTO 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "修改驻地")
    @RequestMapping(value = "/updateStation", method = RequestMethod.POST)
    public ResponseUtil<Long> updateStation(@Validated(Mod.class) @RequestBody OpenStationDTO openStationDTO) {
        Long stationId = openStationApplicationService.updateStation(openStationDTO);
        return ResponseUtil.successResponse(I18nUtil.get("station.modify.success"), stationId);
    }

    /**
     * 删除驻地
     *
     * @param openStationDTO 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "删除驻地")
    @RequestMapping(value = "/delStation", method = RequestMethod.POST)
    public ResponseUtil<String> delStation(@Validated(Del.class) @RequestBody OpenStationDTO openStationDTO) {
        openStationApplicationService.delStation(openStationDTO.getStationId());
        return ResponseUtil.successResponse(I18nUtil.get("station.delete.success"));
    }

}
