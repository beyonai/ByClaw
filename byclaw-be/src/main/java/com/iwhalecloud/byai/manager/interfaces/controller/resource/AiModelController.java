package com.iwhalecloud.byai.manager.interfaces.controller.resource;

import com.iwhalecloud.byai.manager.entity.resource.AiModel;
import com.iwhalecloud.byai.manager.domain.resource.service.AiModelDbService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * AI模型管理控制器
 */
@Api(tags = "AI模型管理")
@RestController
@RequestMapping("/new/aimodel")
public class AiModelController {

    @Autowired
    private AiModelDbService aiModelDbService;

    /**
     * 查询所有AI模型列表
     */
    @ApiOperation("查询所有AI模型列表")
    @PostMapping("/getAiModels")
    public ResponseUtil getAiModels() {
        List<AiModel> aiModels = aiModelDbService.getAiModels();
        return ResponseUtil.success(aiModels);
    }
} 