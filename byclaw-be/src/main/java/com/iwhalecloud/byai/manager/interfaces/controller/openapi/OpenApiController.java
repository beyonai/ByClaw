package com.iwhalecloud.byai.manager.interfaces.controller.openapi;

import com.iwhalecloud.byai.common.feign.client.FeignDataCloudService;
import com.iwhalecloud.byai.common.feign.request.datacloud.InvokeActionReq;
import com.iwhalecloud.byai.common.feign.response.DataCloudResponse;
import com.iwhalecloud.byai.common.feign.response.datacloud.InvokeActionResp;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.application.service.openapi.OpenApiApplicationService;
import com.iwhalecloud.byai.manager.application.service.ontology.OntologyResourceSyncApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.OntologyOpenService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceCatalogService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeIdDTO;
import com.iwhalecloud.byai.manager.dto.men.Notices;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyActionSaveRequest;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.manager.dto.openapi.MountResourceDto;
import com.iwhalecloud.byai.manager.dto.openapi.OntologyResourceDeleteRequest;
import com.iwhalecloud.byai.manager.dto.openapi.OntologyResourceSyncRequest;
import com.iwhalecloud.byai.manager.dto.openapi.OntologyResourceSyncResultDto;
import com.iwhalecloud.byai.manager.dto.openapi.OpenPermissionCheckDto;
import com.iwhalecloud.byai.manager.dto.openapi.OpenPermissionCheckResultDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.organization.CatalogQo;
import jakarta.validation.Valid;

import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * @author he.duming
 * @date 2025-05-26 09:54:45
 * @description 系统内接口对外统一处理
 */
@RestController
@RequestMapping("/open/api")
public class OpenApiController {

    @Autowired
    private OntologyOpenService ontologyOpenService;

    @Autowired
    private OpenApiApplicationService openApiApplicationService;

    @Autowired
    private OntologyResourceSyncApplicationService ontologyResourceSyncApplicationService;

    @Autowired
    private SsResourceCatalogService ssResourceCatalogService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    @Autowired
    private FeignDataCloudService feignDataCloudService;

    /**
     * 保存对象的动作相关内容 包括：动作和动作属性
     *
     * @param request 动作保存请求
     * @return ResponseUtil
     */
    @PostMapping("/createOrUpdateOntology")
    @ManageLogAnnotation(name = "保存对象动作", description = "保存对象的动作相关内容，包括动作和动作属性")
    public ResponseUtil<Map<String, Object>> saveBatchOpen(@Valid @RequestBody OntologyActionSaveRequest request) {
        return ResponseUtil.successRes(ontologyOpenService.saveBatchOpen(request));
    }

    /**
     * 创建通知
     *
     * @param notices 通知
     * @return ResponseUtil
     */
    @PostMapping("/notice/create")
    @ManageLogAnnotation(name = "会话API调用", description = "创建通知")
    public ResponseUtil<String> createNotice(@RequestBody @Valid Notices notices) {
        openApiApplicationService.createNotice(notices);
        return ResponseUtil.successRes(ResponseUtil.RESULTMSG_MSG);
    }

    /**
     * 查询挂载目录
     *
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "查询挂载目录")
    @PostMapping("/v1/queryCatalogTree")
    public ResponseUtil<List<SsResourceCatalog>> queryCatalogTree(@RequestBody @Validated CatalogQo catalogQo) {
        // 只查询领域的目录
        catalogQo.setCatalogType(6);
        List<SsResourceCatalog> catalogs = ssResourceCatalogService.queryCatalogTree(catalogQo);
        return ResponseUtil.successResponse(catalogs);
    }

    /**
     * 批量查询当前登录用户是否有指定数字员工的管理权限。
     *
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "批量查询数字员工管理权限")
    @PostMapping("/v1/checkDigEmployeeManagePermission")
    public ResponseUtil<OpenPermissionCheckResultDto> checkDigEmployeeManagePermission(
        @RequestBody OpenPermissionCheckDto checkDto) {
        return ResponseUtil.successResponse(openApiApplicationService.checkDigEmployeeManagePermission(checkDto));
    }

    /**
     * 批量查询当前登录用户是否有指定资源的使用权限。
     *
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "批量查询资源使用权限")
    @PostMapping("/v1/checkResourceUsePermission")
    public ResponseUtil<OpenPermissionCheckResultDto> checkResourceUsePermission(
        @RequestBody OpenPermissionCheckDto checkDto) {
        return ResponseUtil.successResponse(openApiApplicationService.checkResourceUsePermission(checkDto));
    }

    /**
     * datacloud 主动新增本体资源索引。
     *
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "datacloud新增本体资源索引")
    @PostMapping("/v1/ontology/resource/create")
    public ResponseUtil<OntologyResourceSyncResultDto> createOntologyResource(
        @RequestBody @Valid OntologyResourceSyncRequest request) {
        return ResponseUtil.successResponse(ontologyResourceSyncApplicationService.createOntologyResource(request));
    }

    /**
     * datacloud 主动更新本体资源索引。
     *
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "datacloud更新本体资源索引")
    @PostMapping("/v1/ontology/resource/update")
    public ResponseUtil<OntologyResourceSyncResultDto> updateOntologyResource(
        @RequestBody @Valid OntologyResourceSyncRequest request) {
        return ResponseUtil.successResponse(ontologyResourceSyncApplicationService.updateOntologyResource(request));
    }

    /**
     * datacloud 主动删除本体资源索引。
     *
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "datacloud删除本体资源索引")
    @PostMapping("/v1/ontology/resource/delete")
    public ResponseUtil<OntologyResourceSyncResultDto> deleteOntologyResource(
        @RequestBody @Valid OntologyResourceDeleteRequest request) {
        return ResponseUtil.successResponse(ontologyResourceSyncApplicationService.deleteOntologyResource(request));
    }

    /**
     * 挂载数字员工资源
     *
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "挂载数字员工资源")
    @PostMapping("/v1/mountDigEmployeeResource")
    public ResponseUtil<String> mountDigEmployeeResource(@RequestBody MountResourceDto mountResourceDto) {

        openApiApplicationService.mountDigEmployeeResource(mountResourceDto);

        return ResponseUtil.successResponse();
    }

    /**
     * 取消挂载数字员工资源
     *
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "取消挂载数字员工资源")
    @PostMapping("/v1/unMountDigEmployeeResource")
    public ResponseUtil<String> unMountDigEmployeeResource(@RequestBody MountResourceDto mountResourceDto) {

        openApiApplicationService.unMountDigEmployeeResource(mountResourceDto);

        Long agentId = mountResourceDto.getAgentId();

        EmployeeIdDTO employeeIdDTO = new EmployeeIdDTO();
        employeeIdDTO.setResourceId(agentId);
        DigitalEmployeeDetailsDTO digitalEmployeeDTO = digitalEmployeeApplicationService.findDetailsById(employeeIdDTO);

        // 同步openClaw工作空间：透传原始入参，relTools / relPrompt 等不入 DB 的运行期字段需要从入参直接进 JSON。
        digitalEmployeeApplicationService.synOpenClawWorkSpace(agentId, digitalEmployeeDTO);

        return ResponseUtil.successResponse();
    }

    /**
     * 调用知识库动作
     *
     * @param invokeActionReq 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "调用知识库动作")
    @PostMapping("/v1/invokeAction")
    public ResponseUtil<InvokeActionResp> invokeAction(@RequestBody InvokeActionReq invokeActionReq) {
        DataCloudResponse<InvokeActionResp> invokeActionResp = feignDataCloudService.invokeAction(invokeActionReq);
        return ResponseUtil.successResponse(invokeActionResp.getData());
    }

}
