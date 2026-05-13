package com.iwhalecloud.byai.manager.interfaces.controller.auth;

import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import com.iwhalecloud.byai.manager.domain.auth.service.ResourcePermissionScopeService;
import com.iwhalecloud.byai.manager.dto.resource.PermissionDto;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;

/**
 * 资源权限范围分析应用服务
 */
@RestController
@RequestMapping("/api/v1/auth/permission-scope")
@Api(tags = "资源权限范围分析")
public class ResourcePermissionScopeController {

    @Autowired
    private ResourcePermissionScopeService permissionScopeService;

    /**
     * 分析单个资源的权限范围
     *
     * @param resourceId 资源ID
     * @param resourceType 资源类型
     * @return 权限范围分析结果
     */
    @GetMapping("/analyze")
    @ApiOperation("分析单个资源的权限范围")
    public ResponseUtil analyzePermissionScope(@ApiParam("资源ID") @RequestParam Long resourceId,
        @ApiParam("资源类型") @RequestParam String resourceType) {

        ResourcePermissionScopeService.PermissionScopeResult result = permissionScopeService
            .analyzePermissionScope(resourceId, resourceType);

        return ResponseUtil.successResponse("权限范围分析完成", result);
    }

    /**
     * 批量分析多个资源的权限范围
     * 
     * @return 权限范围分析结果映射
     */
    @PostMapping("/analyze-batch")
    @ApiOperation("批量分析多个资源的权限范围")
    public ResponseUtil analyzePermissionScopeBatch(@ApiParam("资源ID列表") @RequestBody PermissionDto permissionDto) {

        Map<Long, ResourcePermissionScopeService.PermissionScopeResult> results = permissionScopeService
            .analyzePermissionScopeBatch(permissionDto);

        return ResponseUtil.successResponse("批量权限范围分析完成", results);
    }

    /**
     * 检查用户对指定资源的权限
     *
     * @param userId 用户ID
     * @param resourceId 资源ID
     * @param resourceType 资源类型
     * @return 是否有权限
     */
    @GetMapping("/check-permission")
    @ApiOperation("检查用户对指定资源的权限")
    public ResponseUtil checkUserPermission(@ApiParam("用户ID") @RequestParam Long userId,
        @ApiParam("资源ID") @RequestParam Long resourceId, @ApiParam("资源类型") @RequestParam String resourceType) {

        boolean hasPermission = permissionScopeService.hasUserPermission(userId, resourceId, resourceType);

        return ResponseUtil.successResponse("权限检查完成", hasPermission);
    }

    @GetMapping("/analyze-code")
    @ApiOperation("分析单个资源的权限范围（返回数字代码）")
    public ResponseUtil analyzePermissionScopeCode(@ApiParam("资源ID") @RequestParam Long resourceId,
        @ApiParam("资源类型") @RequestParam String resourceType) {
        int code = permissionScopeService.analyzePermissionScopeCode(resourceId, resourceType);
        return ResponseUtil.successResponse("权限范围代码分析完成", code);
    }

    @PostMapping("/analyze-batch-codes")
    @ApiOperation("批量分析多个资源的权限范围（返回数字代码Map）")
    public ResponseUtil analyzePermissionScopeBatchCodes(@ApiParam("资源ID列表") @RequestBody PermissionDto permissionDto) {
        Map<Long, Integer> results = permissionScopeService.analyzePermissionScopeBatchCodes(permissionDto);
        return ResponseUtil.successResponse("批量权限范围代码分析完成", results);
    }
}