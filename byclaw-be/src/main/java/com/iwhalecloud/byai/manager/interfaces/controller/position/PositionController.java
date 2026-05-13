package com.iwhalecloud.byai.manager.interfaces.controller.position;

import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.qo.position.PositionQo;
import com.iwhalecloud.byai.manager.qo.position.PositionUsersQo;
import com.iwhalecloud.byai.manager.vo.position.PositionUsersVo;
import com.iwhalecloud.byai.manager.dto.position.PositionDelDTO;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.common.page.PageInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import com.iwhalecloud.byai.manager.application.service.position.PositionApplicationService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

/**
 * 岗位控制器
 */
@RestController
@RequestMapping("/system/position")
public class PositionController {

    @Autowired
    private PositionApplicationService positionApplicationService;

    /***
     * 查询所有岗位列表）
     * @param positionQo 查询入参
     * @return ResponseUtil
     */
    @RequestMapping(value = "/searchPositionList", method = RequestMethod.POST)
    public ResponseUtil searchPositionList(@RequestBody PositionQo positionQo) {
        PageInfo<Position> pageVO = positionApplicationService.searchPositionList(positionQo);
        return ResponseUtil.successResponse(pageVO);
    }

    /**
     * 查询岗位下面的用户列表）
     * @param positionUsersQo 查询对象
     * @return ResponseUtil
     */
    @RequestMapping(value = "/searchPositionUsersByQo", method = RequestMethod.POST)
    public ResponseUtil searchPositionUsersByQo(@RequestBody PositionUsersQo positionUsersQo) {
        PageInfo<PositionUsersVo> pageVO = positionApplicationService.searchPositionUsersByQo(positionUsersQo);
        return ResponseUtil.successResponse(pageVO);
    }

    /**
     * 新增岗位
     *
     * @param position 查询
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "岗位管理", description = "添加岗位")
    @RequestMapping(value = "/addPosition", method = RequestMethod.POST)
    public ResponseUtil addPosition(@Validated(Add.class) @RequestBody Position position) {
        return positionApplicationService.addPosition(position);
    }

    /**
     * 修改岗位
     *
     * @param position 岗位信息
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "岗位管理", description = "修改岗位")
    @RequestMapping(value = "/updatePosition", method = RequestMethod.POST)
    public ResponseUtil updatePosition(@Validated(Mod.class) @RequestBody Position position) {
        return positionApplicationService.updatePosition(position);
    }

    /**
     * 移除岗位
     *
     * @param positionDelDTO 查询
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "岗位管理", description = "移除岗位")
    @RequestMapping(value = "/removePosition", method = RequestMethod.POST)
    public ResponseUtil removePosition(@RequestBody @Validated PositionDelDTO positionDelDTO) {
        return positionApplicationService.removePosition(positionDelDTO);
    }

}
