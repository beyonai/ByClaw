package com.iwhalecloud.byai.gateway.sandbox.controller;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
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

    @Autowired
    private SandboxService sandboxService;

    @Autowired
    private SsSandboxRecordMapper sandboxRecordMapper;

    @Autowired
    private SandboxServiceSpecEntityMapper sandboxServiceSpecEntityMapper;

    /**
     * 沙箱心跳接口
     * 前端定期轮询调用，更新沙箱最后访问时间，防止沙箱因空闲超时被自动回收
     *
     * @param params 请求参数，需包含 resourceId
     * @return ResponseUtil
     */
    @PostMapping("/heartbeat")
    @Operation(summary = "沙箱心跳", description = "前端定期调用此接口，传入resourceId以保持沙箱活跃，防止空闲超时自动回收")
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
                Map<String, Object> result = new HashMap<>();
                result.put("userCode", userCode);
                result.put("sandboxType", sandbox.getSandboxType());
                result.put("sandboxId", sandbox.getSandboxId());
                result.put("endpoints", sandbox.getEndpoints());
                result.put("token", sandbox.getGatewayToken());
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
}
