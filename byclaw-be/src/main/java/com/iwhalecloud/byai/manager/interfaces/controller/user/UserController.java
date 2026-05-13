package com.iwhalecloud.byai.manager.interfaces.controller.user;

import com.iwhalecloud.byai.manager.application.service.user.UserApplicationService;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.common.qo.QueryObject;
import com.iwhalecloud.byai.manager.qo.users.SearchUserQo;
import com.iwhalecloud.byai.manager.qo.users.UsersByOrgIdQo;
import com.iwhalecloud.byai.manager.vo.users.UsersOrgVo;
import com.iwhalecloud.byai.manager.dto.users.UsersDTO;
import com.iwhalecloud.byai.manager.dto.users.BatchDelUserDTO;
import com.iwhalecloud.byai.manager.dto.users.DelUserDTO;
import com.iwhalecloud.byai.manager.dto.users.ResetPasswordDTO;
import com.iwhalecloud.byai.manager.dto.users.UpdatePasswordDTO;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.Map;

/**
 * 用户控制�? */
@RestController
@RequestMapping("/system/user")
public class UserController {

    @Autowired
    private UserApplicationService userApplicationService;

    @Autowired
    protected SuasSuperassistService suasSuperassistService;

    /**
     * 新增用户
     *
     * @param usersDTO 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "人员管理", description = "添加人员")
    @RequestMapping(value = "/addUser", method = RequestMethod.POST)
    public ResponseUtil addUser(@RequestBody @Validated(Add.class) UsersDTO usersDTO) {
        return userApplicationService.addUser(usersDTO);
    }

    /**
     * 更新用户
     *
     * @param usersDTO 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "人员管理", description = "更新用户")
    @RequestMapping(value = "/updateUser", method = RequestMethod.POST)
    public ResponseUtil updateUser(@Validated(Mod.class) @RequestBody UsersDTO usersDTO) {
        return userApplicationService.updateUser(usersDTO);
    }

    /**
     * 删除用户
     *
     * @param delUserDTO 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "人员管理", description = "删除用户")
    @RequestMapping(value = "/delUser", method = RequestMethod.POST)
    public ResponseUtil delUser(@Validated @RequestBody DelUserDTO delUserDTO) {
        return userApplicationService.deleteUser(delUserDTO);

    }

    /**
     * 查询用户
     *
     * @param searchUserQo 入参
     * @return ResponseUtil
     */
    @RequestMapping(value = "/searchUser", method = RequestMethod.POST)
    public ResponseUtil searchUser(@Validated @RequestBody SearchUserQo searchUserQo) {
        return userApplicationService.searchUser(searchUserQo);
    }

    /**
     * 获取组织下的所有员�? *
     * @param usersByOrgIdQo {orgId:1}
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getUsersByOrgId", method = RequestMethod.POST)
    public ResponseUtil getUsersByOrgId(@Validated @RequestBody UsersByOrgIdQo usersByOrgIdQo) {
        PageInfo<UsersOrgVo> pageVO = userApplicationService.getUsersByOrgId(usersByOrgIdQo);
        return ResponseUtil.successResponse(pageVO);
    }

    /**
     * 重置密码
     *
     * @param resetPasswordDTO 重置的用户信息
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "人员管理", description = "重置密码")
    @RequestMapping(value = "/resetPassword", method = RequestMethod.POST)
    public ResponseUtil resetPassword(@Validated @RequestBody ResetPasswordDTO resetPasswordDTO) {
        return userApplicationService.resetPassword(resetPasswordDTO);
    }

    /**
     * 删除用户
     *
     * @param batchDelUserDTO 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "人员管理", description = "批量删除用户")
    @RequestMapping(value = "/batchDelUser", method = RequestMethod.POST)
    public ResponseUtil batchDelUser(@Validated @RequestBody BatchDelUserDTO batchDelUserDTO) {
        return userApplicationService.batchDelUser(batchDelUserDTO);
    }

    /**
     * 查询用户简单信�给不返回密码等敏感信息
     *
     * @param params 用户标识
     * @return RequestMapping
     */
    @ManageLogAnnotation(name = "人员管理", description = "员工简单信息查�给")
    @RequestMapping(value = "/findSimpleUsersById", method = RequestMethod.POST)
    public ResponseUtil findSimpleUsersById(@RequestBody Map<String, Object> params) {
        return userApplicationService.findSimpleUsersById(params);
    }

    /**
     * 登陆后修改密�? *
     * @param updatePasswordDTO 修改密码信息
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "人员管理", description = "修改密码")
    @RequestMapping(value = "/updatePassword", method = RequestMethod.POST)
    public ResponseUtil updatePassword(@Validated @RequestBody UpdatePasswordDTO updatePasswordDTO) {
        return userApplicationService.updatePassword(updatePasswordDTO);
    }

    /**
     * 查找用户及超级助手信�? *
     * @param qo 分页搜索用户信息
     * @return ResponseUtil
     */
    @RequestMapping(value = "/findUserSuas", method = RequestMethod.POST)
    public ResponseUtil findUserSuas(@RequestBody QueryObject qo) {
        PageInfo<Map<String, Object>> pageVO = userApplicationService.findUserSuas(qo);
        return ResponseUtil.successResponse(pageVO);
    }

    /**
     * 获取用户信息
     *
     * @param userId
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getUserSuas", method = RequestMethod.GET)
    public ResponseUtil getUserSuas(@RequestParam(value = "userId") Long userId) {
        return userApplicationService.getUserSuas(userId);
    }

    /**
     * 根据userId查询超级助手信息
     *
     * @param userId
     * @return ResponseUtil
     */
    @RequestMapping(value = "/findByUserId", method = RequestMethod.GET)
    public ResponseUtil findByUserId(@RequestParam(value = "userId") Long userId) {
        return ResponseUtil.success(suasSuperassistService.findByUserId(userId));
    }

    /**
     * 根据superassistId更新超级助手信息
     *
     * @param superassist
     * @return ResponseUtil
     */
    @RequestMapping(value = "/updateBySuperassistId", method = RequestMethod.POST)
    public ResponseUtil updateBySuperassistId(@RequestBody SuasSuperassist superassist) {
        return ResponseUtil.success(suasSuperassistService.updateById(superassist));
    }

    /**
     * 注销用户
     *
     * @return ResponseUtil
     */
    @RequestMapping(value = "/inactiveUser", method = RequestMethod.POST)
    public ResponseUtil inactiveUser() {
        userApplicationService.inactiveUser();
        return ResponseUtil.success("OK");
    }


    /**
     * 批量更新用户信息（处理phone属性加密）
     * @return ResponseUtil
     */
    @RequestMapping(value = "/batchUpdateUserPhones", method = RequestMethod.GET)
    public ResponseUtil batchUpdateUserPhones() {
        return userApplicationService.batchUpdateUserPhones();
    }

}
