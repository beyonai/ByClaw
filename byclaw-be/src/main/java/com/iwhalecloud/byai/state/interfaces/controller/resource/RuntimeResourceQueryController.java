package com.iwhalecloud.byai.state.interfaces.controller.resource;

import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.resource.service.RedisResourceQueryService;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Low-latency, Redis-only resource reads for runtime clients. */
@RestController
@RequestMapping("/api/v1/resources")
public class RuntimeResourceQueryController {
    @Autowired
    private RedisResourceQueryService resourceQueryService;

    @PostMapping("/query")
    public ResponseUtil<Map<String, Object>> query(@RequestBody(required = false) Map<String, Object> request) {
        return ResponseUtil.success(resourceQueryService.query(request));
    }
}
