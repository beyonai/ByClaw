package com.iwhalecloud.byai.manager.interfaces.controller.adminconsole;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.adminconsole.LogSearchConstants;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.manager.dto.adminconsole.LogSearchReq;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 管理员日志查询接口，复用平台网关。
 *
 * @author Codex
 * @date 2026-11-12
 */
@RestController
@RequestMapping("/admin-console/logs")
public class LogCenterController {

    @Value("${byclaw.logs.region:}")
    private String logRegion;

    @Value("${byclaw.logs.project:}")
    private String logProject;

    @Value("${byclaw.logs.logstore:}")
    private String logstore;

    private final PlatformRemoteGateway platformRemoteGateway;

    /**
     * 创建日志查询接口。
     *
     * @param platformRemoteGateway 平台远程网关
     */
    public LogCenterController(PlatformRemoteGateway platformRemoteGateway) {
        this.platformRemoteGateway = platformRemoteGateway;
    }

    /**
     * 校验管理员身份及查询条件后查询平台日志。
     *
     * @param logSearchReq 日志查询条件
     * @return 日志查询结果或远程模式配置提示
     */
    @PostMapping("/search")
    public ResponseUtil<Object> search(@RequestBody LogSearchReq logSearchReq) {
        if (!CurrentUserHolder.isAdminVip()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "仅 adminvip 可查询日志");
        }
        if (logSearchReq == null || !isValidTimeWindow(logSearchReq) || !isValidPageSize(logSearchReq)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50400, "时间范围不超过24小时，每页1至200条");
        }
        if (!platformRemoteGateway.isRemote()) {
            return ResponseUtil.fail("日志查询需要配置 byclaw.platform.execution-mode=remote 和 byclaw.platform.base-url");
        }
        logSearchReq.setRegion(logRegion.trim());
        logSearchReq.setProject(logProject.trim());
        logSearchReq.setLogstore(logstore.trim());
        return ResponseUtil.successResponse(platformRemoteGateway.call("logs", "search", logSearchReq));
    }

    /**
     * 判断时间范围是否有效。
     *
     * @param logSearchReq 日志查询条件
     * @return 是否为允许的时间范围
     */
    private boolean isValidTimeWindow(LogSearchReq logSearchReq) {
        return logSearchReq.getFrom() != null && logSearchReq.getTo() != null && logSearchReq.getFrom() >= 0
            && logSearchReq.getTo() <= Integer.MAX_VALUE && logSearchReq.getTo() > logSearchReq.getFrom()
            && logSearchReq.getTo() - logSearchReq.getFrom() <= LogSearchConstants.MAX_WINDOW_SECONDS;
    }

    /**
     * 判断分页大小是否有效。
     *
     * @param logSearchReq 日志查询条件
     * @return 是否为允许的分页大小
     */
    private boolean isValidPageSize(LogSearchReq logSearchReq) {
        return logSearchReq.getPageSize() >= LogSearchConstants.MIN_PAGE_SIZE
            && logSearchReq.getPageSize() <= LogSearchConstants.MAX_PAGE_SIZE;
    }

}
