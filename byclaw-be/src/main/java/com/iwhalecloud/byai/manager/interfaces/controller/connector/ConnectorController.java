package com.iwhalecloud.byai.manager.interfaces.controller.connector;

import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.connector.ConnectorApplicationService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorAuthorizationService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorAuthorizationRevocationService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorAuthService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorSkillAuthorizationSyncException;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorSkillAuthorizationSyncService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationCallback;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorAuthorizationDto;
import com.iwhalecloud.byai.manager.dto.connector.CancelConnectorAuthorizationRequest;
import com.iwhalecloud.byai.manager.dto.connector.CompleteSkillAuthorizationRequest;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorConnectionDto;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorListDto;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorSkillAuthorizationSyncDto;
import com.iwhalecloud.byai.manager.dto.connector.StartConnectorAuthorizationRequest;
import com.iwhalecloud.byai.manager.dto.connector.RevokeConnectorAuthorizationRequest;
import com.iwhalecloud.byai.manager.dto.connector.UpdateConnectorEnableRequest;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.connector.ConnectorQo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 连接器接口。
 *
 * @author he.duming
 * @date 2026-07-30 00:25:13
 */
@RestController
@RequestMapping("/connector")
public class ConnectorController {

    @Autowired
    private ConnectorApplicationService connectorApplicationService;

    @Autowired
    private ConnectorAuthorizationService connectorAuthorizationService;

    @Autowired
    private ConnectorAuthorizationRevocationService connectorAuthorizationRevocationService;

    @Autowired
    private ConnectorAuthService connectorAuthService;

    @Autowired
    private ConnectorSkillAuthorizationSyncService connectorSkillAuthorizationSyncService;

    /**
     * 分页查询连接器列表。
     *
     * @param qo 分页查询条件
     * @return 分页结果
     */
    @PostMapping("/listAll")
    public ResponseUtil<PageInfo<ConnectorListDto>> listAll(@RequestBody(required = false) ConnectorQo qo) {
        return ResponseUtil.successResponse(connectorApplicationService.listAll(qo));
    }

    @GetMapping("/connections")
    public ResponseUtil<java.util.List<ConnectorConnectionDto>> listConnections() {
        return ResponseUtil.successResponse(connectorApplicationService.listConnections());
    }

    @PostMapping("/authorization/start")
    public ResponseUtil<ConnectorAuthorizationDto> startAuthorization(
        @RequestBody(required = false) StartConnectorAuthorizationRequest request) {
        return ResponseUtil.successResponse(connectorAuthorizationService.start(request, currentUserId()));
    }

    @GetMapping("/authorization/status")
    public ResponseUtil<ConnectorAuthorizationDto> getAuthorizationStatus(
        @RequestParam(value = "authorizationId", required = false) String authorizationId) {
        return ResponseUtil.successResponse(connectorAuthorizationService.status(authorizationId, currentUserId()));
    }

    @GetMapping(value = "/authorization/callback/{providerCode}", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> handleAuthorizationCallback(
            @org.springframework.web.bind.annotation.PathVariable String providerCode,
            @RequestParam(value = "code", required = false) String code,
            @RequestParam(value = "state", required = false) String state,
            @RequestParam(value = "error", required = false) String error,
            @RequestParam(value = "error_description", required = false) String errorDescription) {
        ConnectorAuthorizationDto authorization = connectorAuthorizationService.callback(
            providerCode,
            new AuthorizationCallback(code, state, error, errorDescription),
            currentUserId()
        );
        boolean connected = "connected".equals(authorization.getStatus());
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("text/html;charset=UTF-8"))
            .header(HttpHeaders.CACHE_CONTROL, "no-store")
            .header("Content-Security-Policy",
                "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
                    + "base-uri 'none'; frame-ancestors 'none'")
            .header("X-Content-Type-Options", "nosniff")
            .body(ConnectorAuthorizationCallbackPage.render(connected));
    }

    @PostMapping("/authorization/cancel")
    public ResponseUtil<Boolean> cancelAuthorization(@RequestBody CancelConnectorAuthorizationRequest request) {
        if (request == null || request.getAuthorizationId() == null || request.getAuthorizationId().trim().isEmpty()) {
            throw new IllegalArgumentException("authorizationId不能为空");
        }
        return ResponseUtil.successResponse(connectorAuthorizationService.cancel(request.getAuthorizationId(), currentUserId()));
    }

    @PostMapping("/authorization/revoke")
    public ResponseUtil<Boolean> revokeAuthorization(@RequestBody RevokeConnectorAuthorizationRequest request) {
        if (request == null || request.getConnectorId() == null) {
            throw new IllegalArgumentException("connectorId不能为空");
        }
        connectorAuthorizationRevocationService.revoke(request.getConnectorId(), currentUserId());
        return ResponseUtil.successResponse(true);
    }

    @PostMapping("/authorization/skill-complete")
    public ResponseUtil<ConnectorSkillAuthorizationSyncDto> completeSkillAuthorization(
            @RequestBody CompleteSkillAuthorizationRequest request) {
        String connectorCode = request == null ? null : request.getConnectorCode();
        try {
            return ResponseUtil.successResponse(
                connectorSkillAuthorizationSyncService.sync(connectorCode, currentUserId())
            );
        } catch (ConnectorSkillAuthorizationSyncException e) {
            return ResponseUtil.failResponse(
                e.getErrorCode(),
                ConnectorSkillAuthorizationSyncDto.failed(
                    connectorCode == null ? null : connectorCode.trim(),
                    e.getErrorCode(),
                    e.isRetryable()
                )
            );
        }
    }

    @PostMapping("/enable")
    public ResponseUtil<Boolean> updateEnable(@RequestBody UpdateConnectorEnableRequest request) {
        if (request == null || request.getConnectorId() == null || request.getEnabled() == null) {
            throw new IllegalArgumentException("connectorId和enabled不能为空");
        }
        connectorAuthService.updateEnableFlag(request.getConnectorId(), request.getEnabled());
        return ResponseUtil.successResponse(true);
    }

    private String currentUserId() {
        return String.valueOf(CurrentUserHolder.getCurrentUserId());
    }

}
