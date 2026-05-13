package com.iwhalecloud.byai.manager.interfaces.controller.app;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.iwhalecloud.byai.manager.application.service.app.AppAuthApplicationService;
import com.iwhalecloud.byai.manager.dto.users.AppRefreshTokenLoginRequest;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * APP端认证控制器
 * 
 * @author AI Assistant &#064;date 2025-01-XX
 */
@RestController
@RequestMapping("/app/auth")
public class AppAuthController {

    private static final Logger logger = LoggerFactory.getLogger(AppAuthController.class);


    @Autowired
    private AppAuthApplicationService appAuthApplicationService;

    /**
     * 刷新Token登录（静默登录） APP冷启动时，使用RefreshToken进行静默登录
     * 
     * @param request 刷新Token登录请求
     * @return ResponseUtil<LoginResponse>
     */
    @PostMapping("/refreshTokenLogin")
    public ResponseUtil<?> refreshTokenLogin(@Valid @RequestBody AppRefreshTokenLoginRequest request) {
        try {
            return appAuthApplicationService.refreshTokenLogin(request);
        }
        catch (Exception e) {
            logger.error("RefreshToken登录异常，error: {}", e.getMessage(), e);
            return ResponseUtil.fail("登录失败：" + e.getMessage());
        }
    }
}
