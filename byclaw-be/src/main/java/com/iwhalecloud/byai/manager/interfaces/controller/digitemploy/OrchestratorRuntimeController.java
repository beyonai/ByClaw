package com.iwhalecloud.byai.manager.interfaces.controller.digitemploy;

import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGroupApplicationService;
import com.iwhalecloud.byai.manager.dto.orchestrator.OrchestratorRuntimeDTO;
import com.iwhalecloud.byai.manager.dto.orchestrator.OrchestratorRuntimeRequestDTO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * byclaw-super 数字员工组运行时聚合接口；继续使用现有 Beyond-Token 登录拦截器。
 *
 * @author qin.guoquan
 * @date 2026-08-10 17:38:38
 */
@RestController
@RequestMapping("/internal/v1/orchestrators")
public class OrchestratorRuntimeController {

    private static final Logger logger = LoggerFactory.getLogger(OrchestratorRuntimeController.class);

    private final DigitalEmployeeGroupApplicationService digitalEmployeeGroupApplicationService;

    public OrchestratorRuntimeController(
        DigitalEmployeeGroupApplicationService digitalEmployeeGroupApplicationService) {
        this.digitalEmployeeGroupApplicationService = digitalEmployeeGroupApplicationService;
    }

    @PostMapping("/resolve-runtime")
    public ResponseEntity<ResponseUtil<OrchestratorRuntimeDTO>> resolveRuntime(
        @RequestBody OrchestratorRuntimeRequestDTO request) {
        try {
            return ResponseEntity.ok(ResponseUtil.successResponse(
                digitalEmployeeGroupApplicationService.resolveRuntime(request)));
        }
        catch (ResponseStatusException e) {
            return ResponseEntity.status(e.getStatusCode())
                .body(ResponseUtil.fail(e.getReason()));
        }
        catch (Exception e) {
            logger.error("数字员工组运行时解析服务不可用, orchestratorId={}",
                request == null ? null : request.getOrchestratorId(), e);
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(ResponseUtil.fail("数字员工组权限或配置服务不可用"));
        }
    }
}
