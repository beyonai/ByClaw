package com.iwhalecloud.byai.manager.interfaces.controller.user;

import java.util.Map;

import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamApplicationService;
import com.iwhalecloud.byai.manager.dto.users.UserPrivateParamDTO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.vo.users.UserPrivateParamVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 个人中心-个人参数配置管理接口。
 * @author qin.guoquan
 * @date 2026-06-22 00:00:00
 */
@RestController
@RequestMapping("/userPrivateParam")
public class UserPrivateParamController {

    @Autowired
    private UserPrivateParamApplicationService userPrivateParamApplicationService;

    @GetMapping("/list")
    public ResponseUtil<Map<String, Object>> list(UserPrivateParamDTO request) {
        return ResponseUtil.successResponse("个人参数查询成功", userPrivateParamApplicationService.list(request));
    }

    @PostMapping("/save")
    public ResponseUtil<UserPrivateParamVO> save(@RequestBody UserPrivateParamDTO request) {
        return ResponseUtil.successResponse("个人参数保存成功", userPrivateParamApplicationService.save(request));
    }

    @PostMapping("/delete")
    public ResponseUtil<Boolean> delete(@RequestBody UserPrivateParamDTO request) {
        return ResponseUtil.successResponse("个人参数删除成功", userPrivateParamApplicationService.delete(request));
    }

    @PostMapping("/enable")
    public ResponseUtil<UserPrivateParamVO> enable(@RequestBody UserPrivateParamDTO request) {
        return ResponseUtil.successResponse("个人参数状态更新成功", userPrivateParamApplicationService.enable(request));
    }
}
