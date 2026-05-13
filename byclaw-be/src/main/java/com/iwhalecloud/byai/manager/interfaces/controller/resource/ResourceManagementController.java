package com.iwhalecloud.byai.manager.interfaces.controller.resource;

import com.iwhalecloud.byai.manager.domain.resource.service.ResourceAuthApplicationService;
import io.swagger.annotations.Api;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Api(tags = "资源管理")
@RestController
@RequestMapping("/new/resource")
@Validated
public class ResourceManagementController {

    @Autowired
    private ResourceAuthApplicationService resourceAuthApplicationService;



}