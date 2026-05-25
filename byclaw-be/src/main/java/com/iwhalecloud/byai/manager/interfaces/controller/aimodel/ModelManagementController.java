package com.iwhalecloud.byai.manager.interfaces.controller.aimodel;

import com.iwhalecloud.byai.manager.application.service.aimodel.GptProxyChatCompletionsStreamApplicationService;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelDebugRerankApplicationService;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelManagementApplicationService;
import com.iwhalecloud.byai.manager.application.service.aimodel.RerankDebugResult;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelIdRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelListRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelListResponse;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelSetStatusRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelUpsertRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelVO;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 模型管理控制器 接口前缀与文档一致：/aiFactoryServer/new/model（context-path 为 /aiFactoryServer 时）
 *
 * @author system
 */
@Api(tags = "模型管理")
@RestController
@RequestMapping("/new/model")
public class ModelManagementController {

    @Autowired
    private ModelManagementApplicationService modelManagementApplicationService;

    @Autowired
    private GptProxyChatCompletionsStreamApplicationService gptProxyChatCompletionsStreamApplicationService;

    @Autowired
    private ModelDebugRerankApplicationService modelDebugRerankApplicationService;

    /**
     * 模型列表（分页+过滤）
     */
    @ManageLogAnnotation(name = "模型管理", description = "模型列表分页")
    @ApiOperation("模型列表分页")
    @PostMapping("/getModelListByPage")
    public ResponseUtil<ModelListResponse> getModelListByPage(@RequestBody ModelListRequest request) {
        ModelListResponse data = modelManagementApplicationService.getModelListByPage(request);
        return ResponseUtil.success(data);
    }

    /**
     * 模型详情
     */
    @ManageLogAnnotation(name = "模型管理", description = "模型详情")
    @ApiOperation("模型详情")
    @PostMapping("/getModelDetail")
    public ResponseUtil<ModelVO> getModelDetail(@RequestBody ModelIdRequest request) {
        ModelVO data = modelManagementApplicationService.getModelDetail(request.getId());
        return ResponseUtil.success(data);
    }

    /**
     * 新增/更新模型
     */
    @ManageLogAnnotation(name = "模型管理", description = "新增或更新模型")
    @ApiOperation("新增或更新模型")
    @PostMapping("/upsertModel")
    public ResponseUtil<Map<String, String>> upsertModel(@RequestBody ModelUpsertRequest request) {
        Map<String, String> data = modelManagementApplicationService.upsertModel(request, null);
        return ResponseUtil.success(data);
    }

    /**
     * 删除模型
     */
    @ManageLogAnnotation(name = "模型管理", description = "删除模型")
    @ApiOperation("删除模型")
    @PostMapping("/deleteModel")
    public ResponseUtil<Boolean> deleteModel(@RequestBody ModelIdRequest request) {
        Boolean data = modelManagementApplicationService.deleteModel(request.getId());
        return ResponseUtil.success(data);
    }

    /**
     * 设置模型状态（启用/停用）
     */
    @ManageLogAnnotation(name = "模型管理", description = "设置模型状态")
    @ApiOperation("设置模型状态")
    @PostMapping("/setModelStatus")
    public ResponseUtil<Boolean> setModelStatus(@RequestBody ModelSetStatusRequest request) {
        Boolean data = modelManagementApplicationService.setModelStatus(request.getId(), request.getStatus());
        return ResponseUtil.success(data);
    }

    @ManageLogAnnotation(name = "模型管理", description = "ChatCompletions流式代理调试")
    @ApiOperation("ChatCompletions 流式代理")
    @PostMapping(value = "/debugModelStream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter chatCompletionsStreamTest(@RequestBody Map<String, Object> body) {
        return gptProxyChatCompletionsStreamApplicationService.startChatCompletionsStreamTest(body);
    }

    /**
     * RERANK 调试代理（非流式）。
     * <p>
     * 说明：入参与 debugModelStream 保持一致（body.input 内包含 url/headers/param），返回上游响应便于排障。 若请求体带有效 id，则按调试结果更新模型状态：成功
     * OOA+Redis，失败 OOD 并从 Redis 移除（Story 约定）。
     */
    @ManageLogAnnotation(name = "模型管理", description = "RERANK调试代理")
    @ApiOperation("RERANK 调试代理")
    @PostMapping(value = "/debugModelRerank", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseUtil<Object> debugModelRerank(@RequestBody Map<String, Object> body) {
        Long modelId = modelManagementApplicationService.parseModelIdFromBody(body);
        try {
            RerankDebugResult result = modelDebugRerankApplicationService.startRerankDebug(body);
            modelManagementApplicationService.updateModelStatusAfterDebug(modelId, true);
            return ResponseUtil.successResponse(result.getBody());
        }
        catch (BaseException e) {
            modelManagementApplicationService.updateModelStatusAfterDebug(modelId, false);
            throw e;
        }
    }

    /**
     * EMBEDDING 调试代理（非流式）。
     * <p>
     * 说明：入参与 debugModelStream 保持一致（body.input 内包含 url/headers/param），返回上游响应。 若请求体带有效 id，则按调试结果更新模型状态。
     */
    @ManageLogAnnotation(name = "模型管理", description = "EMBEDDING调试代理")
    @ApiOperation("EMBEDDING 调试代理")
    @PostMapping(value = "/debugModelEmbedding", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseUtil<Object> debugModelEmbedding(@RequestBody Map<String, Object> body) {
        Long modelId = modelManagementApplicationService.parseModelIdFromBody(body);
        try {
            RerankDebugResult result = modelDebugRerankApplicationService.startRerankDebug(body);
            modelManagementApplicationService.updateModelStatusAfterDebug(modelId, true);
            return ResponseUtil.successResponse(result.getBody());
        }
        catch (BaseException e) {
            modelManagementApplicationService.updateModelStatusAfterDebug(modelId, false);
            throw e;
        }
    }

    @ManageLogAnnotation(name = "模型管理", description = "按条件查询模型列表")
    @ApiOperation("模型接口查询")
    @PostMapping(value = "/listModel", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseUtil<List<ByaiAimodel>> listModel(@RequestBody ModelRequest request) {
        return ResponseUtil.successResponse(modelManagementApplicationService.listModel(request));
    }

    @ManageLogAnnotation(name = "模型管理", description = "查询默认模型ID")
    @ApiOperation("查询默认模型")
    @GetMapping(value = "/getDefaultModelId", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseUtil<String> getDefaultModelId() {
        return ResponseUtil.successResponse(modelManagementApplicationService.getDefaultModelId());
    }

}
