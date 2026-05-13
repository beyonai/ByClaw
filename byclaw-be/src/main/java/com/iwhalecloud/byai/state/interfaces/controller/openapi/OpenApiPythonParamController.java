package com.iwhalecloud.byai.state.interfaces.controller.openapi;

import com.iwhalecloud.byai.state.domain.chat.service.ParamService;
import com.iwhalecloud.byai.state.infrastructure.utils.ChatUtils;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.util.HashMap;
import java.util.Map;

/**
 * 暴露python参数获取接口
 */
@RestController
@RequestMapping("/open/api")
@Tag(name = "参数获取接口", description = "参数获取管理")
@Slf4j
public class OpenApiPythonParamController {

    @Autowired
    private ParamService paramService;

    /**
     * 获取Python环境参数和联网参数
     * 
     * @param modelAnswerMessageId 模型回答消息ID
     * @return ResponseUtil<Map<String, Object>> 包含env和connect_params的响应
     */
    @GetMapping("/python/params")
    @Operation(summary = "获取Python环境参数和联网参数", description = "获取Python环境参数和联网参数")
    public ResponseUtil<Map<String, Object>> getPythonParams(@RequestParam Long modelAnswerMessageId) {
        Map<String, Object> result = new HashMap<>();
        // 获取环境参数
        Map<String, Object> envMap = paramService.getPythonEnv(modelAnswerMessageId);
        // 获取联网参数
        Map<String, Object> connectParams = ChatUtils.getConnectParams();

        result.put("env", envMap);
        result.put("connect_params", connectParams);
        return ResponseUtil.successResponse(result);
    }
}
