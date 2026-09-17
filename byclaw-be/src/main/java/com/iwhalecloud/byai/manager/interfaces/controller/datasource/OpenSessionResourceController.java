package com.iwhalecloud.byai.manager.interfaces.controller.datasource;

import com.iwhalecloud.byai.manager.application.service.datasource.SessionResourceQueryService;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourcePage;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourceQueryDto;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Uses the existing authenticated request interceptor. Do not add body-logging annotations. */
@RestController
@RequestMapping("/open/api/v1/sessionResources")
public class OpenSessionResourceController {
    private final SessionResourceQueryService service;

    public OpenSessionResourceController(SessionResourceQueryService service) {
        this.service = service;
    }

    @PostMapping("/query")
    public ResponseUtil<SessionResourcePage> query(@Valid @RequestBody SessionResourceQueryDto query,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ResponseUtil.successResponse(service.query(query, true));
    }
}
