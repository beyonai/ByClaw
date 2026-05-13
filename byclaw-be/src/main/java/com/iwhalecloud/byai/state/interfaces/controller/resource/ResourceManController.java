package com.iwhalecloud.byai.state.interfaces.controller.resource;

import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceCatalogService;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.organization.CatalogQo;
import com.iwhalecloud.byai.state.domain.resource.qo.ResourceDetailQo;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceApplicationService;
import com.iwhalecloud.byai.state.domain.resource.vo.ResourceDetailVo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;

@RestController
@RequestMapping("/resource")
@Tag(name = "资源管理", description = "提供资源管理、文件上传下载、数据集管理等功能")
public class ResourceManController {

    @Autowired
    private ResourceApplicationService resourceApplicationService;

    @Autowired
    private SsResourceCatalogService ssResourceCatalogService;

    /**
     * 查询资源详情 插件详情、文档库详情
     *
     * @param resourceDetailQo 资源列表
     * @return ResponseUtil
     */
    @PostMapping("/queryResourceDetail")
    @Operation(summary = "查询资源详情", description = "查询插件详情、文档库详情等资源信息", tags = "资源管理")
    public ResponseUtil<ResourceDetailVo> queryResourceDetail(@RequestBody ResourceDetailQo resourceDetailQo) {
        ResourceDetailVo resourceDetailVo = resourceApplicationService.queryResourceDetail(resourceDetailQo);
        return ResponseUtil.success(resourceDetailVo);
    }

    /**
     * 查询当前用户有使用权限的知识库
     *
     * @return ResponseUtil
     */
    @RequestMapping(value = "/queryCatalogTree", method = RequestMethod.POST)
    @Operation(summary = "查询数字员工目录", description = "查询数字员工目录")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil queryCatalogTree(@RequestBody CatalogQo catalogQo) {
        List<SsResourceCatalog> ssResourceCatalogs = ssResourceCatalogService.queryCatalogTree(catalogQo);
        return ResponseUtil.successResponse(ssResourceCatalogs);
    }

    /**
     * 获取任务文件列表
     *
     * @param request
     * @return ResponseUtil
     */
    @PostMapping("/getTaskFileList")
    @Operation(summary = "获取任务文件列表", description = "根据标签获取智能体、数字员工、群会话等标签下的文件清单", tags = "文件管理")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "获取任务文件列表成功"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil getTaskFileList(@RequestBody Map<String, Object> request) {
        String sessionId = request.get("sessionId").toString();
        String taskId = request.get("taskId") == null ? "" : request.get("taskId").toString();
        String matchMode = request.get("matchMode") == null ? "all" : request.get("matchMode").toString();
        String fileName = request.get("fileName") == null ? "" : request.get("fileName").toString();

        return resourceApplicationService.searchFilesByTags(sessionId, taskId, matchMode, fileName);
    }

}
