package com.iwhalecloud.byai.manager.interfaces.controller.operations;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.iwhalecloud.byai.manager.domain.operations.OperationsAuthentication;
import com.iwhalecloud.byai.manager.domain.operations.OperationsFailure;
import com.iwhalecloud.byai.manager.domain.operations.PlatformOperationsService;
import com.iwhalecloud.byai.common.integration.security.InternalServicePrincipal;
import jakarta.servlet.http.HttpServletRequest;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** 平台运营服务间入口，所有结果使用安全投影。
 * @author Codex
 * @since 2026-10-23
 */
@RestController
public class PlatformOperationsController {
    private static final Logger LOG = LoggerFactory.getLogger(PlatformOperationsController.class);
    @Autowired
    private PlatformOperationsService service;

    /** 只接受固定操作集合；不透传任意路径、用户身份或执行参数。 */
    @PostMapping(OperationsAuthentication.PATH)
    public ResponseUtil<JsonNode> execute(
            HttpServletRequest http,
            @RequestBody JsonNode request) {
        InternalServicePrincipal principal = InternalServicePrincipal.require(http);
        principal.requireScope("tenant:manage");
        if (!principal.allTenants()) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        try {
            return ResponseUtil.success(service.execute(request));
        } catch (OperationsFailure failure) {
            return failure(failure.getKind());
        } catch (ResponseStatusException failure) {
            LOG.error("Platform operations request failed, status={}", failure.getStatusCode().value(), failure);
            int status = failure.getStatusCode().value();
            if (status == 404) {
                return failure("NOT_FOUND");
            }
            if (status == 409) {
                return failure("CONFLICT");
            }
            if (status == 400) {
                return failure("INVALID");
            }
            if (status == 401 || status == 403) {
                return failure("DENIED");
            }
            return failure("UNAVAILABLE");
        } catch (RuntimeException failure) {
            // 执行结果可能未知，调用方必须重读后由操作人决定，禁止自动重试。
            LOG.error("Platform operations request failed with unknown outcome", failure);
            return failure("UNKNOWN");
        }
    }

    /** 保持协议稳定，不回传异常消息、资源端点或密钥。 */
    private ResponseUtil<JsonNode> failure(String kind) {
        return ResponseUtil.failResponse("operations.request.failed",
            JsonNodeFactory.instance.objectNode().put("failure", kind));
    }
}

