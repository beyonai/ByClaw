package com.iwhalecloud.byai.manager.interfaces.controller.openapi;

import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.qo.QueryObject;
import com.iwhalecloud.byai.manager.application.service.openapi.OpenPositionApplicationService;
import com.iwhalecloud.byai.manager.dto.openapi.OpenPositionDTO;
import com.iwhalecloud.byai.manager.dto.position.PositionDelDTO;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

/**
 * @author he.duming
 * @date 2026-04-16 16:13:19
 * @description TODO
 */
@RestController
@RequestMapping("/open/api")
public class OpenPositionController {

    @Autowired
    private OpenPositionApplicationService openPositionApplicationService;

    /**
     * 查询岗位列表
     *
     * @param qo 分页查询对象
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "查询岗位列表")
    @RequestMapping(value = "/listPosition", method = RequestMethod.POST)
    public ResponseUtil listPosition(@RequestBody @Validated QueryObject qo) {
        PageInfo<Position> pageVo = openPositionApplicationService.listPosition(qo);
        return ResponseUtil.successResponse(pageVo);
    }

    /**
     * 新增岗位
     *
     * @param openPositionDTO 查询
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "添加岗位")
    @RequestMapping(value = "/addPosition", method = RequestMethod.POST)
    public ResponseUtil<Long> addPosition(@Validated(Add.class) @RequestBody OpenPositionDTO openPositionDTO) {
        Long positionId = openPositionApplicationService.addPosition(openPositionDTO);
        return ResponseUtil.successResponse(I18nUtil.get("position.save.success"), positionId);
    }

    /**
     * 修改岗位
     *
     * @param openPositionDTO 查询
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "更新岗位")
    @RequestMapping(value = "/updatePosition", method = RequestMethod.POST)
    public ResponseUtil<Long> updatePosition(@Validated(Mod.class) @RequestBody OpenPositionDTO openPositionDTO) {
        Long positionId = openPositionApplicationService.updatePosition(openPositionDTO);
        return ResponseUtil.successResponse(I18nUtil.get("position.modify.success"), positionId);
    }

    /**
     * 移除岗位
     *
     * @param positionDelDTO 查询
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "移除岗位")
    @RequestMapping(value = "/removePosition", method = RequestMethod.POST)
    public ResponseUtil<Void> removePosition(@RequestBody @Validated PositionDelDTO positionDelDTO) {
        openPositionApplicationService.removePosition(positionDelDTO);
        return ResponseUtil.success(I18nUtil.get("position.remove.success"));
    }
}
