package com.iwhalecloud.byai.manager.interfaces.controller.system;

import com.iwhalecloud.byai.manager.application.service.system.SystemFeedbackApplicationService;
import com.iwhalecloud.byai.manager.dto.system.SystemFeedbackDTO;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.qo.system.SystemFeedbackQueryQo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.vo.system.SystemFeedbackManageVo;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import java.util.Map;

/**
 * @author he.duming
 * @date 2025-08-19 19:48:13
 * @description TODO
 */

@RestController
@RequestMapping("/system/feedback")
public class SystemFeedbackController {

    private static final Logger logger = LoggerFactory.getLogger(SystemFeedbackController.class);

    @Autowired
    private SystemFeedbackApplicationService systemFeedbackApplicationService;

    /**
     * 保存系统反馈信息
     *
     * @param systemFeedbackDTO 反馈信息
     * @return ResponseUtil
     */
    @RequestMapping(value = "/save", method = RequestMethod.POST)
    public ResponseUtil<String> save(HttpServletRequest request,
        @Validated(Add.class) @RequestBody SystemFeedbackDTO systemFeedbackDTO) {
        systemFeedbackApplicationService.save(request, systemFeedbackDTO);
        return ResponseUtil.success("OK");
    }

    /**
     * 上传文件反馈信息
     *
     * @param files 上传的文档
     * @return ResponseUtil
     */
    @RequestMapping(value = "/uploadFeedbackFile", method = RequestMethod.POST,
        produces = "application/json;charset=UTF-8", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseUtil<Map<String, Object>> uploadFeedbackFile(@RequestPart("files") MultipartFile[] files) {
        try {
            Map<String, Object> resultMap = systemFeedbackApplicationService.uploadFeedbackFile(files);
            return ResponseUtil.successResponse(resultMap);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return ResponseUtil.fail(e.getMessage());
        }
    }

    /**
     * 分页查询系统反馈管理列表。
     *
     * @param qo 查询条件
     * @return 系统反馈分页结果
     */
    @PostMapping("/manage/list")
    @ManageLogAnnotation(name = "系统反馈管理", description = "查询系统反馈列表")
    public ResponseUtil<PageInfo<SystemFeedbackManageVo>> queryManageList(
        @RequestBody(required = false) SystemFeedbackQueryQo qo) {
        return ResponseUtil.successResponse(I18nUtil.get("systemfeedback.manage.query.success"),
            systemFeedbackApplicationService.queryManageList(qo));
    }

    /**
     * 查询系统反馈详情。
     *
     * @param feedbackId 反馈ID
     * @return 系统反馈详情
     */
    @GetMapping("/manage/detail")
    @ManageLogAnnotation(name = "系统反馈管理", description = "查询系统反馈详情")
    public ResponseUtil<SystemFeedbackManageVo> queryManageDetail(@RequestParam("feedbackId") Long feedbackId) {
        return ResponseUtil.successResponse(I18nUtil.get("systemfeedback.manage.detail.success"),
            systemFeedbackApplicationService.queryManageDetail(feedbackId));
    }

    /**
     * 预览或下载系统反馈附件。
     *
     * @param response HTTP响应
     * @param attachFileId 附件ID
     * @param download true-下载，false-在线预览
     */
    @GetMapping("/manage/attachment")
    @ManageLogAnnotation(name = "系统反馈管理", description = "查看系统反馈附件")
    public void writeFeedbackAttachment(HttpServletResponse response,
        @RequestParam("attachFileId") Long attachFileId,
        @RequestParam(value = "download", defaultValue = "false") boolean download) {
        systemFeedbackApplicationService.writeFeedbackAttachment(response, attachFileId, download);
    }

    /**
     * 导出系统反馈查询结果。
     *
     * @param response HTTP响应
     * @param qo 查询条件
     */
    @PostMapping("/manage/export")
    @ManageLogAnnotation(name = "系统反馈管理", description = "导出系统反馈列表")
    public void exportManageList(HttpServletResponse response,
        @RequestBody(required = false) SystemFeedbackQueryQo qo) {
        systemFeedbackApplicationService.exportManageList(response, qo);
    }
}
