package com.iwhalecloud.byai.manager.interfaces.controller.connector;

import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.connector.ConnectorApplicationService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorAuthorizationService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorAuthService;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorAuthorizationDto;
import com.iwhalecloud.byai.manager.dto.connector.CancelConnectorAuthorizationRequest;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorConnectionDto;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorListDto;
import com.iwhalecloud.byai.manager.dto.connector.StartConnectorAuthorizationRequest;
import com.iwhalecloud.byai.manager.dto.connector.UpdateConnectorEnableRequest;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.connector.ConnectorQo;
import org.springframework.beans.factory.annotation.Autowired;
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
    private ConnectorAuthService connectorAuthService;

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

    @PostMapping("/authorization/cancel")
    public ResponseUtil<Boolean> cancelAuthorization(@RequestBody CancelConnectorAuthorizationRequest request) {
        if (request == null || request.getAuthorizationId() == null || request.getAuthorizationId().trim().isEmpty()) {
            throw new IllegalArgumentException("authorizationId不能为空");
        }
        return ResponseUtil.successResponse(connectorAuthorizationService.cancel(request.getAuthorizationId(), currentUserId()));
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
