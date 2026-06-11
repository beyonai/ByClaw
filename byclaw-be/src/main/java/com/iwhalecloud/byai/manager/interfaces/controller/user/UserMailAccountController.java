package com.iwhalecloud.byai.manager.interfaces.controller.user;

import java.util.List;

import com.iwhalecloud.byai.manager.application.service.user.UserMailAccountApplicationService;
import com.iwhalecloud.byai.manager.dto.users.UserMailAccountDTO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.vo.users.UserMailAccountVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 个人中心-个人邮箱账号管理接口。
 * @author qin.guoquan
 * @date 2026-06-11 17:38:38
 */
@RestController
@RequestMapping("/userMailAccount")
public class UserMailAccountController {

    @Autowired
    private UserMailAccountApplicationService userMailAccountApplicationService;

    @GetMapping("/list")
    public ResponseUtil<List<UserMailAccountVO>> list() {
        return ResponseUtil.successResponse("邮箱账号查询成功", userMailAccountApplicationService.list());
    }

    @PostMapping("/save")
    public ResponseUtil<UserMailAccountVO> save(@RequestBody UserMailAccountDTO request) {
        return ResponseUtil.successResponse("邮箱账号保存成功", userMailAccountApplicationService.save(request));
    }

    @PostMapping("/delete")
    public ResponseUtil<Boolean> delete(@RequestBody UserMailAccountDTO request) {
        return ResponseUtil.successResponse("邮箱账号删除成功", userMailAccountApplicationService.delete(request));
    }

    @PostMapping("/setDefault")
    public ResponseUtil<UserMailAccountVO> setDefault(@RequestBody UserMailAccountDTO request) {
        return ResponseUtil.successResponse("默认邮箱账号设置成功", userMailAccountApplicationService.setDefault(request));
    }
}
