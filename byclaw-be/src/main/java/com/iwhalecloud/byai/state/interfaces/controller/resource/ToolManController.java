package com.iwhalecloud.byai.state.interfaces.controller.resource;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

import com.alibaba.fastjson2.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import org.springframework.web.util.UriUtils;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.superassist.SuasSuperassistApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.resource.CallMcpParamsDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.dto.resource.ResourceIdDto;
import com.iwhalecloud.byai.state.domain.resource.dto.ObjectZipImportItem;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.session.ByClawFileQueryApplicationService;
import com.iwhalecloud.byai.state.application.service.session.ByClawPersonalAgentArchivApplicationService;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillDeleteApplicationService;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillDownloadApplicationService;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillQueryApplicationService;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillUploadApplicationService;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.chat.dto.UserSpaceDto;
import com.iwhalecloud.byai.state.domain.chat.vo.UserSpaceVo;
import com.iwhalecloud.byai.state.domain.resource.dto.CurlImportRequest;
import com.iwhalecloud.byai.state.domain.resource.dto.CurlParseResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ObjectZipImportResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlGenerateRequest;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlGenerateResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlRunRequest;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlRunResult;
import com.iwhalecloud.byai.state.domain.resource.dto.ToolSaveRequest;
import com.iwhalecloud.byai.state.domain.resource.qo.DeleteResourceQo;
import com.iwhalecloud.byai.state.domain.resource.qo.DeleteSkillQo;
import com.iwhalecloud.byai.state.domain.resource.qo.DownloadSkillZipQo;
import com.iwhalecloud.byai.state.domain.resource.qo.GenerateResourceImageQo;
import com.iwhalecloud.byai.state.domain.resource.qo.PersonalAgentArchiveQo;
import com.iwhalecloud.byai.state.domain.resource.qo.ResourceDetailQo;
import com.iwhalecloud.byai.state.domain.resource.qo.ThirdPartySkillInstallQo;
import com.iwhalecloud.byai.state.domain.resource.qo.UpdateResourceBasicInfoQo;
import com.iwhalecloud.byai.state.domain.resource.qo.WorkspaceSkillQo;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceApplicationService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceImageGenerationService;
import com.iwhalecloud.byai.state.domain.resource.service.ToolManService;
import com.iwhalecloud.byai.state.domain.resource.vo.GeneratedResourceImageVo;
import com.iwhalecloud.byai.state.domain.resource.vo.ResourceDetailVo;
import com.iwhalecloud.byai.state.domain.resource.vo.SkillMarketplaceDigitalEmployeeVo;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawFileDto;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawPersonalAgentArchiveDto;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawSkillDto;
import com.iwhalecloud.byai.state.domain.session.qo.QryByClawFileByUserCodeQo;
import com.iwhalecloud.byai.state.domain.session.qo.QrySkillListByUserCodeQo;
import io.modelcontextprotocol.spec.McpSchema;
import io.swagger.v3.oas.annotations.Parameter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
@RestController
@RequestMapping("/tool")
public class ToolManController {

    private static final Logger logger = LoggerFactory.getLogger(ToolManController.class);

    @Autowired
    private ToolManService toolManService;

    @Autowired
    private ResourceImageGenerationService resourceImageGenerationService;

    @Autowired
    private SsResExtMcpService ssResExtMcpService;

    @Autowired
    private SsResExtSkillService ssResExtSkillService;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private ResourceApplicationService resourceApplicationService;

    @Autowired
    private ByClawFileQueryApplicationService byClawFileQueryApplicationService;

    @Autowired
    private ByClawSkillQueryApplicationService byClawSkillQueryApplicationService;

    @Autowired
    private SuasSuperassistApplicationService suasSuperassistApplicationService;

    @Autowired
    private ByClawSkillUploadApplicationService byClawSkillUploadApplicationService;

    @Autowired
    private ByClawSkillResourceApplicationService byClawSkillResourceApplicationService;

    @Autowired
    private ByClawSkillDownloadApplicationService byClawSkillDownloadApplicationService;

    @Autowired
    private ByClawSkillDeleteApplicationService byClawSkillDeleteApplicationService;

    @Autowired
    private ByClawPersonalAgentArchivApplicationService byClawPersonalAgentArchivApplicationService;

    @Autowired
    private ResourceArtifactStorageService resourceArtifactStorageService;

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
    public ResponseUtil<ObjectZipImportResult> importToolJson(
        @Parameter(description = "资源 JSON 文件", required = true) @RequestParam("file") MultipartFile[] file,
        @Parameter(description = "所属目录 ID，可选") @RequestParam(value = "catalogId", required = false) Long catalogId,
        @Parameter(description = "资源归属类型：enterprise-企业，personal-个人",
            required = false) @RequestParam(value = "ownerType", required = false) String ownerType) {
        if (isBatchImport(file)) {
            return ResponseUtil.successResponse(I18nUtil.get("tool.resource.import.success"),
                importToolJsonBatch(file, catalogId, ownerType));
        }
        try {
            // 新入口只负责接收上传文件和目录/归属参数，
            // 具体的 JSON 校验、主表新增或更新、子表落库、FTP 同步，都统一下沉到 service。
            Map<String, Object> data = toolManService.importToolJsonNewFromMultipart(file[0], catalogId, ownerType);
            return ResponseUtil.successResponse(I18nUtil.get("tool.resource.import.success"),
                buildToolJsonSuccessResult(file[0], data));
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

    private boolean isBatchImport(MultipartFile[] files) {
        return files != null && files.length > 1;
    }

    private ObjectZipImportResult importToolJsonBatch(MultipartFile[] files, Long catalogId, String ownerType) {
        ObjectZipImportResult result = new ObjectZipImportResult();
        result.setTotal(files == null ? 0 : files.length);
        if (files == null) {
            return result;
        }
        for (MultipartFile multipartFile : files) {
            try {
                Map<String, Object> data = toolManService.importToolJsonNewFromMultipart(multipartFile, catalogId,
                    ownerType);
                mergeImportResult(result, buildToolJsonSuccessResult(multipartFile, data));
            }
            catch (Exception e) {
                result.getItems().add(buildFailedImportItem(multipartFile, e));
            }
        }
        fillBatchImportSummary(result);
        return result;
    }

    private ObjectZipImportResult importZipBatch(MultipartFile[] files, Long catalogId, String ownerType,
        boolean objectZip) {
        ObjectZipImportResult result = new ObjectZipImportResult();
        result.setTotal(files == null ? 0 : files.length);
        if (files == null) {
            return result;
        }
        for (MultipartFile multipartFile : files) {
            try {
                ObjectZipImportResult itemResult = objectZip
                    ? toolManService.importObjectZipFromMultipart(multipartFile, catalogId, ownerType)
                    : toolManService.importViewZipFromMultipart(multipartFile, catalogId, ownerType);
                mergeImportResult(result, itemResult);
            }
            catch (Exception e) {
                result.getItems().add(buildFailedImportItem(multipartFile, e));
            }
        }
        fillBatchImportSummary(result);
        return result;
    }

    private ObjectZipImportResult buildToolJsonSuccessResult(MultipartFile file, Map<String, Object> data) {
        ObjectZipImportResult result = new ObjectZipImportResult();
        ObjectZipImportItem item = new ObjectZipImportItem();
        item.setResourceCode(file == null ? null : file.getOriginalFilename());
        item.setResourceName(file == null ? null : file.getOriginalFilename());
        item.setResourceId(String.valueOf(data.get("resourceId")));
        item.setUpdated(Boolean.TRUE.equals(data.get("updated")));
        item.setSuccess(true);
        result.getItems().add(item);
        fillBatchImportSummary(result);
        return result;
    }

    private ObjectZipImportItem buildFailedImportItem(MultipartFile file, Exception e) {
        ObjectZipImportItem item = new ObjectZipImportItem();
        String fileName = file == null ? null : file.getOriginalFilename();
        item.setResourceCode(fileName);
        item.setResourceName(fileName);
        item.setSuccess(false);
        item.setMessage(e.getMessage() != null ? e.getMessage() : I18nUtil.get("tool.resource.import.failed"));
        return item;
    }

    private void mergeImportResult(ObjectZipImportResult target, ObjectZipImportResult source) {
        if (source == null) {
            return;
        }
        target.getItems().addAll(source.getItems());
    }

    private void fillBatchImportSummary(ObjectZipImportResult result) {
        if (result.getTotal() <= 0) {
            result.setTotal(result.getItems().size());
        }
        List<ObjectZipImportItem> successItems = result.getItems().stream().filter(ObjectZipImportItem::isSuccess)
            .collect(Collectors.toList());
        List<ObjectZipImportItem> createdItems = successItems.stream().filter(item -> !item.isUpdated())
            .collect(Collectors.toList());
        List<ObjectZipImportItem> updatedItems = successItems.stream().filter(ObjectZipImportItem::isUpdated)
            .collect(Collectors.toList());
        result.setSuccess(successItems.size());
        result.setFailed(result.getItems().size() - successItems.size());
        result.setCreatedCount(createdItems.size());
        result.setUpdatedCount(updatedItems.size());
        result.setCreatedItems(new ArrayList<>(createdItems));
        result.setUpdatedItems(new ArrayList<>(updatedItems));
    }

    /**
     * 对象超市：上传对象压缩包，批量导入对象资源。
     */
    @PostMapping("/importObjectZip")
    public ResponseUtil<ObjectZipImportResult> importObjectZip(
        @Parameter(description = "对象 zip 文件", required = true) @RequestParam("file") MultipartFile[] file,
        @Parameter(description = "所属目录 ID，可选") @RequestParam(value = "catalogId", required = false) Long catalogId,
        @Parameter(description = "资源归属类型：enterprise-企业，personal-个人",
            required = false) @RequestParam(value = "ownerType", required = false) String ownerType) {
        if (isBatchImport(file)) {
            return ResponseUtil.successResponse(I18nUtil.get("tool.object.zip.import.success"),
                importZipBatch(file, catalogId, ownerType, true));
        }
        try {
            // 核心流程统一下沉到 service：
            // 1. zip 落盘并解压；
            // 2. 解析 ontology/objects 下的对象 owl；
            // 3. 写主表 / 对象子表；
            // 4. 同步对象 json 与批次 zip 到 FTP。
            ObjectZipImportResult data = toolManService.importObjectZipFromMultipart(file[0], catalogId, ownerType);
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
        @Parameter(description = "视图 zip 文件", required = true) @RequestParam("file") MultipartFile[] file,
        @Parameter(description = "所属目录 ID，可选") @RequestParam(value = "catalogId", required = false) Long catalogId,
        @Parameter(description = "资源归属类型：enterprise-企业，personal-个人",
            required = false) @RequestParam(value = "ownerType", required = false) String ownerType) {
        if (isBatchImport(file)) {
            return ResponseUtil.successResponse(I18nUtil.get("tool.view.zip.import.success"),
                importZipBatch(file, catalogId, ownerType, false));
        }
        try {
            // 核心流程统一下沉到 service：
            // 1. zip 落盘并解压；
            // 2. 解析 ontology/views 下的视图 owl；
            // 3. 写主表 / 视图子表 / 视图与对象关系；
            // 4. 同步视图 json 与批次 zip 到 FTP。
            ObjectZipImportResult data = toolManService.importViewZipFromMultipart(file[0], catalogId, ownerType);
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
     * 技能管理：上传技能 zip，资源化入库并同步到个人/企业 skill hub。
     */
    @PostMapping("/checkSkillZipImportConflicts")
    public ResponseUtil<ObjectZipImportResult> checkSkillZipImportConflicts(
        @Parameter(description = "技能 zip 文件", required = true) @RequestParam("file") MultipartFile[] file,
        @Parameter(description = "资源归属类型：enterprise-企业，personal-个人",
            required = false) @RequestParam(value = "ownerType", required = false) String ownerType) {
        try {
            ObjectZipImportResult data = toolManService.previewSkillZipImportConflicts(file, ownerType);
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.skill.import.conflict.query.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("checkSkillZipImportConflicts failed", e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage()
                : I18nUtil.get("byclaw.skill.import.conflict.query.failed"));
        }
    }

    /**
     * 技能管理：上传技能 zip，资源化入库并同步到个人/企业 skill hub。
     */
    @PostMapping("/importSkillZip")
    public ResponseUtil<ObjectZipImportResult> importSkillZip(
        @Parameter(description = "技能 zip 文件", required = true) @RequestParam("file") MultipartFile[] file,
        @Parameter(description = "所属目录 ID，可选") @RequestParam(value = "catalogId", required = false) Long catalogId,
        @Parameter(description = "资源归属类型：enterprise-企业，personal-个人",
            required = false) @RequestParam(value = "ownerType", required = false) String ownerType) {
        try {
            ObjectZipImportResult data = toolManService.importSkillZipFromMultipart(file, catalogId, ownerType);
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.skill.upload.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("importSkillZip failed", e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("byclaw.skill.upload.failed"));
        }
    }

    /** 第三方技能超市：按下载地址安装技能到指定数字员工。 */
    @PostMapping("/installThirdPartySkill")
    public ResponseUtil<ObjectZipImportResult> installThirdPartySkill(HttpServletRequest httpRequest,
        @RequestBody ThirdPartySkillInstallQo request) {
        long startNanos = System.nanoTime();
        String userCode = CurrentUserHolder.getCurrentUserCode();
        Long digId = request == null ? null : request.getDigId();
        String downloadUrl = request == null ? null : request.getDownloadUrl();
        String requestBody = serializeThirdPartySkillInstallRequest(request);
        String requestContext = serializeThirdPartySkillInstallRequestContext(httpRequest, request);
        String downloadUrlHash = StringUtils.isBlank(downloadUrl) ? "" : DigestUtils.sha256Hex(downloadUrl.trim());
        logger.info(
            "第三方技能安装接口调用开始，userCode={}, requestBody={}, requestContext={}, downloadUrlHash={}",
            userCode, requestBody, requestContext, downloadUrlHash);
        try {
            if (request == null) {
                throw new IllegalArgumentException(I18nUtil.get("param.cannot.be.null"));
            }
            ByClawSkillResourceApplicationService.SkillImportResult itemResult =
                byClawSkillResourceApplicationService.installThirdPartySkill(digId, downloadUrl);
            ObjectZipImportResult result =
                byClawSkillResourceApplicationService.buildSingleSkillImportResult(itemResult);
            SsResource resource = itemResult.resource();
            SsResExtSkill extSkill = itemResult.extSkill();
            logger.info(
                "第三方技能安装接口调用成功，userCode={}, digId={}, operation={}, resourceId={}, resourceCode={}, "
                    + "resourceName={}, version={}, skillUrl={}, packageSize={}, requestBody={}, downloadUrlHash={}, "
                    + "durationMs={}",
                userCode, digId, itemResult.updated() ? "UPDATE" : "CREATE",
                resource == null ? null : resource.getResourceId(),
                resource == null ? null : resource.getResourceCode(),
                resource == null ? null : resource.getResourceName(),
                extSkill == null ? null : extSkill.getVersion(),
                extSkill == null ? null : extSkill.getSkillUrl(),
                extSkill == null ? null : extSkill.getSkillPackageSize(),
                requestBody, downloadUrlHash, elapsedMillis(startNanos));
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.third.party.skill.install.success"),
                result);
        }
        catch (IllegalArgumentException | BdpRuntimeException e) {
            logger.warn(
                "第三方技能安装接口调用失败，userCode={}, digId={}, requestBody={}, requestContext={}, "
                    + "downloadUrlHash={}, reason={}, durationMs={}",
                userCode, digId, requestBody, requestContext, downloadUrlHash, e.getMessage(),
                elapsedMillis(startNanos));
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error(
                "第三方技能安装接口调用异常，userCode={}, digId={}, requestBody={}, requestContext={}, "
                    + "downloadUrlHash={}, durationMs={}",
                userCode, digId, requestBody, requestContext, downloadUrlHash, elapsedMillis(startNanos), e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage()
                : I18nUtil.get("byclaw.third.party.skill.install.failed"));
        }
    }

    /**
     * 第三方技能超市：查询当前 Beyond-Token 用户可管理、可选择安装技能的数字员工。
     */
    @GetMapping("/queryThirdPartySkillManageableDigitalEmployees")
    public ResponseUtil<List<SkillMarketplaceDigitalEmployeeVo>> queryThirdPartySkillManageableDigitalEmployees() {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        try {
            List<SkillMarketplaceDigitalEmployeeVo> employees =
                byClawSkillResourceApplicationService.listSkillMarketplaceManageableDigitalEmployees();
            logger.info("第三方技能超市可管理数字员工查询成功，userCode={}, count={}", userCode, employees.size());
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.third.party.skill.manageable.digemployee.query.success"),
                employees);
        }
        catch (Exception e) {
            logger.error("第三方技能超市可管理数字员工查询失败，userCode={}", userCode, e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage()
                : I18nUtil.get("byclaw.third.party.skill.manageable.digemployee.query.failed"));
        }
    }

    static String serializeThirdPartySkillInstallRequest(ThirdPartySkillInstallQo request) {
        return request == null ? "null" : JSON.toJSONString(request);
    }

    static String serializeThirdPartySkillInstallRequestContext(HttpServletRequest httpRequest,
        ThirdPartySkillInstallQo request) {
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("requestBody", request);
        context.put("currentLoginInfo", CurrentUserHolder.getLoginInfo());
        context.put("currentUserId", CurrentUserHolder.getCurrentUserId());
        context.put("currentUserCode", CurrentUserHolder.getCurrentUserCode());
        context.put("currentUserName", CurrentUserHolder.getCurrentUserName());
        context.put("currentEnterpriseId", CurrentUserHolder.getEnterpriseId());
        context.put("currentAssistantId", CurrentUserHolder.getAssistantId());
        context.put("currentDefaultDigEmployeeId", CurrentUserHolder.getDefaultDigEmployeeId());
        context.put("currentSessionDatasetId", CurrentUserHolder.getLoginInfo() == null
            ? null : CurrentUserHolder.getSessionDatasetId());
        if (httpRequest == null) {
            return JSON.toJSONString(context);
        }

        Map<String, List<String>> headers = new LinkedHashMap<>();
        if (httpRequest.getHeaderNames() != null) {
            Collections.list(httpRequest.getHeaderNames()).forEach(
                name -> headers.put(name, Collections.list(httpRequest.getHeaders(name))));
        }
        Map<String, List<String>> parameters = new LinkedHashMap<>();
        httpRequest.getParameterMap().forEach((name, values) ->
            parameters.put(name, values == null ? Collections.emptyList() : Arrays.asList(values)));

        HttpSession session = httpRequest.getSession(false);
        Map<String, String> sessionAttributes = new LinkedHashMap<>();
        if (session != null && session.getAttributeNames() != null) {
            Collections.list(session.getAttributeNames()).forEach(name ->
                sessionAttributes.put(name, String.valueOf(session.getAttribute(name))));
        }
        String beyondToken = httpRequest.getHeader("Beyond-Token");
        String sessionUserCode = session == null ? null : String.valueOf(session.getAttribute("USER_CODE"));
        String authenticationSource;
        if (StringUtils.isNotBlank(beyondToken)) {
            authenticationSource = "BEYOND_TOKEN";
        }
        else if (StringUtils.isNotBlank(sessionUserCode) && !"null".equalsIgnoreCase(sessionUserCode)) {
            authenticationSource = "SESSION_NOT_ACCEPTED";
        }
        else if (StringUtils.isNotBlank(httpRequest.getHeader("SSO-TOKEN"))) {
            authenticationSource = "SSO_TOKEN";
        }
        else if (StringUtils.isNotBlank(httpRequest.getHeader("accessToken"))) {
            authenticationSource = "ACCESS_TOKEN";
        }
        else {
            authenticationSource = "UNKNOWN";
        }

        context.put("httpMethod", httpRequest.getMethod());
        context.put("requestUrl", httpRequest.getRequestURL().toString());
        context.put("requestUri", httpRequest.getRequestURI());
        context.put("queryString", httpRequest.getQueryString());
        context.put("remoteAddress", httpRequest.getRemoteAddr());
        context.put("contentType", httpRequest.getContentType());
        context.put("characterEncoding", httpRequest.getCharacterEncoding());
        context.put("contentLength", httpRequest.getContentLengthLong());
        context.put("requestHeaders", headers);
        context.put("requestParameters", parameters);
        context.put("beyondToken", beyondToken);
        context.put("systemCode", httpRequest.getHeader("system-code"));
        context.put("authenticationSource", authenticationSource);
        context.put("httpSessionId", session == null ? null : session.getId());
        context.put("httpSessionAttributes", sessionAttributes);
        return JSON.toJSONString(context);
    }

    private static long elapsedMillis(long startNanos) {
        return (System.nanoTime() - startNanos) / 1_000_000L;
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
     * 按 resourceCode + ownerType 删除资源（支持 tool、skill、kg_doc、object、view）。 删除前同样会校验资源是否被引用；存在引用时不允许删除。
     */
    @PostMapping("/deleteResourceByCodeAndOwnerType")
    public ResponseUtil<Void> deleteResourceByCodeAndOwnerType(@RequestBody(required = false) DeleteResourceQo request,
        @Parameter(description = "资源编码", required = false) @RequestParam(value = "resourceCode",
            required = false) String resourceCode,
        @Parameter(description = "资源归属类型：enterprise-企业，personal-个人",
            required = false) @RequestParam(value = "ownerType", required = false) String ownerType) {
        try {
            String finalResourceCode = request != null && StringUtils.isNotBlank(request.getResourceCode())
                ? request.getResourceCode()
                : resourceCode;
            String finalOwnerType = request != null && StringUtils.isNotBlank(request.getOwnerType())
                ? request.getOwnerType()
                : ownerType;
            toolManService.deleteManagedResource(finalResourceCode, finalOwnerType);
            return ResponseUtil.success(I18nUtil.get("tool.resource.delete.success"));
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(resolveResourceNotFoundMessage(e));
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("deleteResourceByCode failed, resourceCode={}, ownerType={}",
                request != null && StringUtils.isNotBlank(request.getResourceCode()) ? request.getResourceCode()
                    : resourceCode,
                request != null && StringUtils.isNotBlank(request.getOwnerType()) ? request.getOwnerType() : ownerType,
                e);
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
        @Parameter(description = "资源编码", required = false) @RequestParam(value = "resourceCode",
            required = false) String resourceCode) {
        try {
            String finalResourceCode = request != null && StringUtils.isNotBlank(request.getResourceCode())
                ? request.getResourceCode()
                : resourceCode;
            toolManService.deleteResourceAndAllRel(finalResourceCode);
            return ResponseUtil.success(I18nUtil.get("tool.resource.delete.success"));
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(resolveResourceNotFoundMessage(e));
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("deleteResourceAndAllRel failed, resourceCode={}",
                request != null && StringUtils.isNotBlank(request.getResourceCode()) ? request.getResourceCode()
                    : resourceCode,
                e);
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

    /**
     * 查询正在使用某个技能的数字员工列表。 使用 ss_resource_rel_detail 作为绑定来源，展示绑定开始时间。
     */
    @PostMapping("/querySkillUsedDigitalEmployees")
    public ResponseUtil<List<Map<String, Object>>> querySkillUsedDigitalEmployees(
        @RequestBody(required = false) ResourceDetailQo request,
        @Parameter(description = "技能资源ID", required = false) @RequestParam(value = "resourceId",
            required = false) Long resourceId) {
        try {
            Long finalResourceId = request != null && request.getResourceId() != null ? request.getResourceId()
                : resourceId;
            if (finalResourceId == null) {
                return ResponseUtil.fail(I18nUtil.get("resource.resourceid.notnull"));
            }

            List<SsResourceRelDetail> relDetails = ssResourceRelDetailService
                .list(new LambdaQueryWrapper<SsResourceRelDetail>()
                    .eq(SsResourceRelDetail::getRelResourceId, finalResourceId)
                    .orderByDesc(SsResourceRelDetail::getCreateTime));
            if (relDetails == null || relDetails.isEmpty()) {
                return ResponseUtil.successResponse(I18nUtil.get("tool.resource.query.success"),
                    Collections.emptyList());
            }

            List<Long> digEmployeeIds = relDetails.stream().map(SsResourceRelDetail::getResourceId)
                .filter(Objects::nonNull).distinct().collect(Collectors.toList());
            Map<Long, SsResourceRelDetail> relDetailMap = relDetails.stream()
                .filter(item -> item != null && item.getResourceId() != null)
                .collect(Collectors.toMap(SsResourceRelDetail::getResourceId, item -> item, (left, right) -> left,
                    LinkedHashMap::new));
            List<SsResource> resources = ssResourceService.findByIdList(digEmployeeIds);
            Map<Long, SsResource> resourceMap = resources.stream()
                .filter(item -> item != null && item.getResourceId() != null)
                .collect(Collectors.toMap(SsResource::getResourceId, item -> item, (left, right) -> left));
            List<Map<String, Object>> data = digEmployeeIds.stream().map(resourceMap::get)
                .filter(item -> item != null && ResourceBizTypeEnum.DIG_EMPLOYEE.name().equals(item.getResourceBizType()))
                .map(item -> {
                    SsResourceRelDetail relDetail = relDetailMap.get(item.getResourceId());
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("resourceId", item.getResourceId());
                    row.put("resourceName", item.getResourceName());
                    row.put("useStartTime", relDetail == null ? null : relDetail.getCreateTime());
                    return row;
                }).collect(Collectors.toList());

            return ResponseUtil.successResponse(I18nUtil.get("tool.resource.query.success"), data);
        }
        catch (Exception e) {
            logger.error("querySkillUsedDigitalEmployees failed, resourceId={}",
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
        @Parameter(description = "资源图片", required = false) @RequestParam(value = "avatar",
            required = false) String avatar,
        @Parameter(description = "所属目录ID", required = false) @RequestParam(value = "catalogId",
            required = false) Long catalogId) {
        try {
            Long finalResourceId = request != null && request.getResourceId() != null ? request.getResourceId()
                : resourceId;
            String finalResourceName = request != null && request.getResourceName() != null ? request.getResourceName()
                : resourceName;
            String finalResourceDesc = request != null && request.getResourceDesc() != null ? request.getResourceDesc()
                : resourceDesc;
            String finalAvatar = request != null && request.getAvatar() != null ? request.getAvatar() : avatar;
            Long finalCatalogId = request != null && request.getCatalogId() != null ? request.getCatalogId()
                : catalogId;

            if (finalResourceId == null) {
                return ResponseUtil.fail(I18nUtil.get("resource.resourceid.notnull"));
            }
            if (finalResourceName == null) {
                return ResponseUtil.fail(I18nUtil.get("resource.resourcename.notnull"));
            }
            toolManService.updateResourceBasicInfo(finalResourceId, finalResourceName, finalResourceDesc, finalAvatar,
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
     * 根据资源名称和描述调用默认大模型生成资源图片。
     */
    @PostMapping("/generateResourceImage")
    public ResponseUtil<GeneratedResourceImageVo> generateResourceImage(
        @RequestBody GenerateResourceImageQo request) {
        try {
            GeneratedResourceImageVo data = resourceImageGenerationService.generate(request);
            return ResponseUtil.successResponse(I18nUtil.get("resource.image.generate.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("generateResourceImage failed", e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("resource.image.generate.failed"));
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
     * 查询用户工作空间下 skills 目录的 skill 列表。 userCode 为空时回退到当前登录用户；resourceId 为空时回退到默认数字员工；仅支持 MinIO 存储模式。
     */
    @PostMapping("/qrySkillListByUserCode")
    public ResponseUtil<List<ByClawSkillDto>> qrySkillListByUserCode(@RequestBody QrySkillListByUserCodeQo request) {
        try {
            if (request == null) {
                return ResponseUtil.fail(I18nUtil.get("param.cannot.be.null"));
            }
            String requestUserCode = request == null ? null : request.getUserCode();
            String resolvedUserCode = requestUserCode != null && !requestUserCode.trim().isEmpty() ? requestUserCode
                : CurrentUserHolder.getCurrentUserCode();
            Long resolvedResourceId = request.getResourceId() == null
                ? suasSuperassistApplicationService.resolveCurrentUserDefaultDigitalEmployeeId()
                : request.getResourceId();
            List<ByClawSkillDto> data = byClawSkillQueryApplicationService.qrySkillListByUserCode(resolvedUserCode,
                resolvedResourceId, request == null ? null : request.getKeyword());
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
     * 查询当前数字员工 workspace 下由龙虾安装、但尚未绑定到数字员工关系表的 skill 列表。
     */
    @PostMapping("/qryLobsterInstalledSkillList")
    public ResponseUtil<List<ByClawSkillDto>> qryLobsterInstalledSkillList(
        @RequestBody QrySkillListByUserCodeQo request) {
        try {
            if (request == null) {
                return ResponseUtil.fail(I18nUtil.get("param.cannot.be.null"));
            }
            String requestUserCode = request.getUserCode();
            String resolvedUserCode = StringUtils.isNotBlank(requestUserCode) ? requestUserCode
                : CurrentUserHolder.getCurrentUserCode();
            Long resolvedResourceId = request.getResourceId() == null
                ? suasSuperassistApplicationService.resolveCurrentUserDefaultDigitalEmployeeId()
                : request.getResourceId();
            List<ByClawSkillDto> data = byClawSkillQueryApplicationService.qryLobsterInstalledSkillList(
                resolvedUserCode, resolvedResourceId, request.getKeyword());
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.lobster.installed.skill.list.query.success"),
                data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("qryLobsterInstalledSkillList failed, userCode={}, resourceId={}, keyword={}",
                request == null ? null : request.getUserCode(), request == null ? null : request.getResourceId(),
                request == null ? null : request.getKeyword(), e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage()
                : I18nUtil.get("byclaw.lobster.installed.skill.list.query.failed"));
        }
    }

    /**
     * 查询当前数字员工工作空间下未资源绑定的目录技能。目录技能展示为“用户开发”。
     */
    @PostMapping("/qryWorkspaceSkillList")
    public ResponseUtil<List<ByClawSkillDto>> qryWorkspaceSkillList(@RequestBody QrySkillListByUserCodeQo request) {
        try {
            if (request == null) {
                return ResponseUtil.fail(I18nUtil.get("param.cannot.be.null"));
            }
            String requestUserCode = request.getUserCode();
            String resolvedUserCode = StringUtils.isNotBlank(requestUserCode) ? requestUserCode
                : CurrentUserHolder.getCurrentUserCode();
            Long resolvedResourceId = request.getResourceId() == null
                ? suasSuperassistApplicationService.resolveCurrentUserDefaultDigitalEmployeeId()
                : request.getResourceId();
            List<ByClawSkillDto> data = byClawSkillQueryApplicationService.qryWorkspaceUnboundSkillList(
                resolvedUserCode, resolvedResourceId, request.getKeyword());
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.workspace.skill.list.query.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("qryWorkspaceSkillList failed, userCode={}, resourceId={}, keyword={}",
                request == null ? null : request.getUserCode(), request == null ? null : request.getResourceId(),
                request == null ? null : request.getKeyword(), e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage()
                : I18nUtil.get("byclaw.workspace.skill.list.query.failed"));
        }
    }

    /**
     * 查询当前数字员工工作空间下、尚未进入个人技能资源列表的目录技能。供首页右侧“个人技能” tab 合并展示。
     * 与 {@link #qryWorkspaceSkillList} 的区别：去重口径为“个人 tab 已资源化技能”，而非“绑定到当前数字员工”。
     */
    @PostMapping("/qryWorkspacePersonalSkillList")
    public ResponseUtil<List<ByClawSkillDto>> qryWorkspacePersonalSkillList(
        @RequestBody QrySkillListByUserCodeQo request) {
        try {
            if (request == null) {
                return ResponseUtil.fail(I18nUtil.get("param.cannot.be.null"));
            }
            String requestUserCode = request.getUserCode();
            String resolvedUserCode = StringUtils.isNotBlank(requestUserCode) ? requestUserCode
                : CurrentUserHolder.getCurrentUserCode();
            Long resolvedResourceId = request.getResourceId() == null
                ? suasSuperassistApplicationService.resolveCurrentUserDefaultDigitalEmployeeId()
                : request.getResourceId();
            List<ByClawSkillDto> data = byClawSkillQueryApplicationService.qryWorkspacePersonalUnboundSkillList(
                resolvedUserCode, resolvedResourceId, request.getKeyword());
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.workspace.skill.list.query.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("qryWorkspacePersonalSkillList failed, userCode={}, resourceId={}, keyword={}",
                request == null ? null : request.getUserCode(), request == null ? null : request.getResourceId(),
                request == null ? null : request.getKeyword(), e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage()
                : I18nUtil.get("byclaw.workspace.skill.list.query.failed"));
        }
    }

    /**
     * 按工作空间 skillPath 查询目录技能详情。
     */
    @PostMapping("/getWorkspaceSkillDetail")
    public ResponseUtil<ByClawSkillDto> getWorkspaceSkillDetail(@RequestBody WorkspaceSkillQo request) {
        try {
            if (request == null) {
                return ResponseUtil.fail(I18nUtil.get("param.cannot.be.null"));
            }
            String resolvedUserCode = StringUtils.isNotBlank(request.getUserCode()) ? request.getUserCode()
                : CurrentUserHolder.getCurrentUserCode();
            Long resolvedResourceId = request.getResourceId() == null
                ? suasSuperassistApplicationService.resolveCurrentUserDefaultDigitalEmployeeId()
                : request.getResourceId();
            ByClawSkillDto data = byClawSkillQueryApplicationService.getWorkspaceSkillDetail(resolvedUserCode,
                resolvedResourceId, request.getSkillPath());
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.workspace.skill.detail.query.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("getWorkspaceSkillDetail failed, userCode={}, resourceId={}, skillPath={}",
                request == null ? null : request.getUserCode(), request == null ? null : request.getResourceId(),
                request == null ? null : request.getSkillPath(), e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage()
                : I18nUtil.get("byclaw.workspace.skill.detail.query.failed"));
        }
    }

    /**
     * 分享目录技能前，预检查资源化是否会覆盖当前用户个人技能。
     */
    @PostMapping("/checkWorkspaceSkillShareConflicts")
    public ResponseUtil<ObjectZipImportResult> checkWorkspaceSkillShareConflicts(@RequestBody WorkspaceSkillQo request) {
        try {
            if (request == null) {
                return ResponseUtil.fail(I18nUtil.get("param.cannot.be.null"));
            }
            String resolvedUserCode = StringUtils.isNotBlank(request.getUserCode()) ? request.getUserCode()
                : CurrentUserHolder.getCurrentUserCode();
            Long resolvedResourceId = request.getResourceId() == null
                ? suasSuperassistApplicationService.resolveCurrentUserDefaultDigitalEmployeeId()
                : request.getResourceId();
            ObjectZipImportResult data = byClawSkillResourceApplicationService.previewWorkspaceSkillShareConflicts(
                resolvedUserCode, resolvedResourceId, request.getSkillPath());
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.skill.import.conflict.query.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("checkWorkspaceSkillShareConflicts failed, userCode={}, resourceId={}, skillPath={}",
                request == null ? null : request.getUserCode(), request == null ? null : request.getResourceId(),
                request == null ? null : request.getSkillPath(), e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage()
                : I18nUtil.get("byclaw.skill.import.conflict.query.failed"));
        }
    }

    /**
     * 将工作空间目录技能资源化为个人技能、绑定当前数字员工，并返回导入结果。
     */
    @PostMapping("/resourceizeWorkspaceSkill")
    public ResponseUtil<ObjectZipImportResult> resourceizeWorkspaceSkill(@RequestBody WorkspaceSkillQo request) {
        try {
            if (request == null) {
                return ResponseUtil.fail(I18nUtil.get("param.cannot.be.null"));
            }
            String resolvedUserCode = StringUtils.isNotBlank(request.getUserCode()) ? request.getUserCode()
                : CurrentUserHolder.getCurrentUserCode();
            Long resolvedResourceId = request.getResourceId() == null
                ? suasSuperassistApplicationService.resolveCurrentUserDefaultDigitalEmployeeId()
                : request.getResourceId();
            ByClawSkillResourceApplicationService.SkillImportResult itemResult =
                byClawSkillResourceApplicationService.resourceizeAndBindWorkspaceSkill(resolvedUserCode,
                    resolvedResourceId, request.getSkillPath(), Boolean.TRUE.equals(request.getOverwriteConfirmed()));
            ObjectZipImportResult data = byClawSkillResourceApplicationService.buildSingleSkillImportResult(itemResult);
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.workspace.skill.resourceize.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("resourceizeWorkspaceSkill failed, userCode={}, resourceId={}, skillPath={}",
                request == null ? null : request.getUserCode(), request == null ? null : request.getResourceId(),
                request == null ? null : request.getSkillPath(), e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage()
                : I18nUtil.get("byclaw.workspace.skill.resourceize.failed"));
        }
    }

    /**
     * 查询技能版本号。下游 OpenClaw 通过统一拦截器携带 beyond-token 鉴权后，可根据 needDownload/skillUrl 判断 hub 技能是否需要重新下载。
     */
    @RequestMapping(value = "/getSkillVersion", method = {
        RequestMethod.GET, RequestMethod.POST
    })
    public ResponseUtil<Map<String, Object>> getSkillVersion(
        @Parameter(description = "技能资源ID，推荐参数名") @RequestParam(value = "skillId", required = false) Long skillId,
        @Parameter(description = "技能资源ID，兼容参数名") @RequestParam(value = "resourceId", required = false) Long resourceId) {
        Long resolvedSkillId = skillId != null ? skillId : resourceId;
        if (resolvedSkillId == null) {
            return ResponseUtil.fail(I18nUtil.get("byclaw.skill.resource.id.empty"));
        }
        SsResExtSkill extSkill = ssResExtSkillService.findById(resolvedSkillId);
        if (extSkill == null || StringUtils.isBlank(extSkill.getVersion())) {
            return ResponseUtil.fail(I18nUtil.get("byclaw.skill.version.notfound"));
        }
        logSkillVersionDownload(resolvedSkillId, extSkill);
        boolean innerSkill = StringUtils.equalsIgnoreCase(extSkill.getSkillType(),
            SsResExtSkillService.INNER_SKILL_TYPE);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("skillId", resolvedSkillId);
        data.put("resourceId", resolvedSkillId);
        data.put("version", extSkill.getVersion());
        data.put("skillType", extSkill.getSkillType());
        data.put("sourceType", extSkill.getSourceType());
        data.put("needDownload", !innerSkill);
        data.put("skillUrl", innerSkill ? "" : buildSkillDownloadUrl(resolvedSkillId));
        return ResponseUtil.successResponse(I18nUtil.get("byclaw.skill.version.query.success"), data);
    }

    private void logSkillVersionDownload(Long skillId, SsResExtSkill extSkill) {
        Long digitalEmployeeId = null;
        String digitalEmployeeName = "";
        try {
            digitalEmployeeId = suasSuperassistApplicationService.resolveCurrentUserDefaultDigitalEmployeeId();
            if (digitalEmployeeId != null) {
                SsResource digitalEmployee = ssResourceService.findById(digitalEmployeeId);
                digitalEmployeeName = digitalEmployee == null ? "" : digitalEmployee.getResourceName();
            }
        }
        catch (Exception e) {
            // 审计日志补充数字员工信息失败时，不应影响技能版本查询。
            logger.warn("获取技能版本下载审计信息失败, digitalEmployeeId={}, skillId={}", digitalEmployeeId, skillId, e);
        }
        logger.info("数字员工正在下载技能, digitalEmployeeName={}, digitalEmployeeId={}, skillId={}, version={}, skillPath={}",
            digitalEmployeeName, digitalEmployeeId, skillId, extSkill.getVersion(),
            extractSkillPathFromTargetContent(extSkill.getTargetContent()));
    }

    private String extractSkillPathFromTargetContent(String targetContent) {
        if (StringUtils.isBlank(targetContent)) {
            return "";
        }
        try {
            return StringUtils.defaultString(JSON.parseObject(targetContent).getString("skillPath"));
        }
        catch (Exception e) {
            logger.warn("解析技能扩展信息中的 skillPath 失败");
            return "";
        }
    }

    private String buildSkillDownloadUrl(Long skillId) {
        return skillId == null ? "" : "/byaiService/tool/downloadSkillZip?skillId=" + skillId;
    }

    /**
     * 上传 skill zip 到用户工作空间。 - 落盘 bucket: byclaw-{userCode}（与 qrySkillListByUserCode 同口径） - 落盘前缀：数字员工
     * /.openclaw/workspace-baiying-agent-{resourceId}/skills/{skillName}/...； 超级助手
     * /.openclaw/workspace/skills/{skillName}/... - 压缩包必须有且仅有一个 SKILL.md；同名 skill 会先清空旧目录再写入。 -
     * userCode 留空时退回当前登录用户。
     */
    @PostMapping(value = "/uploadSkillZip", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseUtil<List<ByClawSkillDto>> uploadSkillZip(
        @Parameter(description = "skill zip 文件，兼容旧版单文件字段", required = false) @RequestParam(value = "file",
            required = false) MultipartFile file,
        @Parameter(description = "skill zip 文件列表", required = false) @RequestParam(value = "files",
            required = false) MultipartFile[] files,
        @Parameter(description = "数字员工资源ID；超级助手可不传") @RequestParam(value = "resourceId",
            required = false) Long resourceId,
        @Parameter(description = "目标用户编码，可选；留空则使用当前登录用户") @RequestParam(value = "userCode",
            required = false) String userCode) {
        try {
            String resolvedUserCode = StringUtils.isNotBlank(userCode) ? userCode
                : CurrentUserHolder.getCurrentUserCode();
            List<MultipartFile> uploadFiles = resolveSkillUploadFiles(file, files);
            byClawSkillResourceApplicationService.validateChatUploadedSkillImportPermission(resourceId, uploadFiles);
            List<ByClawSkillDto> data = byClawSkillUploadApplicationService.uploadSkillZips(resolvedUserCode,
                resourceId, uploadFiles);
            byClawSkillResourceApplicationService.registerChatUploadedSkills(resolvedUserCode, resourceId, uploadFiles,
                data);
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.skill.upload.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("uploadSkillZip failed, userCode={}, resourceId={}", userCode, resourceId, e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("byclaw.skill.upload.failed"));
        }
    }

    private List<MultipartFile> resolveSkillUploadFiles(MultipartFile file, MultipartFile[] files) {
        List<MultipartFile> uploadFiles = new ArrayList<>();
        if (files != null) {
            uploadFiles.addAll(Arrays.asList(files));
        }
        if (file != null) {
            uploadFiles.add(file);
        }
        return uploadFiles;
    }

    /**
     * 下载 skill 目录为 zip。 - 数字员工：skillPath 必须落在 /.openclaw/workspace-baiying-agent-{resourceId}/skills/ 之下。 -
     * 超级助手：skillPath 必须落在 /.openclaw/workspace/skills/ 之下。 - userCode 留空时退回当前登录用户。 - 入参兼容 application/json body 与
     * query/form 两种形式：body 优先，缺失时退到 query 参数。 - 出参为 application/zip 流，文件名形如 {skillName}.zip。 - 失败场景（路径非法 / skill 不存在 /
     * 读对象异常）返回纯文本 400，避免中途出 zip 时再插入 JSON 错误体。
     */
    @RequestMapping(value = "/downloadSkillZip", method = {
        RequestMethod.GET, RequestMethod.POST
    })
    public ResponseEntity<StreamingResponseBody> downloadSkillZip(
        @RequestBody(required = false) DownloadSkillZipQo request,
        @Parameter(description = "技能资源ID；传入后直接下载资源化技能 zip", required = false) @RequestParam(
            value = "skillId", required = false) Long skillId,
        @Parameter(
            description = "skill 目录路径，例如 /.openclaw/workspace-baiying-agent-10000417/skills/fol-auto-biztravel") @RequestParam(
                value = "skillPath", required = false) String skillPath,
        @Parameter(description = "数字员工资源ID；超级助手可不传", required = false) @RequestParam(value = "resourceId",
            required = false) Long resourceId,
        @Parameter(description = "目标用户编码，可选；留空则使用当前登录用户") @RequestParam(value = "userCode",
            required = false) String userCode) {
        // body 优先；body 缺失时再退到 query 参数。两种来源都允许，避免前端必须指定其一。
        String finalSkillPath = request != null && StringUtils.isNotBlank(request.getSkillPath())
            ? request.getSkillPath()
            : skillPath;
        Long finalSkillId = request != null && request.getSkillId() != null ? request.getSkillId() : skillId;
        Long finalResourceId = request != null && request.getResourceId() != null ? request.getResourceId()
            : resourceId;
        String finalUserCode = request != null && StringUtils.isNotBlank(request.getUserCode()) ? request.getUserCode()
            : userCode;
        String resolvedUserCode = StringUtils.isNotBlank(finalUserCode) ? finalUserCode
            : CurrentUserHolder.getCurrentUserCode();
        try {
            logSkillDownloadRequest(resolvedUserCode, finalResourceId, finalSkillId, finalSkillPath);
            if (finalSkillId != null) {
                return downloadManagedSkillZip(finalSkillId);
            }
            if (StringUtils.isBlank(finalSkillPath)) {
                throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.path.invalid"));
            }
            ByClawSkillDownloadApplicationService.SkillZipDownload download = byClawSkillDownloadApplicationService
                .prepare(resolvedUserCode, finalResourceId, finalSkillPath);
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
            logger.error("downloadSkillZip failed, userCode={}, resourceId={}, skillPath={}", resolvedUserCode,
                finalResourceId, finalSkillPath, e);
            String fallbackMsg = StringUtils.defaultIfBlank(e.getMessage(),
                I18nUtil.get("byclaw.skill.download.failed"));
            return ResponseEntity.badRequest().contentType(MediaType.parseMediaType("text/plain; charset=UTF-8"))
                .body(out -> out.write(fallbackMsg.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }
    }

    private void logSkillDownloadRequest(String userCode, Long resourceId, Long skillId, String skillPath) {
        Long digitalEmployeeId = resourceId != null ? resourceId : CurrentUserHolder.getDefaultDigEmployeeId();
        String digitalEmployeeName = "";
        String skillName = StringUtils.defaultIfBlank(lastPathSegment(skillPath), "未知技能");
        String skillCode = "";
        try {
            if (digitalEmployeeId != null) {
                SsResource digitalEmployee = ssResourceService.findById(digitalEmployeeId);
                digitalEmployeeName = digitalEmployee == null ? "" : digitalEmployee.getResourceName();
            }
            if (skillId != null) {
                SsResource skillResource = ssResourceService.findById(skillId);
                if (skillResource != null) {
                    skillName = StringUtils.defaultIfBlank(skillResource.getResourceName(), skillName);
                    skillCode = skillResource.getResourceCode();
                }
            }
        }
        catch (Exception e) {
            // 审计日志的补充查询失败不能阻断技能下载。
            logger.warn("获取技能下载审计信息失败, userCode={}, digitalEmployeeId={}, skillId={}", userCode,
                digitalEmployeeId, skillId, e);
        }
        logger.info("技能下载请求: userCode={}, userName={}, digitalEmployeeId={}, digitalEmployeeName={}, skillId={}, "
                + "skillCode={}, skillName={}, skillPath={}", userCode, CurrentUserHolder.getCurrentUserName(),
            digitalEmployeeId, digitalEmployeeName, skillId, skillCode, skillName, skillPath);
    }

    private ResponseEntity<StreamingResponseBody> downloadManagedSkillZip(Long skillId) {
        SsResExtSkill extSkill = ssResExtSkillService.findById(skillId);
        if (extSkill == null) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.resource.notfound"));
        }
        if (StringUtils.equalsIgnoreCase(extSkill.getSkillType(), SsResExtSkillService.INNER_SKILL_TYPE)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.inner.download.unneeded"));
        }
        String relativePath = stripResourcePrefix(extSkill.getSkillUrl());
        if (StringUtils.isBlank(relativePath)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.package.path.notfound"));
        }
        logger.info("开始下载资源化技能包: skillId={}, skillType={}, skillUrl={}, relativePath={}, originalFilename={}",
            skillId, extSkill.getSkillType(), extSkill.getSkillUrl(), relativePath,
            extSkill.getSkillOriginalFilename());
        boolean packageExists = resourceArtifactStorageService.existsWithinResourceRoot(relativePath);
        if (!packageExists) {
            logger.warn("资源化技能包不存在: skillId={}, skillUrl={}, relativePath={}", skillId, extSkill.getSkillUrl(),
                relativePath);
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.package.file.notfound"));
        }
        String fileName = StringUtils.defaultIfBlank(extSkill.getSkillOriginalFilename(), lastPathSegment(relativePath));
        String encoded = UriUtils.encode(fileName, java.nio.charset.StandardCharsets.UTF_8);
        String contentDisposition = "attachment; filename=\"" + encoded + "\"; filename*=UTF-8''" + encoded;
        StreamingResponseBody body = out -> {
            try (java.io.InputStream in = resourceArtifactStorageService.readWithinResourceRoot(relativePath)) {
                if (in == null) {
                    throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.package.file.notfound"));
                }
                in.transferTo(out);
            }
            catch (java.io.IOException e) {
                logger.error("资源化技能包读取失败: skillId={}, skillUrl={}, relativePath={}", skillId,
                    extSkill.getSkillUrl(), relativePath, e);
                throw e;
            }
            catch (RuntimeException e) {
                logger.error("资源化技能包读取失败: skillId={}, skillUrl={}, relativePath={}", skillId,
                    extSkill.getSkillUrl(), relativePath, e);
                throw e;
            }
        };
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/zip"))
            .header("Content-Disposition", contentDisposition).body(body);
    }

    private String stripResourcePrefix(String objectKey) {
        String normalized = StringUtils.removeStart(StringUtils.defaultString(objectKey), "/");
        normalized = StringUtils.removeStart(normalized, "byclaw/resource/");
        return StringUtils.removeStart(normalized, "resource/");
    }

    private String lastPathSegment(String filename) {
        if (StringUtils.isBlank(filename)) {
            return "";
        }
        String normalized = filename.replace('\\', '/');
        int slashIndex = normalized.lastIndexOf('/');
        return slashIndex >= 0 ? normalized.substring(slashIndex + 1) : normalized;
    }

    /**
     * 删除用户工作空间下的单个 skill 目录。
     * - 数字员工：skillPath 必须落在 /.openclaw/workspace-baiying-agent-{resourceId}/skills/ 之下
     * - 超级助手：skillPath 必须落在 /.openclaw/workspace/skills/ 之下
     * - userCode 留空时退回当前登录用户
     */
    @PostMapping("/deleteSkill")
    public ResponseUtil<ByClawSkillDto> deleteSkill(@RequestBody DeleteSkillQo request) {
        try {
            if (request == null) {
                return ResponseUtil.fail(I18nUtil.get("param.cannot.be.null"));
            }
            String resolvedUserCode = StringUtils.isNotBlank(request.getUserCode()) ? request.getUserCode()
                : CurrentUserHolder.getCurrentUserCode();
            // 删除工作空间技能前，校验当前用户对目标数字员工的管理权限（与绑定技能卸载一致），必须前置于文件删除。
            byClawSkillResourceApplicationService.assertWorkspaceSkillManagePermission(request.getResourceId());
            ByClawSkillDto data = byClawSkillDeleteApplicationService.deleteSkill(resolvedUserCode,
                request.getResourceId(), request.getSkillPath());
            byClawSkillResourceApplicationService.unlinkWorkspaceSkill(resolvedUserCode, request.getResourceId(),
                request.getSkillPath(), data.getSkillName());
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.skill.delete.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("deleteSkill failed, userCode={}, resourceId={}, skillPath={}",
                request == null ? null : request.getUserCode(), request == null ? null : request.getResourceId(),
                request == null ? null : request.getSkillPath(), e);
            return ResponseUtil
                .fail(e.getMessage() != null ? e.getMessage() : I18nUtil.get("byclaw.skill.delete.failed"));
        }
    }

    /**
     * 查询个人 agent tar.gz 档案列表。
     */
    @PostMapping("/qryPersonalAgentArchiveList")
    public ResponseUtil<List<ByClawPersonalAgentArchiveDto>> qryPersonalAgentArchiveList(
        @RequestBody PersonalAgentArchiveQo request) {
        try {
            if (request == null) {
                return ResponseUtil.fail(I18nUtil.get("param.cannot.be.null"));
            }
            String resolvedUserCode = StringUtils.isNotBlank(request.getUserCode()) ? request.getUserCode()
                : CurrentUserHolder.getCurrentUserCode();
            List<ByClawPersonalAgentArchiveDto> data = byClawPersonalAgentArchivApplicationService.queryTarGzList(
                resolvedUserCode, request.getResourceId(), request.getKeyword());
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.personal.agent.archive.list.query.success"),
                data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("qryPersonalAgentArchiveList failed, userCode={}, resourceId={}, keyword={}",
                request == null ? null : request.getUserCode(), request == null ? null : request.getResourceId(),
                request == null ? null : request.getKeyword(), e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage()
                : I18nUtil.get("byclaw.personal.agent.archive.list.query.failed"));
        }
    }

    /**
     * 上传个人 agent tar.gz 档案到 byclaw-{userCode}/by/.personal-agents/{resourceId}/。
     */
    @PostMapping(value = "/uploadPersonalAgentTarGz", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseUtil<ByClawPersonalAgentArchiveDto> uploadPersonalAgentTarGz(
        @Parameter(description = "tar.gz 文件", required = true) @RequestParam("file") MultipartFile file,
        @Parameter(description = "资源ID", required = true) @RequestParam("resourceId") Long resourceId,
        @Parameter(description = "目标用户编码，可选；留空则使用当前登录用户") @RequestParam(value = "userCode",
            required = false) String userCode) {
        try {
            String resolvedUserCode = StringUtils.isNotBlank(userCode) ? userCode
                : CurrentUserHolder.getCurrentUserCode();
            ByClawPersonalAgentArchiveDto data = byClawPersonalAgentArchivApplicationService.uploadTarGz(
                resolvedUserCode, resourceId, file);
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.personal.agent.archive.upload.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("uploadPersonalAgentTarGz failed, userCode={}, resourceId={}", userCode, resourceId, e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage()
                : I18nUtil.get("byclaw.personal.agent.archive.upload.failed"));
        }
    }

    /**
     * 下载个人 agent tar.gz 档案。
     */
    @PostMapping("/downloadPersonalAgentTarGz")
    public ResponseEntity<StreamingResponseBody> downloadPersonalAgentTarGz(
        @RequestBody(required = false) PersonalAgentArchiveQo request,
        @Parameter(description = "tar.gz 文件路径，例如 /.personal-agents/10000417/demo.tar.gz") @RequestParam(
            value = "archivePath", required = false) String archivePath,
        @Parameter(description = "资源ID", required = false) @RequestParam(value = "resourceId",
            required = false) Long resourceId,
        @Parameter(description = "目标用户编码，可选；留空则使用当前登录用户") @RequestParam(value = "userCode",
            required = false) String userCode) {
        String finalArchivePath = request != null && StringUtils.isNotBlank(request.getArchivePath())
            ? request.getArchivePath()
            : archivePath;
        Long finalResourceId = request != null && request.getResourceId() != null ? request.getResourceId()
            : resourceId;
        String finalUserCode = request != null && StringUtils.isNotBlank(request.getUserCode())
            ? request.getUserCode()
            : userCode;
        String resolvedUserCode = StringUtils.isNotBlank(finalUserCode) ? finalUserCode
            : CurrentUserHolder.getCurrentUserCode();
        try {
            ByClawPersonalAgentArchivApplicationService.PersonalAgentTarGzDownload download =
                byClawPersonalAgentArchivApplicationService.prepareDownload(resolvedUserCode, finalResourceId,
                    finalArchivePath);
            String encoded = UriUtils.encode(download.getFileName(), java.nio.charset.StandardCharsets.UTF_8);
            String contentDisposition = "attachment; filename=\"" + encoded + "\"; filename*=UTF-8''" + encoded;
            return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/gzip"))
                .header("Content-Disposition", contentDisposition).body(download.getBody());
        }
        catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().contentType(MediaType.parseMediaType("text/plain; charset=UTF-8"))
                .body(out -> out.write(e.getMessage().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }
        catch (Exception e) {
            logger.error("downloadPersonalAgentTarGz failed, userCode={}, resourceId={}, archivePath={}",
                resolvedUserCode, finalResourceId, finalArchivePath, e);
            String fallbackMsg = StringUtils.defaultIfBlank(e.getMessage(),
                I18nUtil.get("byclaw.personal.agent.archive.download.failed"));
            return ResponseEntity.badRequest().contentType(MediaType.parseMediaType("text/plain; charset=UTF-8"))
                .body(out -> out.write(fallbackMsg.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }
    }

    /**
     * 删除个人 agent tar.gz 档案。
     */
    @PostMapping("/deletePersonalAgentTarGz")
    public ResponseUtil<ByClawPersonalAgentArchiveDto> deletePersonalAgentTarGz(
        @RequestBody PersonalAgentArchiveQo request) {
        try {
            if (request == null) {
                return ResponseUtil.fail(I18nUtil.get("param.cannot.be.null"));
            }
            String resolvedUserCode = StringUtils.isNotBlank(request.getUserCode()) ? request.getUserCode()
                : CurrentUserHolder.getCurrentUserCode();
            ByClawPersonalAgentArchiveDto data = byClawPersonalAgentArchivApplicationService.deleteTarGz(
                resolvedUserCode, request.getResourceId(), request.getArchivePath());
            return ResponseUtil.successResponse(I18nUtil.get("byclaw.personal.agent.archive.delete.success"), data);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (BdpRuntimeException e) {
            return ResponseUtil.fail(e.getMessage());
        }
        catch (Exception e) {
            logger.error("deletePersonalAgentTarGz failed, userCode={}, resourceId={}, archivePath={}",
                request == null ? null : request.getUserCode(), request == null ? null : request.getResourceId(),
                request == null ? null : request.getArchivePath(), e);
            return ResponseUtil.fail(e.getMessage() != null ? e.getMessage()
                : I18nUtil.get("byclaw.personal.agent.archive.delete.failed"));
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
