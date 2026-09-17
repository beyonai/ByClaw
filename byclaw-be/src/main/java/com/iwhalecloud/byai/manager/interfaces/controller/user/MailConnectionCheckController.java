package com.iwhalecloud.byai.manager.interfaces.controller.user;

import com.iwhalecloud.byai.manager.application.service.user.UserMailAccountApplicationService;
import com.iwhalecloud.byai.manager.dto.users.MailConnectionCheckRequestDTO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.vo.users.MailConnectionCheckResultVO;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** Isolated boundary for the connection-check endpoint and its safe error contract. */
@RestController
public class MailConnectionCheckController {

    @Autowired
    private UserMailAccountApplicationService userMailAccountApplicationService;

    @PostMapping("/userMailAccount/check")
    public ResponseUtil<MailConnectionCheckResultVO> check(
            @Valid @RequestBody MailConnectionCheckRequestDTO request) {
        return ResponseUtil.successResponse("邮箱连接检查完成",
            userMailAccountApplicationService.check(request.getAccountId()));
    }
}
