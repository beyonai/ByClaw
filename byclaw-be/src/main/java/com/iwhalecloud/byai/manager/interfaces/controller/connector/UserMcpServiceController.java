package com.iwhalecloud.byai.manager.interfaces.controller.connector;

import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.domain.usermcp.UserMcpServiceFacade;
import com.iwhalecloud.byai.manager.domain.usermcp.UserMcpReadToolGateway;
import com.iwhalecloud.byai.manager.dto.connector.McpCredentialInput;
import com.iwhalecloud.byai.manager.dto.usermcp.UserMcpServiceDto;
import com.iwhalecloud.byai.manager.dto.usermcp.UserMcpServiceRequest;
import com.iwhalecloud.byai.manager.dto.usermcp.UserMcpToolCallRequest;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

@RestController
@RequestMapping("/connector/mcp-services")
public class UserMcpServiceController {

    private final UserMcpServiceFacade facade;
    private final Supplier<Long> currentUserId;
    private final UserMcpReadToolGateway toolGateway;

    public UserMcpServiceController(UserMcpServiceFacade facade) {
        this(facade, null, CurrentUserHolder::getCurrentUserId);
    }

    UserMcpServiceController(UserMcpServiceFacade facade, Supplier<Long> currentUserId) {
        this(facade, null, currentUserId);
    }

    @Autowired
    public UserMcpServiceController(UserMcpServiceFacade facade, UserMcpReadToolGateway toolGateway) {
        this(facade, toolGateway, CurrentUserHolder::getCurrentUserId);
    }

    UserMcpServiceController(
            UserMcpServiceFacade facade,
            UserMcpReadToolGateway toolGateway,
            Supplier<Long> currentUserId) {
        this.facade = facade;
        this.toolGateway = toolGateway;
        this.currentUserId = currentUserId;
    }

    @PostMapping("/validate")
    public ResponseUtil<UserMcpServiceDto> validate(@RequestBody UserMcpServiceRequest request) {
        return ResponseUtil.successResponse(facade.validate(request));
    }

    @PostMapping
    public ResponseUtil<UserMcpServiceDto> create(@RequestBody UserMcpServiceRequest request) {
        return ResponseUtil.successResponse(facade.create(request, userId()));
    }

    @GetMapping
    public ResponseUtil<List<UserMcpServiceDto>> list() {
        return ResponseUtil.successResponse(facade.list(userId()));
    }

    @GetMapping("/{resourceId}")
    public ResponseUtil<UserMcpServiceDto> get(@PathVariable Long resourceId) {
        return ResponseUtil.successResponse(facade.get(resourceId, userId()));
    }

    @PutMapping("/{resourceId}")
    public ResponseUtil<UserMcpServiceDto> update(
            @PathVariable Long resourceId,
            @RequestBody UserMcpServiceRequest request) {
        return ResponseUtil.successResponse(facade.update(resourceId, request, userId()));
    }

    @DeleteMapping("/{resourceId}")
    public ResponseUtil<Boolean> delete(@PathVariable Long resourceId) {
        facade.delete(resourceId, userId());
        return ResponseUtil.successResponse(true);
    }

    @PutMapping("/{resourceId}/enabled")
    public ResponseUtil<Boolean> setEnabled(
            @PathVariable Long resourceId,
            @RequestBody Map<String, Boolean> request) {
        facade.setEnabled(resourceId, Boolean.TRUE.equals(request.get("enabled")), userId());
        return ResponseUtil.successResponse(true);
    }

    @PostMapping("/{resourceId}/tools/refresh")
    public ResponseUtil<UserMcpServiceDto> refreshTools(
            @PathVariable Long resourceId,
            @RequestBody(required = false) McpCredentialInput credentialInput) {
        return ResponseUtil.successResponse(facade.refreshTools(resourceId, credentialInput, userId()));
    }

    @PostMapping("/{resourceId}/tools/{toolName}/call")
    public ResponseUtil<Object> callReadTool(
            @PathVariable Long resourceId,
            @PathVariable String toolName,
            @RequestBody UserMcpToolCallRequest request) {
        if (toolGateway == null) {
            throw new IllegalStateException("MCP tool gateway is unavailable");
        }
        return ResponseUtil.successResponse(JSON.parse(toolGateway.call(
            resourceId, request.snapshotVersion(), toolName, request.arguments(), userId())));
    }

    private Long userId() {
        Long userId = currentUserId.get();
        if (userId == null) {
            throw new SecurityException("Current user is required");
        }
        return userId;
    }
}
