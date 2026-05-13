package com.iwhalecloud.byai.state.interfaces.controller.langfuse;

import com.iwhalecloud.byai.state.domain.langfuse.service.LangfuseService;
import com.iwhalecloud.byai.state.interfaces.controller.langfuse.dto.LangfuseQueryDto;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Langfuse控制器 提供查询Traces和Observations的REST API接口
 */
@Slf4j
@RestController
@RequestMapping("/langfuse")
@Tag(name = "Langfuse管理", description = "提供Langfuse Traces和Observations查询功能")
public class LangfuseController {

    @Autowired
    private LangfuseService langfuseService;

    /**
     * 查询Traces列表
     *
     * @param queryDto 查询参数
     * @return ResponseUtil
     */
    @PostMapping(value = "/traces")
    @Operation(summary = "查询Traces列表", description = "根据条件查询Langfuse Traces列表")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "参数错误"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil queryTraces(@RequestBody LangfuseQueryDto queryDto) {
        try {
            log.info("Querying traces with parameters: {}", queryDto);
            Map<String, Object> result = langfuseService.queryTraces(queryDto);

            if (result.containsKey("error") && (Boolean) result.get("error")) {
                return ResponseUtil.fail((String) result.get("message"));
            }

            return ResponseUtil.successResponse(result);
        }
        catch (Exception e) {
            log.error("Error querying traces", e);
            return ResponseUtil.fail("查询Traces失败: " + e.getMessage());
        }
    }

    /**
     * 根据Trace ID查询Observations
     *
     * @param traceId Trace ID
     * @param queryDto 查询参数
     * @return ResponseUtil
     */
    @PostMapping(value = "/traces/{traceId}/observations")
    @Operation(summary = "查询Trace的Observations", description = "根据Trace ID查询相关的Observations")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "Trace ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil queryObservationsByTraceId(
        @Parameter(description = "Trace ID", required = true) @PathVariable("traceId") String traceId,
        @RequestBody LangfuseQueryDto queryDto) {

        if (StringUtils.isBlank(traceId)) {
            throw new BdpRuntimeException(I18nUtil.get("langfuse.trace.id.not.empty"));
        }

        try {
            log.info("Querying observations for trace: {} with parameters: {}", traceId, queryDto);
            Map<String, Object> result = langfuseService.queryObservationsByTraceId(traceId, queryDto);

            if (result.containsKey("error") && (Boolean) result.get("error")) {
                return ResponseUtil.fail((String) result.get("message"));
            }

            return ResponseUtil.successResponse(result);
        }
        catch (Exception e) {
            log.error("Error querying observations for trace: {}", traceId, e);
            return ResponseUtil.fail("查询Observations失败: " + e.getMessage());
        }
    }

    /**
     * 查询所有Observations
     *
     * @param queryDto 查询参数
     * @return ResponseUtil
     */
    @PostMapping(value = "/observations")
    @Operation(summary = "查询Observations列表", description = "根据条件查询所有Observations")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "参数错误"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil queryObservations(@RequestBody LangfuseQueryDto queryDto) {
        try {
            log.info("Querying observations with parameters: {}", queryDto);
            Map<String, Object> result = langfuseService.queryObservations(queryDto);

            if (result.containsKey("error") && (Boolean) result.get("error")) {
                return ResponseUtil.fail((String) result.get("message"));
            }

            return ResponseUtil.successResponse(result);
        }
        catch (Exception e) {
            log.error("Error querying observations", e);
            return ResponseUtil.fail("查询Observations失败: " + e.getMessage());
        }
    }

    /**
     * 根据ID获取Trace详情
     *
     * @param traceId Trace ID
     * @return ResponseUtil
     */
    @GetMapping(value = "/traces/{traceId}")
    @Operation(summary = "获取Trace详情", description = "根据Trace ID获取详细信息")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "Trace ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil getTraceById(
        @Parameter(description = "Trace ID", required = true) @PathVariable("traceId") String traceId) {

        if (StringUtils.isBlank(traceId)) {
            throw new BdpRuntimeException(I18nUtil.get("langfuse.trace.id.not.empty"));
        }

        try {
            log.info("Getting trace details for ID: {}", traceId);
            Map<String, Object> result = langfuseService.getTraceById(traceId);

            if (result.containsKey("error") && (Boolean) result.get("error")) {
                return ResponseUtil.fail((String) result.get("message"));
            }

            return ResponseUtil.successResponse(result);
        }
        catch (Exception e) {
            log.error("Error getting trace details for ID: {}", traceId, e);
            return ResponseUtil.fail("获取Trace详情失败: " + e.getMessage());
        }
    }

    /**
     * 根据ID获取Trace详情
     *
     * @param traceId Trace ID
     * @return ResponseUtil
     */
    @PostMapping(value = "/getTraceTimelineBasicInfo/{traceId}")
    @Operation(summary = "根据traceId查询时间线基本信息", description = "根据traceId查询时间线基本信息")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "Trace ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil getTraceTimelineBasicInfo(
        @Parameter(description = "Trace ID", required = true) @PathVariable("traceId") String traceId,
        @RequestBody LangfuseQueryDto queryDto) {

        if (StringUtils.isBlank(traceId)) {
            throw new BdpRuntimeException(I18nUtil.get("langfuse.trace.id.not.empty"));
        }

        try {
            log.info("getTraceTimelineBasicInfo for traceId: {}", traceId);
            Map<String, Object> result = langfuseService.getTraceTimelineBasicInfo(traceId, queryDto);
            if (result.containsKey("error") && (Boolean) result.get("error")) {
                return ResponseUtil.fail((String) result.get("message"));
            }

            return ResponseUtil.successResponse(result);
        }
        catch (Exception e) {
            log.error("Error getting trace details for ID: {}", traceId, e);
            return ResponseUtil.fail("获取Trace时间线基本信息失败: " + e.getMessage());
        }
    }

    /**
     * 根据ID获取Observation详情
     *
     * @param observationId Observation ID
     * @return ResponseUtil
     */
    @GetMapping(value = "/observations/{observationId}")
    @Operation(summary = "获取Observation详情", description = "根据Observation ID获取详细信息")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "Observation ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil getObservationById(@Parameter(description = "Observation ID",
        required = true) @PathVariable("observationId") String observationId) {

        if (StringUtils.isBlank(observationId)) {
            throw new BdpRuntimeException(I18nUtil.get("langfuse.observation.id.not.empty"));
        }

        try {
            log.info("Getting observation details for ID: {}", observationId);
            Map<String, Object> result = langfuseService.getObservationById(observationId);

            if (result.containsKey("error") && (Boolean) result.get("error")) {
                return ResponseUtil.fail((String) result.get("message"));
            }

            return ResponseUtil.successResponse(result);
        }
        catch (Exception e) {
            log.error("Error getting observation details for ID: {}", observationId, e);
            return ResponseUtil.fail("获取Observation详情失败: " + e.getMessage());
        }
    }

    /**
     * 获取Langfuse配置信息
     *
     * @return ResponseUtil
     */
    @GetMapping(value = "/config")
    @Operation(summary = "获取Langfuse配置", description = "获取当前Langfuse连接配置信息")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil getLangfuseConfig() {
        try {
            log.info("Getting Langfuse configuration");
            Map<String, Object> config = Map.of("host", langfuseService.getLangfuseHost(), "environment",
                langfuseService.getLangfuseEnv(), "hasSecretKey",
                StringUtils.isNotBlank(langfuseService.getLangfuseSecretKey()), "hasPublicKey",
                StringUtils.isNotBlank(langfuseService.getLangfusePublicKey()));
            return ResponseUtil.successResponse(config);
        }
        catch (Exception e) {
            log.error("Error getting Langfuse configuration", e);
            return ResponseUtil.fail("获取Langfuse配置失败: " + e.getMessage());
        }
    }

    /**
     * 根据sessionId查询Traces
     *
     * @param sessionId 会话ID
     * @param queryDto 查询参数
     * @return ResponseUtil
     */
    @PostMapping(value = "/sessions/{sessionId}/traces")
    @Operation(summary = "根据sessionId查询Traces", description = "根据会话ID查询相关的Traces")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "会话ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil queryTracesBySessionId(
        @Parameter(description = "会话ID", required = true) @PathVariable("sessionId") String sessionId,
        @RequestBody(required = false) LangfuseQueryDto queryDto) {

        if (StringUtils.isBlank(sessionId)) {
            throw new BdpRuntimeException(I18nUtil.get("langfuse.session.id.not.empty"));
        }

        try {
            log.info("Querying traces by sessionId: {} with parameters: {}", sessionId, queryDto);
            Map<String, Object> result = langfuseService.queryTracesBySessionId(sessionId, queryDto);

            if (result.containsKey("error") && (Boolean) result.get("error")) {
                return ResponseUtil.fail((String) result.get("message"));
            }

            return ResponseUtil.successResponse(result);
        }
        catch (Exception e) {
            log.error("Error querying traces by sessionId: {}", sessionId, e);
            return ResponseUtil.fail("根据sessionId查询Traces失败: " + e.getMessage());
        }
    }

    /**
     * 根据sessionId查询完整的会话流程
     *
     * @param sessionId 会话ID
     * @param queryDto 查询参数
     * @return ResponseUtil
     */
    @PostMapping(value = "/sessions/{sessionId}/flow")
    @Operation(summary = "查询会话完整流程", description = "根据会话ID查询完整的会话流程（Traces + Observations）")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "会话ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil querySessionFlowBySessionId(
        @Parameter(description = "会话ID", required = true) @PathVariable("sessionId") String sessionId,
        @RequestBody(required = false) LangfuseQueryDto queryDto) {

        if (StringUtils.isBlank(sessionId)) {
            throw new BdpRuntimeException(I18nUtil.get("langfuse.session.id.not.empty"));
        }

        try {
            log.info("Querying session flow by sessionId: {} with parameters: {}", sessionId, queryDto);
            Map<String, Object> result = langfuseService.querySessionFlowBySessionId(sessionId, queryDto);

            if (result.containsKey("error") && (Boolean) result.get("error")) {
                return ResponseUtil.fail((String) result.get("message"));
            }

            return ResponseUtil.successResponse(result);
        }
        catch (Exception e) {
            log.error("Error querying session flow by sessionId: {}", sessionId, e);
            return ResponseUtil.fail("查询会话流程失败: " + e.getMessage());
        }
    }

    /**
     * 根据sessionId获取会话统计信息
     *
     * @param sessionId 会话ID
     * @return ResponseUtil
     */
    @GetMapping(value = "/sessions/{sessionId}/statistics")
    @Operation(summary = "获取会话统计信息", description = "根据会话ID获取会话的统计信息")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "会话ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil getSessionStatisticsBySessionId(
        @Parameter(description = "会话ID", required = true) @PathVariable("sessionId") String sessionId) {

        if (StringUtils.isBlank(sessionId)) {
            throw new BdpRuntimeException(I18nUtil.get("langfuse.session.id.not.empty"));
        }

        try {
            log.info("Getting session statistics for sessionId: {}", sessionId);
            Map<String, Object> result = langfuseService.getSessionStatisticsBySessionId(sessionId);

            if (result.containsKey("error") && (Boolean) result.get("error")) {
                return ResponseUtil.fail((String) result.get("message"));
            }

            return ResponseUtil.successResponse(result);
        }
        catch (Exception e) {
            log.error("Error getting session statistics for sessionId: {}", sessionId, e);
            return ResponseUtil.fail("获取会话统计信息失败: " + e.getMessage());
        }
    }

    /**
     * 根据sessionId查询最近的会话记录
     *
     * @param sessionId 会话ID
     * @param limit 限制数量
     * @return ResponseUtil
     */
    @GetMapping(value = "/sessions/{sessionId}/recent")
    @Operation(summary = "查询最近会话记录", description = "根据会话ID查询最近的会话记录")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "会话ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil getRecentSessionsBySessionId(
        @Parameter(description = "会话ID", required = true) @PathVariable("sessionId") String sessionId,
        @Parameter(description = "限制数量", required = false) @RequestParam(defaultValue = "10") Integer limit) {

        if (StringUtils.isBlank(sessionId)) {
            throw new BdpRuntimeException(I18nUtil.get("langfuse.session.id.not.empty"));
        }

        try {
            log.info("Getting recent sessions for sessionId: {} with limit: {}", sessionId, limit);
            Map<String, Object> result = langfuseService.getRecentSessionsBySessionId(sessionId, limit);

            if (result.containsKey("error") && (Boolean) result.get("error")) {
                return ResponseUtil.fail((String) result.get("message"));
            }

            return ResponseUtil.successResponse(result);
        }
        catch (Exception e) {
            log.error("Error getting recent sessions for sessionId: {}", sessionId, e);
            return ResponseUtil.fail("查询最近会话记录失败: " + e.getMessage());
        }
    }

    /**
     * 根据sessionId查询会话的Observations
     *
     * @param sessionId 会话ID
     * @param queryDto 查询参数
     * @return ResponseUtil
     */
    @PostMapping(value = "/sessions/{sessionId}/observations")
    @Operation(summary = "查询会话Observations", description = "根据会话ID查询相关的Observations")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "会话ID不能为空"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil queryObservationsBySessionId(
        @Parameter(description = "会话ID", required = true) @PathVariable("sessionId") String sessionId,
        @RequestBody(required = false) LangfuseQueryDto queryDto) {

        if (StringUtils.isBlank(sessionId)) {
            throw new BdpRuntimeException(I18nUtil.get("langfuse.session.id.not.empty"));
        }

        try {
            log.info("Querying observations by sessionId: {} with parameters: {}", sessionId, queryDto);

            // 先查询sessionId对应的Traces
            Map<String, Object> tracesResult = langfuseService.queryTracesBySessionId(sessionId, queryDto);
            if (tracesResult.containsKey("error") && (Boolean) tracesResult.get("error")) {
                return ResponseUtil.fail((String) tracesResult.get("message"));
            }

            // 获取所有Trace的Observations
            List<Map<String, Object>> allObservations = new ArrayList<>();
            if (tracesResult.containsKey("data")) {
                List<Map<String, Object>> traces = (List<Map<String, Object>>) tracesResult.get("data");

                for (Map<String, Object> trace : traces) {
                    String traceId = (String) trace.get("id");
                    if (traceId != null) {
                        Map<String, Object> observationsResult = langfuseService.queryObservationsByTraceId(traceId,
                            queryDto);
                        if (!observationsResult.containsKey("error") || !(Boolean) observationsResult.get("error")) {
                            if (observationsResult.containsKey("data")) {
                                List<Map<String, Object>> observations = (List<Map<String, Object>>) observationsResult
                                    .get("data");
                                allObservations.addAll(observations);
                            }
                        }
                    }
                }
            }

            Map<String, Object> result = new HashMap<>();
            result.put("sessionId", sessionId);
            result.put("observations", allObservations);
            result.put("totalObservations", allObservations.size());
            result.put("totalTraces", tracesResult.containsKey("total") ? tracesResult.get("total") : 0);

            return ResponseUtil.successResponse(result);
        }
        catch (Exception e) {
            log.error("Error querying observations by sessionId: {}", sessionId, e);
            return ResponseUtil.fail("根据sessionId查询Observations失败: " + e.getMessage());
        }
    }
}
