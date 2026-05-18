package com.iwhalecloud.byai.state.interfaces.controller.resource;

import com.iwhalecloud.byai.manager.dto.resource.CallMcpParamsDto;
import com.iwhalecloud.byai.manager.dto.resource.ResourceIdDto;
import com.iwhalecloud.byai.state.domain.chat.dto.UserSpaceDto;
import com.iwhalecloud.byai.state.domain.chat.vo.UserSpaceVo;
import com.iwhalecloud.byai.state.domain.resource.service.SsResExtMcpService;
import io.modelcontextprotocol.spec.McpSchema;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.session.ByClawFileQueryApplicationService;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillDownloadApplicationService;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillQueryApplicationService;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillUploadApplicationService;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawFileDto;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawSkillDto;
import com.iwhalecloud.byai.state.domain.session.qo.QryByClawFileByUserCodeQo;
import com.iwhalecloud.byai.state.domain.session.qo.QrySkillListByUserCodeQo;
import com.iwhalecloud.byai.state.domain.resource.dto.CurlImportRequest;
import com.iwhalecloud.byai.state.domain.resource.dto.CurlParseResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ObjectZipImportResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlGenerateRequest;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlGenerateResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlRunRequest;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlRunResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ToolSaveRequest;
import com.iwhalecloud.byai.state.domain.resource.qo.DeleteResourceQo;
import com.iwhalecloud.byai.state.domain.resource.qo.DownloadSkillZipQo;
import com.iwhalecloud.byai.state.domain.resource.qo.ResourceDetailQo;
import com.iwhalecloud.byai.state.domain.resource.qo.UpdateResourceBasicInfoQo;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceApplicationService;
import com.iwhalecloud.byai.state.domain.resource.service.ToolManService;
import com.iwhalecloud.byai.state.domain.resource.vo.ResourceDetailVo;
import io.swagger.v3.oas.annotations.Parameter;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import org.springframework.web.util.UriUtils;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/tool")
public class ToolManController {

    private static final Logger logger = LoggerFactory.getLogger(ToolManController.class);

    @Autowired
    private ToolManService toolManService;

    @Autowired
    private SsResExtMcpService ssResExtMcpService;

    @Autowired
    private ResourceApplicationService resourceApplicationService;

    @Autowired
    private ByClawFileQueryApplicationService byClawFileQueryApplicationService;

    @Autowired
    private ByClawSkillQueryApplicationService byClawSkillQueryApplicationService;

    @Autowired
    private ByClawSkillUploadApplicationService byClawSkillUploadApplicationService;

    @Autowired
    private ByClawSkillDownloadApplicationService byClawSkillDownloadApplicationService;

    /**
     * 阶段一：解析 curl，返回结构化预览（不入库）
     */
    @PostMapping("/parseCurl")
    public ResponseUtil<CurlParseResult> parseCurl(@RequestBody CurlImportRequest request) {
        CurlParseResult result = toolManService.parseCurl(request.getCurl());
        return ResponseUtil.successResponse(I18nUtil.get("tool.curl.parse.success"), result);
    }

    /**
     * 根据资源 sourceContent 生成可测试的 curl 脚本，优先规则解析，失败后走大模型兜底。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    @PostMapping("/generateResourceCurl")
    public ResponseUtil<ResourceCurlGenerateResult> generateResourceCurl(
        @RequestBody ResourceCurlGenerateRequest request) {
        try {
            ResourceCurlGenerateResult result = toolManService.generateResourceCurl(request);
            return ResponseUtil.successResponse("curl脚本生成成功", result);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("generateResourceCurl failed", e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage() : "curl脚本生成失败");
        }
    }

    /**
     * 运行资源测试 curl。后端只解析 curl 并发起 HTTP 请求，不执行系统 shell。
     *
     * @author qin.guoquan
     * @date 2026-05-08 00:00:00
     */
    @PostMapping("/runResourceCurl")
    public ResponseUtil<ResourceCurlRunResult> runResourceCurl(@RequestBody ResourceCurlRunRequest request) {
        try {
            ResourceCurlRunResult result = toolManService.runResourceCurl(request);
            return ResponseUtil.successResponse("curl运行完成", result);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("runResourceCurl failed", e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage() : "curl运行失败");
        }
    }

    /**
     * 阶段二：用户补全描述后保存入库
     */
    @PostMapping("/saveTool")
    public ResponseUtil<Void> saveTool(@RequestBody ToolSaveRequest request) {
        toolManService.saveTool(request);
        return ResponseUtil.success(I18nUtil.get("tool.save.success"));
    }

    /**
     * 工具超市：上传 TOOLKIT / MCP / AGENT JSON，按 resourceCode 幂等写入主表与对应扩展表。
     */
    @PostMapping("/importToolJson")
    public ResponseUtil<Map<String, Object>> importToolJson(
        @Parameter(description = "资源 JSON 文件", required = true) @RequestParam("file") MultipartFile file,
        @Parameter(description = "所属目录 ID，可选") @RequestParam(value = "catalogId", required = false) Long catalogId,
        @Parameter(description = "资源归属类型：enterprise-企业，personal-个人",
            required = false) @RequestParam(value = "ownerType", required = false) String ownerType) {
        try {
            // 新入口只负责接收上传文件和目录/归属参数，
            // 具体的 JSON 校验、主表新增或更新、子表落库、FTP 同步，都统一下沉到 service。
            Map<String, Object> data = toolManService.importToolJsonNewFromMultipart(file, catalogId, ownerType);
            return ResponseUtil.successResponse(I18nUtil.get("tool.resource.import.success"), data);
        }
        catch (IllegalArgumentException e) {
            // 参数缺失、JSON结构不合法、resourceBizType 不支持等可预期错误，
            // 直接把可读提示返回给前端，方便联调定位。
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            // 登录态失效、业务态校验失败等运行时异常，按业务失败返回。
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("importToolJson failed", e);
            // 兜底保护，避免底层实现异常直接暴露给前端。
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("tool.resource.import.failed"));
        }
    }

    /**
     * 工具超市：接收第三方直接传来的 JSON 全量内容，转内存文件后复用导入主流程。 仅用于已登录场景，catalogId 从 JSON 顶层读取，缺省时默认 0。
     *
     * @author qin.guoquan
     * @date 2026-04-23 18:17:00
     */
    @PostMapping(value = "/addToolFromThird", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseUtil<Map<String, Object>> addToolFromThird(@RequestBody String jsonContent) {
        try {
            Map<String, Object> data = toolManService.addToolFromThird(jsonContent);
            return ResponseUtil.successResponse(I18nUtil.get("tool.resource.import.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("addToolFromThird failed", e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("tool.resource.import.failed"));
        }
    }

    /**
     * 对象超市：上传对象压缩包，批量导入对象资源。
     */
    @PostMapping("/importObjectZip")
    public ResponseUtil<ObjectZipImportResult> importObjectZip(
        @Parameter(description = "对象 zip 文件", required = true) @RequestParam("file") MultipartFile file,
        @Parameter(description = "所属目录 ID，可选") @RequestParam(value = "catalogId", required = false) Long catalogId,
        @Parameter(description = "资源归属类型：enterprise-企业，personal-个人",
            required = false) @RequestParam(value = "ownerType", required = false) String ownerType) {
        try {
            // 核心流程统一下沉到 service：
            // 1. zip 落盘并解压；
            // 2. 解析 ontology/objects 下的对象 owl；
            // 3. 写主表 / 对象子表；
            // 4. 同步对象 json 与批次 zip 到 FTP。
            ObjectZipImportResult data = toolManService.importObjectZipFromMultipart(file, catalogId, ownerType);
            return ResponseUtil.successResponse(I18nUtil.get("tool.object.zip.import.success"), data);
        }
        catch (IllegalArgumentException e) {
            // 参数、目录结构、文件内容等校验失败，直接返回可读提示给前端。
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            // 登录态、业务态等运行时异常，按业务失败返回。
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("importObjectZip failed", e);
            // 兜底保护，避免实现细节异常直接暴露给前端。
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("tool.object.zip.import.failed"));
        }
    }

    /**
     * 视图超市：上传视图压缩包，批量导入视图资源。
     */
    @PostMapping("/importViewZip")
    public ResponseUtil<ObjectZipImportResult> importViewZip(
        @Parameter(description = "视图 zip 文件", required = true) @RequestParam("file") MultipartFile file,
        @Parameter(description = "所属目录 ID，可选") @RequestParam(value = "catalogId", required = false) Long catalogId,
        @Parameter(description = "资源归属类型：enterprise-企业，personal-个人",
            required = false) @RequestParam(value = "ownerType", required = false) String ownerType) {
        try {
            // 核心流程统一下沉到 service：
            // 1. zip 落盘并解压；
            // 2. 解析 ontology/views 下的视图 owl；
            // 3. 写主表 / 视图子表 / 视图与对象关系；
            // 4. 同步视图 json 与批次 zip 到 FTP。
            ObjectZipImportResult data = toolManService.importViewZipFromMultipart(file, catalogId, ownerType);
            return ResponseUtil.successResponse(I18nUtil.get("tool.view.zip.import.success"), data);
        }
        catch (IllegalArgumentException e) {
            // 参数、目录结构、object_codes 格式等校验失败，直接返回可读提示给前端。
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            // 登录态、业务态等运行时异常，按业务失败返回。
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("importViewZip failed", e);
            // 兜底保护，避免实现细节异常直接暴露给前端。
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("tool.view.zip.import.failed"));
        }
    }

    /**
     * 删除资源（支持 tool、skill、kg_doc、object、view）
     */
    @PostMapping("/deleteResource")
    public ResponseUtil<Void> deleteResource(
        @Parameter(description = "资源ID", required = true) @RequestParam("resourceId") Long resourceId) {
        try {
            toolManService.deleteManagedResource(resourceId);
            return ResponseUtil.success(I18nUtil.get("tool.resource.delete.success"));
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("deleteResource failed", e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("tool.resource.delete.failed"));
        }
    }

    /**
     * 删除资源。forceDelete=true 时跳过删除校验，直接删除主表、子表和资源关系。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:45:00
     */
    @PostMapping("/deleteResourceById")
    public ResponseUtil<Void> deleteResourceById(@RequestBody(required = false) DeleteResourceQo request,
        @Parameter(description = "资源ID", required = false) @RequestParam(value = "resourceId",
            required = false) Long resourceId,
        @Parameter(description = "是否强行删除", required = false) @RequestParam(value = "forceDelete",
            required = false) Boolean forceDelete) {
        try {
            Long finalResourceId = request != null && request.getResourceId() != null ? request.getResourceId()
                : resourceId;
            Boolean finalForceDelete = request != null && request.getForceDelete() != null ? request.getForceDelete()
                : forceDelete;
            toolManService.deleteManagedResource(finalResourceId, Boolean.TRUE.equals(finalForceDelete));
            return ResponseUtil.success(I18nUtil.get("tool.resource.delete.success"));
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(resolveResourceNotFoundMessage(e));
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("deleteResourceById failed", e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("tool.resource.delete.failed"));
        }
    }

    /**
     * 恢复资源。 将已注销（状态3）的资源恢复为已上架（状态2）。
     *
     * @author qin.guoquan
     * @date 2026-05-14
     */
    @PostMapping("/restoreResourceById")
    public ResponseUtil<Void> restoreResourceById(@RequestBody(required = false) DeleteResourceQo request,
        @Parameter(description = "资源ID", required = false) @RequestParam(value = "resourceId",
            required = false) Long resourceId,
        @Parameter(description = "是否强制恢复", required = false) @RequestParam(value = "forceRestore",
            required = false) Boolean forceRestore) {
        try {
            Long finalResourceId = request != null && request.getResourceId() != null ? request.getResourceId()
                : resourceId;
            Boolean finalForceRestore = request != null && request.getForceDelete() != null ? request.getForceDelete()
                : forceRestore;
            toolManService.restoreManagedResource(finalResourceId, Boolean.TRUE.equals(finalForceRestore));
            return ResponseUtil.success(I18nUtil.get("tool.resource.restore.success"));
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(resolveResourceNotFoundMessage(e));
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("restoreResourceById failed", e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("tool.resource.restore.failed"));
        }
    }

    /**
     * 硬删除资源及其所有关联关系与资源产物。
     */
    @PostMapping("/deleteResourceAndAllRel")
    public ResponseUtil<Void> deleteResourceAndAllRel(@RequestBody(required = false) DeleteResourceQo request,
        @Parameter(description = "资源ID", required = false) @RequestParam(value = "resourceId",
            required = false) Long resourceId) {
        try {
            Long finalResourceId = request != null && request.getResourceId() != null ? request.getResourceId()
                : resourceId;
            toolManService.deleteResourceAndAllRel(finalResourceId);
            return ResponseUtil.success(I18nUtil.get("tool.resource.delete.success"));
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(resolveResourceNotFoundMessage(e));
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("deleteResourceAndAllRel failed", e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("tool.resource.delete.failed"));
        }
    }

    /**
     * 查询资源详情，支持 GET query 参数与 POST body/query 参数。
     *
     * @author qin.guoquan
     * @date 2026-04-26 14:20:00
     */
    @RequestMapping(value = "/queryResourceDetail", method = {
        RequestMethod.GET, RequestMethod.POST
    })
    public ResponseUtil<ResourceDetailVo> queryResourceDetail(@RequestBody(required = false) ResourceDetailQo request,
        @Parameter(description = "资源ID", required = false) @RequestParam(value = "resourceId",
            required = false) Long resourceId) {
        try {
            Long finalResourceId = request != null && request.getResourceId() != null ? request.getResourceId()
                : resourceId;
            if (finalResourceId == null) {
                return ResponseUtil.fail(I18nUtil.get("resource.resourceid.notnull"));
            }
            ResourceDetailQo detailQo = new ResourceDetailQo();
            detailQo.setResourceId(finalResourceId);
            ResourceDetailVo resourceDetailVo = resourceApplicationService.queryResourceDetail(detailQo);
            if (resourceDetailVo == null) {
                return ResponseUtil.fail(I18nUtil.get("resource.notfound"));
            }
            return ResponseUtil.successResponse(I18nUtil.get("tool.resource.query.success"), resourceDetailVo);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(resolveResourceNotFoundMessage(e));
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("queryResourceDetail failed, resourceId={}",
                request != null && request.getResourceId() != null ? request.getResourceId() : resourceId, e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("tool.resource.query.detail.failed"));
        }
    }

    private String resolveResourceNotFoundMessage(IllegalArgumentException e) {
        if (e != null && ("资源不存在".equals(e.getMessage()) || I18nUtil.get("resource.notfound").equals(e.getMessage()))) {
            return I18nUtil.get("resource.notfound");
        }
        return e == null ? null : e.getMessage();
    }

    /**
     * 通用更新资源基础信息：更新资源名称、资源描述和所属目录。
     */
    @PostMapping("/updateResourceBasicInfo")
    public ResponseUtil<Void> updateResourceBasicInfo(@RequestBody(required = false) UpdateResourceBasicInfoQo request,
        @Parameter(description = "资源ID", required = false) @RequestParam(value = "resourceId",
            required = false) Long resourceId,
        @Parameter(description = "资源名称", required = false) @RequestParam(value = "resourceName",
            required = false) String resourceName,
        @Parameter(description = "资源描述", required = false) @RequestParam(value = "resourceDesc",
            required = false) String resourceDesc,
        @Parameter(description = "所属目录ID", required = false) @RequestParam(value = "catalogId",
            required = false) Long catalogId) {
        try {
            Long finalResourceId = request != null && request.getResourceId() != null ? request.getResourceId()
                : resourceId;
            String finalResourceName = request != null && request.getResourceName() != null ? request.getResourceName()
                : resourceName;
            String finalResourceDesc = request != null && request.getResourceDesc() != null ? request.getResourceDesc()
                : resourceDesc;
            Long finalCatalogId = request != null && request.getCatalogId() != null ? request.getCatalogId()
                : catalogId;

            if (finalResourceId == null) {
                return ResponseUtil.fail(I18nUtil.get("resource.resourceid.notnull"));
            }
            if (finalResourceName == null) {
                return ResponseUtil.fail(I18nUtil.get("resource.resourcename.notnull"));
            }
            toolManService.updateResourceBasicInfo(finalResourceId, finalResourceName, finalResourceDesc,
                finalCatalogId);
            return ResponseUtil.success(I18nUtil.get("tool.resource.basic.info.update.success"));
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("updateResourceBasicInfo failed", e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("tool.resource.basic.info.update.failed"));
        }
    }

    /**
     * 知识前端：按用户编码 + 当前对话 sessionId 查询其 byclaw 桶下当前会话目录的文件。 这里的 sessionId 明确指前端当前对话的会话 ID，例如 10014538， 不是登录态 HTTP
     * Session，也不是后端从上下文里反查出来的 session。
     */
    @PostMapping("/qryByClawFileByUserCode")
    public ResponseUtil<List<ByClawFileDto>> qryByClawFileByUserCode(@RequestBody QryByClawFileByUserCodeQo request) {
        try {
            String requestUserCode = request == null ? null : request.getUserCode();
            String resolvedUserCode = requestUserCode != null && !requestUserCode.trim().isEmpty() ? requestUserCode
                : CurrentUserHolder.getCurrentUserCode();
            List<ByClawFileDto> data = byClawFileQueryApplicationService.qryByClawFileByUserCode(resolvedUserCode,
                request == null ? null : request.getKeyword(), request == null ? null : request.getSessionId());
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.user.file.list.query.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("qryByClawFileByUserCode failed, userCode={}, keyword={}, sessionId={}",
                request == null ? null : request.getUserCode(), request == null ? null : request.getKeyword(),
                request == null ? null : request.getSessionId(), e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("byclaw.user.file.list.query.failed"));
        }
    }

    /**
     * 查询用户工作空间下 skills 目录的 skill 列表。 userCode 为空时回退到当前登录用户；仅支持 MinIO 存储模式。
     */
    @PostMapping("/qrySkillListByUserCode")
    public ResponseUtil<List<ByClawSkillDto>> qrySkillListByUserCode(@RequestBody QrySkillListByUserCodeQo request) {
        try {
            if (request == null || request.getResourceId() == null) {
                return ResponseUtil.fail(I18nUtil.get("resource.resourceid.notnull"));
            }
            String requestUserCode = request == null ? null : request.getUserCode();
            String resolvedUserCode = requestUserCode != null && !requestUserCode.trim().isEmpty() ? requestUserCode
                : CurrentUserHolder.getCurrentUserCode();
            List<ByClawSkillDto> data = byClawSkillQueryApplicationService.qrySkillListByUserCode(resolvedUserCode,
                request.getResourceId(), request == null ? null : request.getKeyword());
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.user.skill.list.query.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("qrySkillListByUserCode failed, userCode={}, resourceId={}, keyword={}",
                request == null ? null : request.getUserCode(), request == null ? null : request.getResourceId(),
                request == null ? null : request.getKeyword(), e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("byclaw.user.skill.list.query.failed"));
        }
    }

    /**
     * 上传 skill 压缩包到用户工作空间。 - 落盘 bucket: byclaw-{userCode}（与 qrySkillListByUserCode 同口径） - 落盘前缀:
     * /by/.openclaw/workspace/skills/{skillName}/... - zip 仅允许包含一个顶层目录，且必须含 SKILL.md；同名 skill 会先清空旧目录再写入。 - userCode
     * 留空时退回当前登录用户。
     */
    @PostMapping(value = "/uploadSkillZip", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseUtil<ByClawSkillDto> uploadSkillZip(
        @Parameter(description = "skill zip 文件", required = true) @RequestParam("file") MultipartFile file,
        @Parameter(description = "目标用户编码，可选；留空则使用当前登录用户") @RequestParam(value = "userCode",
            required = false) String userCode) {
        try {
            String resolvedUserCode = StringUtils.isNotBlank(userCode) ? userCode
                : CurrentUserHolder.getCurrentUserCode();
            ByClawSkillDto data = byClawSkillUploadApplicationService.uploadSkillZip(resolvedUserCode, file);
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.skill.upload.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("uploadSkillZip failed, userCode={}", userCode, e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("byclaw.skill.upload.failed"));
        }
    }

    /**
     * 下载 skill 目录为 zip。 - 入参 skillPath 必须落在 /.openclaw/workspace/skills/ 之下，且至少指向某一个具体 skill 目录。 - userCode
     * 留空时退回当前登录用户。 - 入参兼容 application/json body 与 query/form 两种形式：body 优先，缺失时退到 query 参数。 - 出参为 application/zip 流，文件名形如
     * {skillName}.zip。 - 失败场景（路径非法 / skill 不存在 / 读对象异常）返回纯文本 400，避免中途出 zip 时再插入 JSON 错误体。
     */
    @PostMapping("/downloadSkillZip")
    public ResponseEntity<StreamingResponseBody> downloadSkillZip(
        @RequestBody(required = false) DownloadSkillZipQo request,
        @Parameter(description = "skill 目录路径，例如 /.openclaw/workspace/skills/fol-auto-biztravel") @RequestParam(
            value = "skillPath", required = false) String skillPath,
        @Parameter(description = "目标用户编码，可选；留空则使用当前登录用户") @RequestParam(value = "userCode",
            required = false) String userCode) {
        // body 优先；body 缺失时再退到 query 参数。两种来源都允许，避免前端必须指定其一。
        String finalSkillPath = request != null && StringUtils.isNotBlank(request.getSkillPath())
            ? request.getSkillPath()
            : skillPath;
        String finalUserCode = request != null && StringUtils.isNotBlank(request.getUserCode()) ? request.getUserCode()
            : userCode;
        String resolvedUserCode = StringUtils.isNotBlank(finalUserCode) ? finalUserCode
            : CurrentUserHolder.getCurrentUserCode();
        try {
            if (StringUtils.isBlank(finalSkillPath)) {
                throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.path.invalid"));
            }
            ByClawSkillDownloadApplicationService.SkillZipDownload download = byClawSkillDownloadApplicationService
                .prepare(resolvedUserCode, finalSkillPath);
            // RFC 5987 风格的 filename*：兼容中文 / 特殊字符 skill 名，避免浏览器侧文件名乱码。
            String encoded = UriUtils.encode(download.getZipFileName(), java.nio.charset.StandardCharsets.UTF_8);
            String contentDisposition = "attachment; filename=\"" + encoded + "\"; filename*=UTF-8''" + encoded;
            return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/zip"))
                .header("Content-Disposition", contentDisposition).body(download.getBody());
        }
        catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().contentType(MediaType.parseMediaType("text/plain; charset=UTF-8"))
                .body(out -> out.write(e.getMessage().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }
        catch (Exception e) {
            logger.error("downloadSkillZip failed, userCode={}, skillPath={}", resolvedUserCode, finalSkillPath, e);
            String fallbackMsg = StringUtils.defaultIfBlank(e.getMessage(),
                I18nUtil.get("byclaw.skill.download.failed"));
            return ResponseEntity.badRequest().contentType(MediaType.parseMediaType("text/plain; charset=UTF-8"))
                .body(out -> out.write(fallbackMsg.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }
    }

    /**
     * 列出空间
     *
     * @return ResponseUtil
     */
    @PostMapping("/listUserSpace")
    public ResponseUtil<List<UserSpaceVo>> listUserSpace(@RequestBody UserSpaceDto userSpaceDto) {
        try {
            List<UserSpaceVo> userSpaceVos = byClawFileQueryApplicationService.listUserSpace(userSpaceDto);
            return ResponseUtil.success(userSpaceVos);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return ResponseUtil.fail(e.getMessage());
        }
    }

    /**
     * 获取mcp工具信息
     *
     * @param resourceIdDto 请求
     * @return ResponseUtil
     */
    @PostMapping("/mcp/listTools")
    public ResponseUtil<McpSchema.ListToolsResult> listTools(@RequestBody ResourceIdDto resourceIdDto) {
        McpSchema.ListToolsResult listToolsResult = ssResExtMcpService.listTools(resourceIdDto);
        return ResponseUtil.success(listToolsResult);
    }

    /**
     * 获取mcp工具信息
     *
     * @param callMcpParamsDto 请求
     * @return ResponseUtil
     */
    @PostMapping("/mcp/callToolRequest")
    public ResponseUtil<McpSchema.CallToolResult> callToolRequest(@RequestBody CallMcpParamsDto callMcpParamsDto) {
        McpSchema.CallToolResult callToolResult = ssResExtMcpService.callToolRequest(callMcpParamsDto);
        return ResponseUtil.success(callToolResult);
    }
}
