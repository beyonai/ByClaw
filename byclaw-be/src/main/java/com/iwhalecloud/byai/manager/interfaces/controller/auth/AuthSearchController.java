package com.iwhalecloud.byai.manager.interfaces.controller.auth;

import com.iwhalecloud.byai.manager.application.service.auth.AuthSearchApplicationService;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.entity.station.Station;
import com.iwhalecloud.byai.common.qo.QueryObject;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-05-28 15:32:38
 * @description 授权停止查询
 */
@RestController
@RequestMapping("/auth/privilegeGrant")
public class AuthSearchController {

    @Autowired
    private AuthSearchApplicationService authSearchApplicationService;

    /**
     * 综合搜索
     *
     * @param qo 关键字搜索
     * @return ResponseUtil
     */
    @RequestMapping(value = "/findAll", method = RequestMethod.POST)
    public ResponseUtil findAll(@RequestBody QueryObject qo) {
        return authSearchApplicationService.findAll(qo);
    }

    /**
     * 高级查找组织
     *
     * @param qo 分页搜索组织信息
     * @return ResponseUtil
     */
    @RequestMapping(value = "/findOrg", method = RequestMethod.POST)
    public ResponseUtil findOrg(@RequestBody QueryObject qo) {
        PageInfo<Map<String, Object>> pageVO = authSearchApplicationService.findOrg(qo);
        return ResponseUtil.successResponse(pageVO);
    }

    /**
     * 高级查找用户
     *
     * @param qo 分页搜索用户信息
     * @return ResponseUtil
     */
    @RequestMapping(value = "/findUser", method = RequestMethod.POST)
    public ResponseUtil findUser(@RequestBody QueryObject qo) {
        PageInfo<Map<String, Object>> pageVO = authSearchApplicationService.findUser(qo);
        return ResponseUtil.successResponse(pageVO);
    }

    /**
     * 高级查找岗位
     *
     * @param qo 分页搜索组织信息
     * @return ResponseUtil
     */
    @RequestMapping(value = "/findPosition", method = RequestMethod.POST)
    public ResponseUtil findPosition(@RequestBody QueryObject qo) {
        PageInfo<Position> pageVO = authSearchApplicationService.findPosition(qo);
        return ResponseUtil.successResponse(pageVO);
    }

    /**
     * 高级查找驻地
     *
     * @param qo 分页搜索驻地信息
     * @return ResponseUtil
     */
    @RequestMapping(value = "/findStation", method = RequestMethod.POST)
    public ResponseUtil findStation(@RequestBody QueryObject qo) {
        PageInfo<Station>  pageVO = authSearchApplicationService.findStation(qo);
        return ResponseUtil.successResponse(pageVO);
    }

    /**
     * 根据用户ID列表获取组织信息
     *
     * @param userIds 用户ID列表
     * @return ResponseUtil 包含用户组织信息的响�? */
    @RequestMapping(value = "/findUserOrganizationsByUserIds", method = RequestMethod.POST)
    public ResponseUtil findUserOrganizationsByUserIds(@RequestBody List<Long> userIds) {
        return authSearchApplicationService.findUserOrganizationsByUserIds(userIds);
    }

}
