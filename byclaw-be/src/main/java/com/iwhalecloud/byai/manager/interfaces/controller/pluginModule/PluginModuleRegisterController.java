package com.iwhalecloud.byai.manager.interfaces.controller.pluginModule;

import com.iwhalecloud.byai.manager.domain.pluginmodule.service.PluginModuleRegisterService;
import com.iwhalecloud.byai.manager.dto.pluginmodule.RegisterRequest;
import com.iwhalecloud.byai.manager.dto.pluginmodule.RegisterResponse;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/pluginModule/register")
public class PluginModuleRegisterController {

    private final PluginModuleRegisterService pluginModuleRegisterService;

    public PluginModuleRegisterController(PluginModuleRegisterService pluginModuleRegisterService) {
        this.pluginModuleRegisterService = pluginModuleRegisterService;
    }

    @ManageLogAnnotation(name = "搜问注册")
    @PostMapping("/searchQuery")
    public ResponseUtil registerSearchQuery(@Valid @RequestBody RegisterRequest request) {
        RegisterResponse response = pluginModuleRegisterService.registerSearchQuery(request);
        return ResponseUtil.successResponse(response.getMessage(), response);
    }

    @ManageLogAnnotation(name = "FunctionCloud注册")
    @PostMapping("/functionCloud")
    public ResponseUtil registerFunctionCloud(@Valid @RequestBody RegisterRequest request) {
        RegisterResponse response = pluginModuleRegisterService.registerFunctionCloud(request);
        return ResponseUtil.successResponse(response.getMessage(), response);
    }

    @ManageLogAnnotation(name = "DataCloud注册")
    @PostMapping("/dataCloud")
    public ResponseUtil registerDataCloud(@Valid @RequestBody RegisterRequest request) {
        RegisterResponse response = pluginModuleRegisterService.registerDataCloud(request);
        return ResponseUtil.successResponse(response.getMessage(), response);
    }
}
