package com.iwhalecloud.byai.manager.interfaces.controller.log;

import com.iwhalecloud.byai.manager.application.service.log.LogExceptionInfoApplicationService;
import com.iwhalecloud.byai.manager.entity.log.LogExceptionInfo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * @author he.duming
 * @date 2026-01-07 16:13:07
 * @description TODO
 */
@RestController
@RequestMapping("/logExceptionInfoController")
public class LogExceptionInfoController {

    private static final Logger logger = LoggerFactory.getLogger(LogExceptionInfoController.class);

    @Autowired
    private LogExceptionInfoApplicationService logExceptionInfoApplicationService;

    /**
     * 保存异常日志信息
     *
     * @param request HTTP请求对象,用于获取请求相关上下文信息
     * @param logExceptionInfo 异常日志实体
     * @return 统一响应结果
     */
    @PostMapping("/saveLogExceptionInfo")
    public ResponseUtil<String> saveLogExceptionInfo(HttpServletRequest request,
                                                 @RequestBody LogExceptionInfo logExceptionInfo) {
        try {
            logExceptionInfoApplicationService.saveLogExceptionInfo(request, logExceptionInfo);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }

        return ResponseUtil.successResponse();
    }
}
