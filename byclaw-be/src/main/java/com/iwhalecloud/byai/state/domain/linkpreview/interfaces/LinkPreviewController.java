package com.iwhalecloud.byai.state.domain.linkpreview.interfaces;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.linkpreview.application.LinkPreviewService;
import com.iwhalecloud.byai.state.domain.linkpreview.dto.LinkPreviewResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/link-preview")
public class LinkPreviewController {
    private final LinkPreviewService service;

    public LinkPreviewController(LinkPreviewService service) {
        this.service = service;
    }

    public record PreviewRequest(@NotBlank @Size(max = 4096) String url) {}

    @PostMapping
    public ResponseUtil<LinkPreviewResponse> preview(@Valid @RequestBody PreviewRequest request) {
        if (CurrentUserHolder.getLoginInfo() == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        return ResponseUtil.successResponse(service.preview(request.url()));
    }
}
