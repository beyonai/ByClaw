package com.iwhalecloud.byai.state.interfaces.controller.openapi;

import com.iwhalecloud.byai.ByaiServerApplication;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.constants.superassist.SessionType;
import com.iwhalecloud.byai.common.feign.request.manager.ResourceOperQo;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import com.iwhalecloud.byai.manager.application.service.openapi.OpenResourceApplicationService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.resource.SsResourceRelDetailDTO;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.resource.DirAndFileQo;
import com.iwhalecloud.byai.manager.qo.resource.ResourceQo;
import com.iwhalecloud.byai.manager.vo.resource.DirAndFileVo;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.domain.resource.qo.OpenApiDigEmployeeQueryQo;
import com.iwhalecloud.byai.state.domain.resource.qo.OpenApiDigEmployeeSkillQo;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceApplicationService;
import io.swagger.v3.oas.annotations.Parameter;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-08-16 10:36:13
 * @description 资源对外开放接口
 */
@RestController
@RequestMapping("/open/api")
@Slf4j
public class OpenApiResourceController {

    private static final Logger logger = LoggerFactory.getLogger(OpenApiResourceController.class);

    @Autowired
    private DatasetApplicationService datasetApplicationService;

    @Autowired
    private ResourceApplicationService resourceApplicationService;

    @Autowired
    private OpenResourceApplicationService openResourceApplicationService;

    @Autowired
    private AssistantChatApplicationService assistantChatApplicationService;

    @Autowired
    private FilesApplicationService filesApplicationService;

    @PostMapping("/v1/getResourceListByPage")
    @ManageLogAnnotation(name = "会话API调用", description = "分页查询资源列表")
    public ResponseUtil getResourceListByPage(@RequestBody ResourceOperQo resourceQo) {
        return ResponseUtil.successResponse(resourceApplicationService.getPageList(resourceQo));
    }

    /**
     * 数字员工列表查询（免登录） 入参：数字员工类型（001-助手、005-问答、006-问数）、数字员工名称（模糊查询） 出参：数字员工详情列表
     */
    @PostMapping("/v1/queryDigEmployeeList")
    @ManageLogAnnotation(name = "会话API调用", description = "查询数字员工列表(免登录)")
    public ResponseUtil<List<DigitalEmployeeDetailsDTO>> queryDigEmployeeList(
        @RequestBody OpenApiDigEmployeeQueryQo qo) {
        try {
            List<DigitalEmployeeDetailsDTO> list = resourceApplicationService
                .queryDigEmployeeListForOpenApi(qo.getAgentType(), qo.getResourceName());
            return ResponseUtil.successResponse(list);
        }
        catch (Exception e) {
            log.error("查询数字员工列表异常", e);
            return ResponseUtil.fail("查询数字员工列表失败：" + e.getMessage());
        }
    }

    /**
     * 数字员工详情查询（免登录） 入参：数字员工ID 出参：数字员工详情信息
     */
    @PostMapping("/v1/queryDigEmployeeDetail")
    @ManageLogAnnotation(name = "会话API调用", description = "查询数字员工详情(免登录)")
    public ResponseUtil<DigitalEmployeeDetailsDTO> queryDigEmployeeDetail(@RequestBody OpenApiDigEmployeeSkillQo qo) {
        try {
            if (qo.getResourceId() == null) {
                return ResponseUtil.fail("数字员工ID不能为空");
            }
            DigitalEmployeeDetailsDTO detail = resourceApplicationService
                .queryDigEmployeeDetailForOpenApi(qo.getResourceId());
            if (detail == null) {
                return ResponseUtil.fail("未找到对应的数字员工");
            }
            return ResponseUtil.successResponse(detail);
        }
        catch (Exception e) {
            log.error("查询数字员工详情异常, resourceId={}", qo.getResourceId(), e);
            return ResponseUtil.fail("查询数字员工详情失败：" + e.getMessage());
        }
    }

    /**
     * 数字员工技能查询（免登录） 入参：数字员工ID、技能类型（可空） 出参：数字员工的技能列表
     */
    @PostMapping("/v1/queryDigEmployeeSkills")
    @ManageLogAnnotation(name = "会话API调用", description = "查询数字员工技能(免登录)")
    public ResponseUtil<List<SsResourceRelDetailDTO>> queryDigEmployeeSkills(
        @RequestBody OpenApiDigEmployeeSkillQo qo) {
        try {
            if (qo.getResourceId() == null) {
                return ResponseUtil.fail("数字员工ID不能为空");
            }
            List<SsResourceRelDetailDTO> skills = resourceApplicationService
                .queryDigEmployeeSkillsForOpenApi(qo.getResourceId(), qo.getResourceBizType());
            return ResponseUtil.successResponse(skills);
        }
        catch (Exception e) {
            log.error("查询数字员工技能异常, resourceId={}", qo.getResourceId(), e);
            return ResponseUtil.fail("查询数字员工技能失败：" + e.getMessage());
        }
    }

    /**
     * 获取当前用户授权信息
     *
     * @param resourceQo 查询对象
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "获取用户授权资源")
    @PostMapping("/v1/getUserAuthResource")
    public ResponseUtil<PageInfo<SsResource>> getUserAuthResource(@RequestBody ResourceQo resourceQo) {
        PageInfo<SsResource> pageVO = openResourceApplicationService.getUserAuthResource(resourceQo);
        return ResponseUtil.successResponse(pageVO);
    }

    /**
     * 列出知识库文件
     *
     * @param dirAndFileQo 入参
     * @return ResponseUtil
     */
    @PostMapping("/v1/dataset/listDir")
    public ResponseUtil<List<DirAndFileVo>> listDirAndFile(@RequestBody DirAndFileQo dirAndFileQo) {
        List<DirAndFileVo> dirAndFileVos = datasetApplicationService.queryDirAndFileByLevel(dirAndFileQo);
        return ResponseUtil.successResponse(I18nUtil.get("dataset.dir.file.query.success"), dirAndFileVos);
    }

    /**
     * 上传文件到工作空间
     *
     * @param files 文件名
     * @param sessionId 会话标识
     * @param sessionType 会话类型
     * @param agentId 智能体标识
     * @return ResponseUtil
     */
    @PostMapping("/v1/uploadFileToWorkSpace")
    public ResponseUtil<UploadResult> uploadFiles(
        @Parameter(description = "要上传的文件列表", required = true) @RequestParam("files") MultipartFile[] files,
        @Parameter(description = "会话ID，可选") @RequestParam(value = "sessionId", required = false) Long sessionId,
        @Parameter(description = "会话类型，可选") @RequestParam(value = "sessionType", required = false,
            defaultValue = SessionType.SUPER_AGENT) String sessionType,
        @Parameter(description = "数字员工，可选") @RequestParam(value = "agentId", required = false) Long agentId) {
        try {
            UploadResult uploadResult = assistantChatApplicationService.uploadFiles(files, sessionId, sessionType,
                agentId);
            return ResponseUtil.success(uploadResult);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return ResponseUtil.fail(e.getMessage());
        }
    }

    /**
     * 工作空间文件下载
     *
     * @param response 响应流
     * @param fileId 文件标识
     */
    @GetMapping(path = "/v1/downloadFromWorkSpace")
    public void downloadFromWorkSpace(HttpServletResponse response, @RequestParam("fileId") Long fileId) {
        filesApplicationService.download(response, fileId);
    }
}
