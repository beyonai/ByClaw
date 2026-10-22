package com.iwhalecloud.byai.manager.interfaces.controller.user;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import java.util.List;

import com.iwhalecloud.byai.manager.application.service.user.UserMailAccountApplicationService;
import com.iwhalecloud.byai.manager.dto.users.UserMailAccountDTO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.vo.users.MailProviderVO;
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
        return ResponseUtil.successResponse(I18nUtil.get("mail.account.querySuccess"), userMailAccountApplicationService.list());
    }

    @GetMapping("/providers")
    public ResponseUtil<List<MailProviderVO>> providers() {
        return ResponseUtil.successResponse(I18nUtil.get("mail.providers.loaded"), userMailAccountApplicationService.providers());
    }

    @PostMapping("/save")
    public ResponseUtil<UserMailAccountVO> save(@RequestBody UserMailAccountDTO request) {
        return ResponseUtil.successResponse(I18nUtil.get("mail.account.saveSuccess"), userMailAccountApplicationService.save(request));
    }

    @PostMapping("/delete")
    public ResponseUtil<Boolean> delete(@RequestBody UserMailAccountDTO request) {
        return ResponseUtil.successResponse(I18nUtil.get("mail.account.deleteSuccess"), userMailAccountApplicationService.delete(request));
    }

}
