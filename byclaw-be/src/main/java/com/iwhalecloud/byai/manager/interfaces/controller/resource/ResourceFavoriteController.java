package com.iwhalecloud.byai.manager.interfaces.controller.resource;

import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceFavoriteQo;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceFavoriteService;
import com.iwhalecloud.byai.manager.vo.auth.ResourceFavoriteVo;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/resource/favorite")
@RequiredArgsConstructor
public class ResourceFavoriteController {
    private final ResourceFavoriteService service;

    @PostMapping("/set")
    public ResponseUtil<ResourceFavoriteVo> set(@Valid @RequestBody ResourceFavoriteQo qo) {
        return ResponseUtil.successResponse(service.setFavorite(qo));
    }
}
