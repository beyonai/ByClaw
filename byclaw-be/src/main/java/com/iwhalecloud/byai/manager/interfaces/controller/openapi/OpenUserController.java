package com.iwhalecloud.byai.manager.interfaces.controller.openapi;

import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.qo.QueryObject;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.openapi.OpenUserApiApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserApplicationService;
import com.iwhalecloud.byai.manager.dto.openapi.OpenDelUserDTO;
import com.iwhalecloud.byai.manager.dto.openapi.OpenUserDTO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.users.UsersByOrgIdQo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;

/**
 * @author he.duming
 * @date 2026-04-16 16:13:49
 * @description TODO
 */
@RestController
@RequestMapping("/open/api")
public class OpenUserController {

    @Autowired
    private UserApplicationService userApplicationService;

    @Autowired
    private OpenUserApiApplicationService openUserApiApplicationService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    /**
     * 查询员工基本信息
     *
     * @param qo 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "分页查询员工信息")
    @RequestMapping(value = "/listUser", method = RequestMethod.POST)
    public ResponseUtil listUser(@RequestBody QueryObject qo) {
        PageInfo<Map<String, Object>> mapPageVO = userApplicationService.listUser(qo);
        return ResponseUtil.successResponse(mapPageVO);
    }

    /**
     * 新增员工
     *
     * @param openUsersDTO 新增
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "添加用户")
    @RequestMapping(value = "/addUser", method = RequestMethod.POST)
    public ResponseUtil<Long> addUser(@RequestBody @Validated(Add.class) OpenUserDTO openUsersDTO) {
        Long userId = openUserApiApplicationService.addUser(openUsersDTO);
        return ResponseUtil.successResponse(userId);
    }

    /**
     * 更新用户
     *
     * @param usersDTO 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "更新用户")
    @RequestMapping(value = "/updateUser", method = RequestMethod.POST)
    public ResponseUtil<Long> updateUser(@Validated(Mod.class) @RequestBody OpenUserDTO usersDTO) {
        Long userId = openUserApiApplicationService.updateUser(usersDTO);
        return ResponseUtil.successResponse(I18nUtil.get("user.update.success"), userId);
    }

    /**
     * 删除用户
     *
     * @param openDelUserDTO 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "删除用户")
    @RequestMapping(value = "/delUser", method = RequestMethod.POST)
    public ResponseUtil<Void> delUser(@Validated @RequestBody OpenDelUserDTO openDelUserDTO) {
        openUserApiApplicationService.deleteUser(openDelUserDTO);
        return ResponseUtil.success(I18nUtil.get("user.delete.success"));
    }

    /**
     * 查询用户信息
     *
     * @param usersByOrgIdQo 查询对象
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "根据组织查询用户列表")
    @RequestMapping(value = "/getUsersByOrgId", method = RequestMethod.POST)
    public ResponseUtil getUsersByOrgId(@RequestBody UsersByOrgIdQo usersByOrgIdQo) {
        return ResponseUtil.successResponse(userApplicationService.getUsersByOrgId(usersByOrgIdQo));
    }

    /**
     * 获取所有用户信息
     *
     * @param userCode 用户编码
     * @return ResponseUtil
     */
    @GetMapping("/getAllUserInfoByUserCode")
    @ManageLogAnnotation(name = "获取用户信息", description = "获取用户信息")
    public ResponseUtil<LoginInfo> getAllUserInfoByUserCode(@RequestParam("userCode") String userCode) {
        LoginInfo loginInfo = loginApplicationService.getLoginInfo(userCode);
        return ResponseUtil.successResponse(loginInfo);
    }

}
