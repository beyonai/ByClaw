package com.iwhalecloud.byai.manager.interfaces.controller.user;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
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
        return ResponseUtil.successResponse(I18nUtil.get("user.param.querySuccess"), userPrivateParamApplicationService.list(request));
    }

    @PostMapping("/save")
    public ResponseUtil<UserPrivateParamVO> save(@RequestBody UserPrivateParamDTO request) {
        return ResponseUtil.successResponse(I18nUtil.get("user.param.saveSuccess"), userPrivateParamApplicationService.save(request));
    }

    @PostMapping("/delete")
    public ResponseUtil<Boolean> delete(@RequestBody UserPrivateParamDTO request) {
        return ResponseUtil.successResponse(I18nUtil.get("user.param.deleteSuccess"), userPrivateParamApplicationService.delete(request));
    }

    @PostMapping("/enable")
    public ResponseUtil<UserPrivateParamVO> enable(@RequestBody UserPrivateParamDTO request) {
        return ResponseUtil.successResponse(I18nUtil.get("user.param.statusSuccess"), userPrivateParamApplicationService.enable(request));
    }
}
