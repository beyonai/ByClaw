package com.iwhalecloud.byai.state.interfaces.controller.personalmodel;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.aimodel.GptProxyChatCompletionsStreamApplicationService;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelManagementApplicationService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelIdRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelListRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelListResponse;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelUpsertRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelVO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.langfuse.LangfuseUsageService;
import com.iwhalecloud.byai.state.application.service.limit.TokenQuotaService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import lombok.extern.slf4j.Slf4j;
import java.time.YearMonth;
import java.util.ArrayList;
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
 * 个人模型管理控制器 复用系统级 ModelManagementApplicationService，按当前用户隔离数据
 */
@Slf4j
@Api(tags = "个人模型管理")
@RestController
@RequestMapping("/personal/model")
public class PersonalModelController {

    @Autowired
    private ModelManagementApplicationService modelManagementApplicationService;

    @Autowired
    private GptProxyChatCompletionsStreamApplicationService gptProxyChatCompletionsStreamApplicationService;

    @Autowired
    private LangfuseUsageService langfuseUsageService;

    @Autowired
    private TokenQuotaService tokenQuotaService;

    @ApiOperation("个人模型列表")
    @PostMapping("/list")
    public ResponseUtil<ModelListResponse> list(@RequestBody ModelListRequest request) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        request.setCreateBy(currentUserId);
        request.setOwnerType("PERSONAL");
        ModelListResponse data = modelManagementApplicationService.getModelListByPage(request);
        return ResponseUtil.success(data);
    }

    @ApiOperation("公共模型列表（只读）")
    @PostMapping("/listPublic")
    public ResponseUtil<ModelListResponse> listPublic(@RequestBody ModelListRequest request) {
        request.setOwnerType("PUBLIC");
        request.setCreateBy(null);
        request.setStatus("ENABLED");
        ModelListResponse data = modelManagementApplicationService.getModelListByPage(request);
        return ResponseUtil.success(data);
    }

    @ApiOperation("个人模型详情")
    @PostMapping("/detail")
    public ResponseUtil<ModelVO> detail(@RequestBody ModelIdRequest request) {
        ModelVO data = modelManagementApplicationService.getModelDetail(request.getId());
        return ResponseUtil.success(data);
    }

    @ApiOperation("新增/更新个人模型")
    @PostMapping("/upsert")
    public ResponseUtil<Map<String, String>> upsert(@RequestBody ModelUpsertRequest request) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        request.setOwnerType("PERSONAL");
        List<String> abilities = request.getAbilities();
        if (abilities == null || abilities.isEmpty()) {
            request.setAbilities(new ArrayList<>(List.of("3")));
        }
        else if (!abilities.contains("3")) {
            List<String> mutable = new ArrayList<>(abilities);
            mutable.add("3");
            request.setAbilities(mutable);
        }
        Map<String, String> data = modelManagementApplicationService.upsertModel(request, currentUserId);

        return ResponseUtil.success(data);
    }

    @ApiOperation("删除个人模型")
    @PostMapping("/delete")
    public ResponseUtil<Boolean> delete(@RequestBody ModelIdRequest request) {
        Boolean data = modelManagementApplicationService.deleteModel(request.getId());
        return ResponseUtil.success(data);
    }

    @ApiOperation("个人模型启停")
    @PostMapping("/setStatus")
    public ResponseUtil<Boolean> setStatus(@RequestBody Map<String, Object> request) {
        String id = String.valueOf(request.get("id"));
        String status = String.valueOf(request.get("status"));
        Boolean data = modelManagementApplicationService.setModelStatus(id, status);
        return ResponseUtil.success(data);
    }

    @ApiOperation("个人额度查询")
    @GetMapping("/quota")
    public ResponseUtil<Map<String, Object>> quota() {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        Long userId = CurrentUserHolder.getCurrentUserId();

        // 本月全量用量（所有模型，已按当月过滤）
        Map<String, Object> quotaData = langfuseUsageService.getUserUsage(userCode);

        // 限额信息（查询失败时降级，不影响基本用量展示）
        try {
            long quotaLimit = tokenQuotaService.getMonthlyQuotaLimit(userId);
            long used = quotaData.get("used") != null ? ((Number) quotaData.get("used")).longValue() : 0L;
            long remaining = Math.max(0, quotaLimit - used);

            quotaData.put("quotaLimit", quotaLimit);
            quotaData.put("quotaUsed", used);
            quotaData.put("remaining", remaining);
            quotaData.put("exceeded", used >= quotaLimit);

            YearMonth nextMonth = YearMonth.now().plusMonths(1);
            quotaData.put("resetDate", nextMonth.atDay(1).toString());
        }
        catch (Exception e) {
            log.warn("Token quota query failed, degrading gracefully: {}", e.getMessage());
        }

        return ResponseUtil.success(quotaData);
    }

    @ApiOperation("个人模型调试（流式）")
    @PostMapping(value = "/debug", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter debug(@RequestBody Map<String, Object> body) {
        return gptProxyChatCompletionsStreamApplicationService.startChatCompletionsStreamTest(body);
    }
}
