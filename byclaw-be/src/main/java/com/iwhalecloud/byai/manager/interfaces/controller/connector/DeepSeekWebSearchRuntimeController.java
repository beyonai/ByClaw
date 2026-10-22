package com.iwhalecloud.byai.manager.interfaces.controller.connector;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.connector.provider.deepseek.DeepSeekWebSearchResult;
import com.iwhalecloud.byai.manager.domain.connector.provider.deepseek.DeepSeekWebSearchRuntimeService;
import com.iwhalecloud.byai.manager.dto.connector.DeepSeekWebSearchRequest;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/connector/runtime/deepseek-web-search")
public class DeepSeekWebSearchRuntimeController {
    private final DeepSeekWebSearchRuntimeService runtimeService;

    public DeepSeekWebSearchRuntimeController(DeepSeekWebSearchRuntimeService runtimeService) {
        this.runtimeService = runtimeService;
    }

    @PostMapping("/search")
    public ResponseUtil<DeepSeekWebSearchResult> search(
            @RequestBody(required = false) DeepSeekWebSearchRequest request) {
        if (request == null) {
            throw new IllegalArgumentException(I18nUtil.get("connector.deepseek.search.body.required"));
        }
        java.util.List<String> queries = request.queries() == null
            ? (request.query() == null ? null : java.util.List.of(request.query()))
            : request.queries();
        return ResponseUtil.successResponse(runtimeService.search(
            CurrentUserHolder.getCurrentUserId(), queries, request.maxResults()));
    }
}
