package com.iwhalecloud.byai.gateway.sandbox.controller;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.openclaw.OpenClawUiProxyPaths;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceProfileEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceProfileEntity;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxHealthConfigService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxHealthWatermarkModelService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxHealthWatermarkService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxResizeService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.gateway.sandbox.support.SandboxEndpointRecordSupport;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxResizeRecord;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxResizeRecordMapper;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * 沙箱管理控制器
 * 提供沙箱心跳保活等接口
 */
@RestController
@RequestMapping("/sandbox")
@Tag(name = "沙箱管理", description = "提供沙箱心跳保活、状态查询等功能")
public class SandboxController {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Autowired
    private SandboxService sandboxService;

    @Autowired
    private SsSandboxRecordMapper sandboxRecordMapper;

    @Autowired
    private SandboxServiceSpecEntityMapper sandboxServiceSpecEntityMapper;

    @Autowired
    private SandboxServiceProfileEntityMapper sandboxServiceProfileEntityMapper;

    @Autowired
    private SsSandboxResizeRecordMapper sandboxResizeRecordMapper;

    @Autowired
    private SandboxUserContextRunner sandboxUserContextRunner;

    @Autowired
    private SandboxResizeService sandboxResizeService;

    @Autowired
    private SandboxHealthConfigService sandboxHealthConfigService;

    @Autowired
    private SandboxHealthWatermarkModelService sandboxHealthWatermarkModelService;

    @Autowired
    private SandboxHealthWatermarkService sandboxHealthWatermarkService;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Value("${server.servlet.context-path:}")
    private String contextPath;

    /**
     * 沙箱心跳接口
     * 前端定期轮询调用，更新沙箱最后访问时间，防止沙箱因空闲超时被自动回收
     *
     * @param params 请求参数，需包含 resourceId
     * @return ResponseUtil
     */
    @PostMapping("/heartbeat")
    @Operation(summary = "沙箱心跳", description = "前端定期调用此接口，刷新当前用户所有运行中沙箱的活跃时间，防止空闲超时自动回收")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "心跳成功"),
        @ApiResponse(responseCode = "-1", description = "心跳失败，参数缺失或沙箱不存在")
    })
    public ResponseUtil heartbeat(
        @Parameter(description = "请求参数，resourceId非必填") @RequestBody Map<String, Object> params) {
        Object resourceIdObj = params.get("resourceId");
        Long resourceId = null;
        if (resourceIdObj != null && resourceIdObj instanceof Number) {
            resourceId = ((Number) resourceIdObj).longValue();
        } else if (resourceIdObj != null) {
            try {
                resourceId = Long.parseLong(resourceIdObj.toString());
            } catch (NumberFormatException e) {
                return ResponseUtil.fail("resourceId must be a valid number");
            }
        }

        boolean success = sandboxService.heartbeat(resourceId);
        if (success) {
            return ResponseUtil.successResponse();
        }
        return ResponseUtil.fail("No running sandbox found for this resource");
    }

    /**
     * 沙箱续约接口
     * 同时刷新本地访问时间并调用远端沙箱续约，避免本地空闲回收和远端自动过期
     *
     * @param params 请求参数，resourceId非必填，userCode在未登录上下文下必填
     * @return ResponseUtil
     */
    @PostMapping("/renewSandbox")
    @Operation(summary = "沙箱续约", description = "手动续约当前沙箱，同时刷新本地访问时间并延长远端租约")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "续约成功"),
        @ApiResponse(responseCode = "-1", description = "续约失败，用户缺失或沙箱不存在")
    })
    public ResponseUtil renewSandbox(@RequestBody Map<String, Object> params) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (userCode == null) {
            Object userCodeObj = params.get("userCode");
            if (userCodeObj == null || userCodeObj.toString().trim().isEmpty()) {
                return ResponseUtil.fail("userCode is required");
            }
            userCode = userCodeObj.toString().trim();
        }

        Object resourceIdObj = params.get("resourceId");
        Long resourceId = null;
        if (resourceIdObj != null && resourceIdObj instanceof Number) {
            resourceId = ((Number) resourceIdObj).longValue();
        } else if (resourceIdObj != null) {
            try {
                resourceId = Long.parseLong(resourceIdObj.toString());
            } catch (NumberFormatException e) {
                return ResponseUtil.fail("resourceId must be a valid number");
            }
        }

        SandboxInfo sandboxInfo = sandboxService.renewSandbox(userCode, resourceId);
        if (sandboxInfo == null) {
            return ResponseUtil.fail("No running sandbox found for this resource");
        }

        Map<String, Object> result = new HashMap<>();
        result.put("userCode", sandboxInfo.getUserCode());
        result.put("sandboxType", sandboxInfo.getSandboxType());
        result.put("sandboxId", sandboxInfo.getSandboxId());
        result.put("endpoints", sandboxInfo.getEndpoints());
        result.put("instanceEndpoints", sandboxInfo.getInstanceEndpoints());
        result.put("token", sandboxInfo.getGatewayToken());
        result.put("remoteExpiresAt", sandboxInfo.getRemoteExpiresAt());
        result.put("lastHeartbeatTime", sandboxInfo.getLastHeartbeatTime());
        return ResponseUtil.successResponse(result);
    }

    /**
     * 查询当前用户的沙箱信息
     *
     * @return ResponseUtil
     */
    @PostMapping("/getSandboxInfo")
    @Operation(summary = "查询当前用户的沙箱信息", description = "查询当前用户的沙箱信息")
    public ResponseUtil getSandboxIdByUserCode(@RequestBody Map<String, Object> params) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (userCode == null) {
            Object userCodeObj = params.get("userCode");
            if (userCodeObj == null || userCodeObj.toString().trim().isEmpty()) {
                return ResponseUtil.fail("userCode is required");
            }
            userCode = userCodeObj.toString().trim();
        }
        List<SandboxInfo> sandboxInfo = sandboxService.sandboxInfo(userCode);

        Object sandboxTypeObj = params.get("sandboxType");
        String sandboxType = null;
        if (sandboxTypeObj != null) {
            sandboxType =  sandboxTypeObj.toString().trim();
        }

        List<Map<String, Object>> data = new ArrayList<>();
        if (sandboxInfo != null && !sandboxInfo.isEmpty()) {
            for (SandboxInfo sandbox : sandboxInfo) {
                if (sandboxType != null && !sandboxType.equalsIgnoreCase(sandbox.getSandboxType())) {
                    continue;
                }

                // 查询数据库记录获取完整状态
                SsSandboxRecord record = sandboxRecordMapper.selectRunningByUserAndResource(
                    userCode, sandbox.getSandboxType(), sandbox.getResourceId()
                );

                Map<String, Object> result = new HashMap<>();
                result.put("userCode", userCode);
                result.put("sandboxType", sandbox.getSandboxType());
                result.put("sandboxId", sandbox.getSandboxId());
                result.put("endpoints", sandbox.getEndpoints());
                result.put("instanceEndpoints", sandbox.getInstanceEndpoints());
                result.put("token", sandbox.getGatewayToken());
                result.put("status", record != null ? record.getStatus() : "UNKNOWN");
                data.add(result);
            }
        }
        return ResponseUtil.successResponse(data);
    }

    /**
     * 释放沙箱接口
     * 用于释放指定用户和资源的沙箱
     *
     * @param params 请求参数，需包含 userCode 和 resourceId
     * @return ResponseUtil
     */
    @PostMapping("/removeSandbox")
    @Operation(summary = "释放沙箱", description = "释放指定用户和资源的沙箱")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "释放成功"),
        @ApiResponse(responseCode = "-1", description = "释放失败，参数缺失")
    })
    public ResponseUtil removeSandbox(
        @Parameter(description = "请求参数，userCode和resourceId为必填") @RequestBody Map<String, Object> params) {
        String userCode = (String) params.get("userCode");
        Object resourceIdObj = params.get("resourceId");
        Long resourceId = null;

        if (userCode == null) {
            return ResponseUtil.fail("userCode is required");
        }

        if (resourceIdObj != null && resourceIdObj instanceof Number) {
            resourceId = ((Number) resourceIdObj).longValue();
        } else if (resourceIdObj != null) {
            try {
                resourceId = Long.parseLong(resourceIdObj.toString());
            } catch (NumberFormatException e) {
                return ResponseUtil.fail("resourceId must be a valid number");
            }
        }

        sandboxService.removeSandbox(userCode, resourceId);
        return ResponseUtil.successResponse();
    }

    /**
     * 按工号启动沙箱，支持通过 serviceKey 覆盖沙箱规格
     *
     * @param params 请求参数，userCode 必填，serviceKey 可选
     * @return ResponseUtil
     */
    @PostMapping("/launchByUserCode")
    @Operation(summary = "按工号启动沙箱", description = "按工号为指定用户启动沙箱，可选传入 serviceKey 覆盖默认沙箱规格")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "启动成功"),
        @ApiResponse(responseCode = "-1", description = "启动失败，参数缺失或规格不存在")
    })
    public ResponseUtil launchByUserCode(@RequestBody Map<String, Object> params) {
        Object userCodeObj = params.get("userCode");
        if (userCodeObj == null || userCodeObj.toString().trim().isEmpty()) {
            return ResponseUtil.fail("userCode is required");
        }
        String userCode = userCodeObj.toString().trim();

        Object serviceKeyObj = params.get("serviceKey");
        String serviceKey = serviceKeyObj != null ? serviceKeyObj.toString().trim() : null;
        if (serviceKey != null && serviceKey.isEmpty()) {
            serviceKey = null;
        }

        try {
            String finalServiceKey = serviceKey;
            SandboxLaunchData data = sandboxUserContextRunner.callAsUser(userCode,
                () -> sandboxService.launchSandboxWithServiceKey(userCode, finalServiceKey));

            // 持久化用户首选 serviceKey（非默认类型时）
            if (finalServiceKey != null && !SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE.equals(finalServiceKey)) {
                sandboxService.savePreferredServiceKey(userCode, finalServiceKey);
            }

            if (data == null) {
                return ResponseUtil.fail("沙箱启动失败");
            }
            Map<String, Object> result = new HashMap<>();
            result.put("endpoint", data.getEndpoint());
            result.put("sandboxId", data.getSandboxId());
            result.put("endpoints", data.getEndpoints());
            result.put("instanceEndpoints", data.getInstanceEndpoints());
            return ResponseUtil.successResponse(result);
        } catch (Exception e) {
            return ResponseUtil.fail("沙箱启动失败: " + e.getMessage());
        }
    }

    /**
     * 分页查询沙箱记录（管理端）
     *
     * @param params 请求参数，包含 pageIndex、pageSize、keyword、status
     * @return ResponseUtil
     */
    @PostMapping("/listRecords")
    @Operation(summary = "分页查询沙箱记录", description = "管理端分页查询沙箱记录，支持关键字搜索和状态过滤")
    public ResponseUtil listRecords(@RequestBody Map<String, Object> params) {
        int pageIndex = 1;
        int pageSize = 20;
        String keyword = null;
        String status = null;

        if (params.get("pageIndex") != null) {
            pageIndex = Integer.parseInt(params.get("pageIndex").toString());
        }
        if (params.get("pageSize") != null) {
            pageSize = Integer.parseInt(params.get("pageSize").toString());
        }
        if (params.get("keyword") != null) {
            keyword = params.get("keyword").toString().trim();
            if (keyword.isEmpty()) {
                keyword = null;
            }
        }
        if (params.get("status") != null) {
            status = params.get("status").toString().trim();
            if (status.isEmpty()) {
                status = null;
            }
        }

        int offset = (pageIndex - 1) * pageSize;
        List<SsSandboxRecord> list = sandboxRecordMapper.selectByPage(keyword, status, offset, pageSize);
        // 动态端口的 openclaw 控制台外网不可达；配置了 WEB_BASE_URL 时改写为经网关整页代理的对外地址，
        // 未配置则保持原始 endpoint（原逻辑）。
        String webBaseUrl = byaiSystemConfigService.getDcSystemConfigValueByCode(Constants.WEB_BASE_URL);
        list.forEach(record -> {
            String rawEndpoint = SandboxEndpointRecordSupport.resolveInstanceEndpoint(record.getEndpoint(),
                SandboxEndpointRecordSupport.OPENCLAW_INSTANCE);
            if (StringUtils.isNotBlank(webBaseUrl)) {
                record.setEndpoint(OpenClawUiProxyPaths.toProxyUrl(rawEndpoint, webBaseUrl, contextPath));
            } else {
                record.setEndpoint(rawEndpoint);
            }
        });
        int total = sandboxRecordMapper.countByCondition(keyword, status);
        int totalPage = (total + pageSize - 1) / pageSize;

        Map<String, Object> result = new HashMap<>();
        result.put("list", list);
        result.put("pageIndex", pageIndex);
        result.put("pageSize", pageSize);
        result.put("total", total);
        result.put("totalPage", totalPage);

        return ResponseUtil.successResponse(result);
    }

    /**
     * 根据ID释放沙箱（管理端）
     *
     * @param params 请求参数，需包含 id
     * @return ResponseUtil
     */
    @PostMapping("/removeSandboxById")
    @Operation(summary = "根据ID释放沙箱", description = "管理端根据沙箱记录ID释放沙箱")
    public ResponseUtil removeSandboxById(@RequestBody Map<String, Object> params) {
        Object idObj = params.get("id");
        if (idObj == null) {
            return ResponseUtil.fail("id is required");
        }

        Long id;
        try {
            id = Long.parseLong(idObj.toString());
        } catch (NumberFormatException e) {
            return ResponseUtil.fail("id must be a valid number");
        }

        sandboxService.removeSandboxById(id);
        return ResponseUtil.successResponse();
    }

    @PostMapping("/updateSandbox")
    @Operation(summary = "更新沙箱记录", description = "管理端更新沙箱记录，目前支持修改autoRelease字段")
    public ResponseUtil updateSandbox(@RequestBody Map<String, Object> params) {
        Object idObj = params.get("id");
        if (idObj == null) {
            return ResponseUtil.fail("id is required");
        }

        Long id;
        try {
            id = Long.parseLong(idObj.toString());
        } catch (NumberFormatException e) {
            return ResponseUtil.fail("id must be a valid number");
        }

        Object autoReleaseObj = params.get("autoRelease");
        if (autoReleaseObj == null) {
            return ResponseUtil.fail("autoRelease is required");
        }

        Integer autoRelease;
        try {
            autoRelease = Integer.parseInt(autoReleaseObj.toString());
        } catch (NumberFormatException e) {
            return ResponseUtil.fail("autoRelease must be a valid number");
        }

        sandboxService.updateSandboxById(id, autoRelease);
        return ResponseUtil.successResponse();
    }

    @PostMapping("/resize")
    @Operation(summary = "动态调整沙箱资源规格", description = "通过 OpenSandbox 执行沙箱扩缩容，并记录审计流水")
    public ResponseUtil resizeSandbox(@RequestBody Map<String, Object> params) {
        try {
            SsSandboxResizeRecord record = sandboxResizeService.handleResizeRequest(params);
            return ResponseUtil.successResponse(record);
        }
        catch (Exception e) {
            return ResponseUtil.fail("沙箱扩缩容处理失败: " + e.getMessage());
        }
    }

    @PostMapping("/autoscale/alerts")
    @Operation(summary = "Prometheus 沙箱扩缩容告警入口", description = "接收 Alertmanager webhook，生成动态扩缩容审计记录并按目标规格调用 OpenSandbox")
    public ResponseUtil handleAutoscaleAlert(@RequestBody Map<String, Object> payload) {
        try {
            SsSandboxResizeRecord record = sandboxResizeService.handlePrometheusAlert(payload);
            return ResponseUtil.successResponse(record);
        }
        catch (Exception e) {
            return ResponseUtil.fail("沙箱扩缩容告警处理失败: " + e.getMessage());
        }
    }

    @GetMapping(value = "/autoscale/boundary-blacklist/metrics", produces = MediaType.TEXT_PLAIN_VALUE)
    @Operation(summary = "Prometheus 沙箱扩缩容边界黑名单指标", description = "输出已达到最高/最低规格的运行中沙箱，用于 Prometheus 过滤无意义的同方向告警")
    public String getAutoscaleBoundaryBlacklistMetrics() {
        return sandboxResizeService.buildBoundaryBlacklistMetrics();
    }

    @PostMapping("/health/config/getGlobalSwitch")
    @Operation(summary = "查询沙箱健康检测全局开关", description = "查询硬开关和管理端运行期开关状态")
    public ResponseUtil getSandboxHealthGlobalSwitch() {
        return ResponseUtil.successResponse(sandboxHealthConfigService.getGlobalSwitch());
    }

    @PostMapping("/health/config/saveGlobalSwitch")
    @Operation(summary = "保存沙箱健康检测全局开关", description = "保存管理端运行期开关；硬开关仍由配置文件控制")
    public ResponseUtil saveSandboxHealthGlobalSwitch(@RequestBody Map<String, Object> params) {
        Object enabledObj = params.get("enabled");
        boolean enabled = enabledObj instanceof Boolean
            ? (Boolean) enabledObj
            : "true".equalsIgnoreCase(String.valueOf(enabledObj));
        sandboxHealthConfigService.saveGlobalSwitch(enabled);
        return ResponseUtil.successResponse(sandboxHealthConfigService.getGlobalSwitch());
    }

    @PostMapping("/health/watermark/list")
    @Operation(summary = "查询沙箱健康水位模型", description = "按服务类型、规格和启用状态查询水位模型")
    public ResponseUtil listSandboxHealthWatermarkModels(@RequestBody Map<String, Object> params) {
        String serviceType = stringParam(params.get("serviceType"));
        String profileKey = stringParam(params.get("profileKey"));
        Integer enabled = params.containsKey("enabled") && params.get("enabled") != null
            ? parseIntParam(params.get("enabled"), 0)
            : null;
        return ResponseUtil.successResponse(sandboxHealthWatermarkModelService.list(serviceType, profileKey, enabled));
    }

    @PostMapping("/health/watermark/save")
    @Operation(summary = "保存沙箱健康水位模型", description = "新增或更新沙箱健康水位模型")
    public ResponseUtil saveSandboxHealthWatermarkModel(@RequestBody Map<String, Object> params) {
        try {
            return ResponseUtil.successResponse(
                sandboxHealthWatermarkModelService.save(sandboxHealthWatermarkModelService.fromParams(params)));
        }
        catch (Exception e) {
            return ResponseUtil.fail(e.getMessage());
        }
    }

    @PostMapping("/health/watermark/delete")
    @Operation(summary = "删除沙箱健康水位模型", description = "物理删除指定水位模型")
    public ResponseUtil deleteSandboxHealthWatermarkModel(@RequestBody Map<String, Object> params) {
        Long id = parseLongParam(params.get("id"));
        if (id == null) {
            return ResponseUtil.fail("id is required");
        }
        sandboxHealthWatermarkModelService.delete(id);
        return ResponseUtil.successResponse();
    }

    @PostMapping("/health/watermark/enable")
    @Operation(summary = "启停沙箱健康水位模型", description = "启用或停用指定水位模型")
    public ResponseUtil enableSandboxHealthWatermarkModel(@RequestBody Map<String, Object> params) {
        Long id = parseLongParam(params.get("id"));
        if (id == null) {
            return ResponseUtil.fail("id is required");
        }
        Object enabledObj = params.get("enabled");
        boolean enabled = enabledObj instanceof Boolean
            ? (Boolean) enabledObj
            : "true".equalsIgnoreCase(String.valueOf(enabledObj)) || "1".equals(String.valueOf(enabledObj));
        try {
            sandboxHealthWatermarkModelService.enable(id, enabled);
            return ResponseUtil.successResponse();
        }
        catch (Exception e) {
            return ResponseUtil.fail(e.getMessage());
        }
    }

    @PostMapping("/health/watermark/preview")
    @Operation(summary = "预览沙箱健康水位判定", description = "输入 CPU/内存水位，按生效模型返回健康级别")
    public ResponseUtil previewSandboxHealthWatermark(@RequestBody Map<String, Object> params) {
        String serviceType = stringParam(params.get("serviceType"));
        String profileKey = stringParam(params.get("profileKey"));
        Double cpuRequestRatio = parseDoubleParam(params.get("cpuRequestRatio"));
        Double memoryLimitRatio = parseDoubleParam(params.get("memoryLimitRatio"));
        return ResponseUtil.successResponse(
            sandboxHealthWatermarkService.preview(serviceType, profileKey, cpuRequestRatio, memoryLimitRatio));
    }

    @PostMapping("/listResizeRecords")
    @Operation(summary = "查询沙箱扩缩容记录", description = "按沙箱记录ID、用户编码或 sandboxId 查询扩缩容审计流水")
    public ResponseUtil listResizeRecords(@RequestBody Map<String, Object> params) {
        Long sandboxRecordId = parseLongParam(params.get("sandboxRecordId"));
        if (sandboxRecordId == null) {
            sandboxRecordId = parseLongParam(params.get("recordId"));
        }
        String userCode = stringParam(params.get("userCode"));
        String sandboxId = stringParam(params.get("sandboxId"));
        int limit = parseIntParam(params.get("limit"), 50);
        limit = Math.max(1, Math.min(limit, 200));

        if (sandboxRecordId == null && StringUtils.isBlank(userCode) && StringUtils.isBlank(sandboxId)) {
            return ResponseUtil.fail("sandboxRecordId, userCode or sandboxId is required");
        }

        List<SsSandboxResizeRecord> list = sandboxResizeRecordMapper.selectByCondition(
            sandboxRecordId,
            userCode,
            sandboxId,
            limit
        );
        return ResponseUtil.successResponse(list);
    }

    @PostMapping("/listServiceProfiles")
    @Operation(summary = "查询沙箱规格分层", description = "查询同一沙箱类型下可用的资源规格分层")
    public ResponseUtil listServiceProfiles(@RequestBody Map<String, Object> params) {
        String serviceType = StringUtils.defaultIfBlank(stringParam(params.get("serviceType")),
            SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);
        boolean enabledOnly = !"false".equalsIgnoreCase(String.valueOf(params.getOrDefault("enabledOnly", "true")));
        List<SandboxServiceProfileEntity> list =
            sandboxServiceProfileEntityMapper.selectProfiles(serviceType, enabledOnly);
        return ResponseUtil.successResponse(list);
    }

    @PostMapping("/saveServiceProfile")
    @Operation(summary = "保存沙箱服务规格档位", description = "新增或更新同一沙箱服务类型下的规格档位配置")
    public ResponseUtil saveServiceProfile(@RequestBody Map<String, Object> params) {
        String serviceType = StringUtils.defaultIfBlank(stringParam(params.get("serviceType")),
            SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);
        String profileKey = stringParam(params.get("profileKey"));
        String resourceRequests = stringParam(params.get("resourceRequests"));
        String resourceLimits = stringParam(params.get("resourceLimits"));
        String templatePatchJson = stringParam(params.get("templatePatchJson"));
        String resizeStrategy = StringUtils.defaultIfBlank(stringParam(params.get("resizeStrategy")), "IN_PLACE");

        if (StringUtils.isBlank(profileKey)) {
            return ResponseUtil.fail("profileKey is required");
        }
        if (StringUtils.isBlank(resourceRequests)) {
            return ResponseUtil.fail("resourceRequests is required");
        }
        if (StringUtils.isBlank(resourceLimits)) {
            return ResponseUtil.fail("resourceLimits is required");
        }
        if (!isJsonObject(resourceRequests)) {
            return ResponseUtil.fail("resourceRequests must be a valid JSON object");
        }
        if (!isJsonObject(resourceLimits)) {
            return ResponseUtil.fail("resourceLimits must be a valid JSON object");
        }
        if (StringUtils.isNotBlank(templatePatchJson) && !isJsonObject(templatePatchJson)) {
            return ResponseUtil.fail("templatePatchJson must be a valid JSON object");
        }

        Long id = parseLongParam(params.get("id"));
        SandboxServiceProfileEntity entity = id == null
            ? sandboxServiceProfileEntityMapper.selectProfile(serviceType, profileKey)
            : sandboxServiceProfileEntityMapper.selectById(id);
        boolean creating = entity == null;
        if (creating) {
            entity = new SandboxServiceProfileEntity();
            entity.setServiceType(serviceType);
            entity.setProfileKey(profileKey);
        }
        entity.setResourceRequests(resourceRequests);
        entity.setResourceLimits(resourceLimits);
        entity.setTemplatePatchJson(templatePatchJson);
        entity.setResizeEnabled(parseIntParam(params.get("resizeEnabled"), 1));
        entity.setResizeStrategy(resizeStrategy);
        entity.setEnabled(parseIntParam(params.get("enabled"), 1));
        entity.setSortOrder(parseIntParam(params.get("sortOrder"), 0));

        if (creating) {
            sandboxServiceProfileEntityMapper.insertProfile(entity);
        }
        else {
            sandboxServiceProfileEntityMapper.updateProfile(entity);
        }
        return ResponseUtil.successResponse();
    }

    @PostMapping("/deleteServiceProfile")
    @Operation(summary = "禁用沙箱服务规格档位", description = "禁用指定规格档位，避免影响历史扩缩容记录")
    public ResponseUtil deleteServiceProfile(@RequestBody Map<String, Object> params) {
        Long id = parseLongParam(params.get("id"));
        if (id == null) {
            String serviceType = StringUtils.defaultIfBlank(stringParam(params.get("serviceType")),
                SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);
            String profileKey = stringParam(params.get("profileKey"));
            if (StringUtils.isBlank(profileKey)) {
                return ResponseUtil.fail("id or profileKey is required");
            }
            SandboxServiceProfileEntity entity =
                sandboxServiceProfileEntityMapper.selectProfile(serviceType, profileKey);
            if (entity != null) {
                id = entity.getId();
            }
        }
        if (id == null) {
            return ResponseUtil.fail("Service profile not found");
        }
        sandboxServiceProfileEntityMapper.disableProfile(id);
        return ResponseUtil.successResponse();
    }

    // ==================== 沙箱服务规格配置管理接口 ====================

    /**
     * 查询沙箱服务规格配置列表
     *
     * @return ResponseUtil
     */
    @PostMapping("/listServiceSpec")
    @Operation(summary = "查询沙箱服务规格配置列表", description = "查询所有沙箱服务规格配置")
    public ResponseUtil listServiceSpec() {
        List<SandboxServiceSpecEntity> list = sandboxServiceSpecEntityMapper.selectList(null);
        List<Map<String, String>> result = list.stream().map(entity -> {
            Map<String, String> map = new HashMap<>();
            map.put("serviceKey", entity.getServiceKey());
            map.put("serviceType", entity.getServiceType());
            map.put("displayName", entity.getDisplayName());
            map.put("enabled", entity.getEnabled() == null ? null : String.valueOf(entity.getEnabled()));
            map.put("defaultProfileKey", entity.getDefaultProfileKey());
            map.put("autoscaleEnabled", entity.getAutoscaleEnabled() == null ? null : String.valueOf(entity.getAutoscaleEnabled()));
            map.put("specJson", entity.getSpecJson());
            map.put("templateJson", entity.getTemplateJson());
            return map;
        }).collect(Collectors.toList());
        return ResponseUtil.successResponse(result);
    }

    /**
     * 根据 serviceKey 查询沙箱服务规格配置
     *
     * @param params 请求参数，需包含 serviceKey
     * @return ResponseUtil
     */
    @PostMapping("/getServiceSpec")
    @Operation(summary = "查询沙箱服务规格配置", description = "根据 serviceKey 查询沙箱服务规格配置")
    public ResponseUtil getServiceSpec(@RequestBody Map<String, Object> params) {
        String serviceKey = (String) params.get("serviceKey");
        if (serviceKey == null || serviceKey.trim().isEmpty()) {
            return ResponseUtil.fail("serviceKey is required");
        }

        SandboxServiceSpecEntity entity = sandboxServiceSpecEntityMapper.selectById(serviceKey);
        if (entity == null) {
            return ResponseUtil.fail("Service spec not found");
        }

        Map<String, String> result = new HashMap<>();
        result.put("serviceKey", entity.getServiceKey());
        result.put("serviceType", entity.getServiceType());
        result.put("displayName", entity.getDisplayName());
        result.put("enabled", entity.getEnabled() == null ? null : String.valueOf(entity.getEnabled()));
        result.put("defaultProfileKey", entity.getDefaultProfileKey());
        result.put("autoscaleEnabled", entity.getAutoscaleEnabled() == null ? null : String.valueOf(entity.getAutoscaleEnabled()));
        result.put("specJson", entity.getSpecJson());
        result.put("templateJson", entity.getTemplateJson());
        return ResponseUtil.successResponse(result);
    }

    /**
     * 保存或更新沙箱服务规格配置
     *
     * @param params 请求参数，需包含 serviceKey、specJson
     * @return ResponseUtil
     */
    @PostMapping("/saveServiceSpec")
    @Operation(summary = "保存或更新沙箱服务规格配置", description = "保存或更新沙箱服务规格配置，serviceKey 不存在则新增，存在则更新")
    public ResponseUtil saveServiceSpec(@RequestBody Map<String, Object> params) {
        String serviceKey = (String) params.get("serviceKey");
        String specJson = (String) params.get("specJson");
        String templateJson = (String) params.get("templateJson");

        if (serviceKey == null || serviceKey.trim().isEmpty()) {
            return ResponseUtil.fail("serviceKey is required");
        }
        if (specJson == null || specJson.trim().isEmpty()) {
            return ResponseUtil.fail("specJson is required");
        }

        String serviceKeyTrimmed = serviceKey.trim();
        String specJsonTrimmed = specJson.trim();
        String templateJsonTrimmed = (templateJson != null && !templateJson.trim().isEmpty()) ? templateJson.trim() : null;

        // 检查是否已存在
        SandboxServiceSpecEntity existing = sandboxServiceSpecEntityMapper.selectById(serviceKeyTrimmed);
        if (existing == null) {
            // 新增 - 使用自定义 SQL 处理 jsonb 类型
            sandboxServiceSpecEntityMapper.insertSpec(serviceKeyTrimmed, specJsonTrimmed, templateJsonTrimmed);
        } else {
            // 更新 - 使用自定义 SQL 处理 jsonb 类型
            sandboxServiceSpecEntityMapper.updateSpec(serviceKeyTrimmed, specJsonTrimmed, templateJsonTrimmed);
        }

        return ResponseUtil.successResponse();
    }

    /**
     * 删除沙箱服务规格配置
     *
     * @param params 请求参数，需包含 serviceKey
     * @return ResponseUtil
     */
    @PostMapping("/deleteServiceSpec")
    @Operation(summary = "删除沙箱服务规格配置", description = "根据 serviceKey 删除沙箱服务规格配置")
    public ResponseUtil deleteServiceSpec(@RequestBody Map<String, Object> params) {
        String serviceKey = (String) params.get("serviceKey");
        if (serviceKey == null || serviceKey.trim().isEmpty()) {
            return ResponseUtil.fail("serviceKey is required");
        }

        sandboxServiceSpecEntityMapper.deleteById(serviceKey.trim());
        return ResponseUtil.successResponse();
    }

    /**
     * 查询用户首选 serviceKey
     *
     * @param userCode 用户工号
     * @return 首选 serviceKey，未配置时 data 为 null
     */
    @GetMapping("/preferredServiceKey")
    @Operation(summary = "查询用户首选沙箱 serviceKey", description = "查询 Redis 中缓存的用户首选沙箱 serviceKey")
    public ResponseUtil getPreferredServiceKey(@RequestParam("userCode") String userCode) {
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("userCode is required");
        }
        String serviceKey = sandboxService.getPreferredServiceKey(userCode.trim());
        return ResponseUtil.successResponse(serviceKey);
    }

    /**
     * 清除用户首选 serviceKey
     *
     * @param params 请求参数，包含 userCode
     * @return ResponseUtil
     */
    @PostMapping("/removePreferredServiceKey")
    @Operation(summary = "清除用户首选沙箱 serviceKey", description = "清除 Redis 中缓存的用户首选沙箱 serviceKey，后续将使用默认类型")
    public ResponseUtil removePreferredServiceKey(@RequestBody Map<String, Object> params) {
        Object userCodeObj = params.get("userCode");
        if (userCodeObj == null || userCodeObj.toString().trim().isEmpty()) {
            return ResponseUtil.fail("userCode is required");
        }
        sandboxService.removePreferredServiceKey(userCodeObj.toString().trim());
        return ResponseUtil.successResponse();
    }

    private String stringParam(Object value) {
        if (value == null) {
            return null;
        }
        String str = value.toString().trim();
        return str.isEmpty() ? null : str;
    }

    private Long parseLongParam(Object value) {
        if (value == null || value.toString().trim().isEmpty()) {
            return null;
        }
        try {
            return Long.parseLong(value.toString().trim());
        }
        catch (NumberFormatException e) {
            return null;
        }
    }

    private int parseIntParam(Object value, int defaultValue) {
        if (value == null || value.toString().trim().isEmpty()) {
            return defaultValue;
        }
        try {
            return Integer.parseInt(value.toString().trim());
        }
        catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    private Double parseDoubleParam(Object value) {
        if (value == null || value.toString().trim().isEmpty()) {
            return null;
        }
        try {
            return Double.parseDouble(value.toString().trim());
        }
        catch (NumberFormatException e) {
            return null;
        }
    }

    private boolean isJsonObject(String value) {
        try {
            Object parsed = objectMapper.readValue(value, Object.class);
            return parsed instanceof Map;
        }
        catch (Exception e) {
            return false;
        }
    }
}
