package com.iwhalecloud.byai.manager.application.service.system;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFilePathResolver;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFileStorage;
import com.iwhalecloud.byai.manager.dto.system.SystemFeedbackStatusUpdateDTO;
import com.iwhalecloud.byai.manager.qo.system.SystemFeedbackQueryQo;
import com.iwhalecloud.byai.manager.vo.system.SystemFeedbackAttachmentVo;
import com.iwhalecloud.byai.manager.vo.system.SystemFeedbackManageVo;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.commons.io.IOUtils;
import org.apache.commons.lang3.StringUtils;
import org.apache.http.client.utils.DateUtils;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.VerticalAlignment;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import com.iwhalecloud.byai.manager.domain.system.service.AttachFileService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.domain.system.service.SystemFeedbackService;
import com.iwhalecloud.byai.manager.dto.system.SystemFeedbackDTO;
import com.iwhalecloud.byai.manager.entity.system.AttachFile;
import com.iwhalecloud.byai.manager.entity.system.SystemFeedback;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.IpUtil;
import jakarta.servlet.http.HttpServletRequest;

/**
 * @author he.duming
 * @date 2025-08-19 19:47:38
 * @description TODO
 */
@Service
public class SystemFeedbackApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(SystemFeedbackApplicationService.class);

    private static final String FEEDBACK_TABLE_NAME = "byai_system_feedback";

    private static final String ACTIVE_ATTACHMENT_STATE = "00A";

    private static final int MAX_PAGE_SIZE = 100;

    private static final int MAX_EXPORT_COUNT = 10000;

    private static final String STATUS_PENDING = "pending";

    private static final String STATUS_PROCESSING = "processing";

    private static final String STATUS_RESOLVED = "resolved";

    private static final String STATUS_CLOSED = "closed";

    private static final Set<String> FEEDBACK_STATUSES =
        Set.of(STATUS_PENDING, STATUS_PROCESSING, STATUS_RESOLVED, STATUS_CLOSED);

    private static final Map<String, Set<String>> STATUS_TRANSITIONS = Map.of(
        STATUS_PENDING, Set.of(STATUS_PROCESSING, STATUS_CLOSED),
        STATUS_PROCESSING, Set.of(STATUS_RESOLVED, STATUS_CLOSED),
        STATUS_RESOLVED, Set.of(STATUS_PROCESSING, STATUS_CLOSED),
        STATUS_CLOSED, Collections.emptySet());

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private SystemFeedbackService systemFeedbackService;

    @Autowired
    private AttachFileService attachFileService;

    @Autowired
    private CommonFileStorage commonFileStorage;

    @Autowired
    private CommonFilePathResolver commonFilePathResolver;

    /**
     * 保存系统反馈信息
     *
     * @param systemFeedbackDTO 反馈信息
     */
    @Transactional(rollbackFor = Exception.class)
    public void save(HttpServletRequest request, SystemFeedbackDTO systemFeedbackDTO) {

        SystemFeedback systemFeedback = new SystemFeedback();
        BeanUtils.copyProperties(systemFeedbackDTO, systemFeedback);
        systemFeedback.setId(sequenceService.nextVal());
        systemFeedback.setUserId(CurrentUserHolder.getCurrentUserId());
        systemFeedback.setCreateDate(new Date());
        systemFeedback.setStatus(STATUS_PENDING);
        systemFeedback.setIpAddress(IpUtil.getIpAddress(request));
        systemFeedback.setDeviceInfo(request.getHeader("User-Agent"));
        systemFeedback.setContactInfo(CurrentUserHolder.getEmail());
        systemFeedbackService.save(systemFeedback);

        bindFeedbackAttachments(systemFeedback.getId(), systemFeedbackDTO.getAttachFileIds());
    }

    /**
     * 上传文件反馈信息
     *
     * @param files 上传的文件
     * @return ResponseUtil
     */
    public Map<String, Object> uploadFeedbackFile(MultipartFile[] files) throws IOException {

        Map<String, Object> resultMap = new HashMap<>();

        List<Map<String, Object>> successFiles = new ArrayList<>(10);

        for (MultipartFile multipartFile : files) {

            // 提取文件信息
            String contentType = multipartFile.getContentType();
            String fileName = multipartFile.getOriginalFilename();
            String fileLocation = "/" + CurrentUserHolder.getCurrentUserCode() + "/" + fileName;
            byte[] bytes = multipartFile.getBytes();

            commonFileStorage.write(commonFilePathResolver.feedback(fileLocation), bytes, contentType);

            // 保存文件信息
            Long fileId = sequenceService.nextVal();
            AttachFile attachFile = new AttachFile();
            attachFile.setAttachFileId(fileId);
            attachFile.setFileName(fileName);
            attachFile.setFileType(contentType);
            attachFile.setFileLocation(fileLocation);
            attachFile.setSourceFileId(fileId);
            attachFile.setTableName("byai_system_feedback");
            attachFile.setTablePkName("id");
            attachFile.setTableFieldName("id");
            attachFile.setCreateDate(new Date());
            attachFile.setCreateUserId(CurrentUserHolder.getCurrentUserId());
            attachFileService.save(attachFile);

            // 设置文件返回属性
            Map<String, Object> objectMap = new HashMap<>();
            objectMap.put("attachFileId", attachFile.getAttachFileId());
            objectMap.put("fileId", attachFile.getAttachFileId());
            objectMap.put("fileName", attachFile.getFileName());
            objectMap.put("tags", "feedback");
            objectMap.put("uploadDate", DateUtils.formatDate(attachFile.getCreateDate()));
            successFiles.add(objectMap);
        }

        resultMap.put("successFiles", successFiles);
        return resultMap;
    }

    /**
     * 分页查询系统反馈管理列表。
     *
     * @param qo 查询条件
     * @return 系统反馈分页结果
     */
    public PageInfo<SystemFeedbackManageVo> queryManageList(SystemFeedbackQueryQo qo) {
        ensureFeedbackManagePermission();
        SystemFeedbackQueryQo safeQo = qo == null ? new SystemFeedbackQueryQo() : qo;
        int pageNum = Math.max(1, Objects.requireNonNullElse(safeQo.getPageNum(), 1));
        int pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Objects.requireNonNullElse(safeQo.getPageSize(), 10)));
        PageHelper.startPage(pageNum, pageSize);
        List<SystemFeedbackManageVo> feedbackList = systemFeedbackService.selectManageList(safeQo);
        com.github.pagehelper.PageInfo<SystemFeedbackManageVo> helperPage =
            new com.github.pagehelper.PageInfo<>(feedbackList);
        return PageHelperUtil.toPageInfo(helperPage);
    }

    /**
     * 查询系统反馈详情及附件。
     *
     * @param feedbackId 反馈ID
     * @return 系统反馈详情
     */
    public SystemFeedbackManageVo queryManageDetail(Long feedbackId) {
        ensureFeedbackManagePermission();
        if (feedbackId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("systemfeedback.manage.id.notempty"));
        }
        SystemFeedbackManageVo feedback = systemFeedbackService.selectManageDetail(feedbackId);
        if (feedback == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("systemfeedback.manage.notfound"));
        }
        List<AttachFile> files = attachFileService.findFeedbackAttachments(Collections.singleton(feedbackId));
        feedback.setAttachments(files.stream().map(this::toAttachmentVo).toList());
        return feedback;
    }

    /**
     * 按约定的状态机流转反馈状态，并记录本次处理信息。
     *
     * @param dto 状态流转参数
     * @return 更新后的反馈详情
     */
    @Transactional(rollbackFor = Exception.class)
    public SystemFeedbackManageVo updateManageStatus(SystemFeedbackStatusUpdateDTO dto) {
        ensureFeedbackManagePermission();
        SystemFeedbackManageVo existing = systemFeedbackService.selectManageDetail(dto.getFeedbackId());
        if (existing == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("systemfeedback.manage.notfound"));
        }

        String currentStatus = StringUtils.defaultIfBlank(existing.getStatus(), STATUS_PENDING).toLowerCase();
        String targetStatus = StringUtils.trimToEmpty(dto.getStatus()).toLowerCase();
        if (!FEEDBACK_STATUSES.contains(targetStatus)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("systemfeedback.manage.status.invalid"));
        }
        if (!STATUS_TRANSITIONS.getOrDefault(currentStatus, Collections.emptySet()).contains(targetStatus)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("systemfeedback.manage.status.transition.invalid"));
        }

        Date processDate = new Date();
        SystemFeedback update = new SystemFeedback();
        update.setId(existing.getId());
        update.setStatus(targetStatus);
        update.setProcessUserId(CurrentUserHolder.getCurrentUserId());
        update.setProcessDate(processDate);
        update.setUpdateDate(processDate);
        update.setProcessComment(StringUtils.trimToNull(dto.getProcessComment()));
        if (!systemFeedbackService.updateById(update)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("systemfeedback.manage.status.update.failed"));
        }
        return queryManageDetail(existing.getId());
    }

    /**
     * 预览或下载系统反馈附件。
     *
     * @param response HTTP响应
     * @param attachFileId 附件ID
     * @param download 是否以下载方式响应
     */
    public void writeFeedbackAttachment(HttpServletResponse response, Long attachFileId, boolean download) {
        ensureFeedbackManagePermission();
        AttachFile attachFile = loadValidFeedbackAttachment(attachFileId);
        String dispositionType = download ? "attachment" : "inline";
        String encodedFileName = URLEncoder.encode(StringUtils.defaultString(attachFile.getFileName(), "attachment"),
            StandardCharsets.UTF_8).replace("+", "%20");
        response.setContentType(StringUtils.defaultIfBlank(attachFile.getFileType(), "application/octet-stream"));
        response.setHeader("Content-Disposition",
            dispositionType + "; filename*=UTF-8''" + encodedFileName);

        try (InputStream inputStream =
            commonFileStorage.read(commonFilePathResolver.feedback(attachFile.getFileLocation()))) {
            IOUtils.copy(inputStream, response.getOutputStream());
        }
        catch (Exception e) {
            logger.error("读取系统反馈附件失败, attachFileId={}, fileLocation={}", attachFileId,
                attachFile.getFileLocation(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("systemfeedback.manage.attachment.read.failed"));
        }
    }

    /**
     * 按当前查询条件导出系统反馈列表。
     *
     * @param response HTTP响应
     * @param qo 查询条件
     */
    public void exportManageList(HttpServletResponse response, SystemFeedbackQueryQo qo) {
        ensureFeedbackManagePermission();
        SystemFeedbackQueryQo safeQo = qo == null ? new SystemFeedbackQueryQo() : qo;
        PageHelper.startPage(1, MAX_EXPORT_COUNT);
        List<SystemFeedbackManageVo> feedbackList = systemFeedbackService.selectManageList(safeQo);
        Map<Long, List<AttachFile>> attachmentMap = loadAttachmentMap(
            feedbackList.stream().map(SystemFeedbackManageVo::getId).filter(Objects::nonNull).toList());

        try (Workbook workbook = new XSSFWorkbook()) {
            Sheet sheet = workbook.createSheet(I18nUtil.get("systemfeedback.manage.excel.sheet"));
            CellStyle headerStyle = createExcelHeaderStyle(workbook);
            CellStyle dataStyle = createExcelDataStyle(workbook);
            writeExcelHeader(sheet, headerStyle);
            writeExcelRows(sheet, dataStyle, feedbackList, attachmentMap);
            setExcelColumnWidths(sheet);
            setExcelResponseHeaders(response);
            workbook.write(response.getOutputStream());
        }
        catch (IOException e) {
            logger.error("导出系统反馈Excel失败", e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("systemfeedback.manage.export.failed"));
        }
    }

    private AttachFile loadValidFeedbackAttachment(Long attachFileId) {
        if (attachFileId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("systemfeedback.manage.attachment.id.notempty"));
        }
        AttachFile attachFile = attachFileService.selectById(attachFileId);
        boolean valid = attachFile != null
            && FEEDBACK_TABLE_NAME.equals(attachFile.getTableName())
            && ACTIVE_ATTACHMENT_STATE.equals(attachFile.getState())
            && attachFile.getTablePkValue() != null
            && systemFeedbackService.selectManageDetail(attachFile.getTablePkValue()) != null;
        if (!valid) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("systemfeedback.manage.attachment.notfound"));
        }
        return attachFile;
    }

    private void bindFeedbackAttachments(Long feedbackId, List<Long> attachFileIds) {
        if (attachFileIds == null || attachFileIds.isEmpty()) {
            return;
        }
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        for (Long attachFileId : attachFileIds.stream().filter(Objects::nonNull).distinct().toList()) {
            AttachFile attachFile = attachFileService.selectById(attachFileId);
            boolean canBind = attachFile != null
                && FEEDBACK_TABLE_NAME.equals(attachFile.getTableName())
                && Objects.equals(currentUserId, attachFile.getCreateUserId())
                && attachFile.getTablePkValue() == null;
            if (!canBind) {
                logger.warn("系统反馈附件绑定失败, feedbackId={}, attachFileId={}, currentUserId={}",
                    feedbackId, attachFileId, currentUserId);
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                    I18nUtil.get("systemfeedback.attachment.bind.invalid"));
            }
            attachFile.setState(ACTIVE_ATTACHMENT_STATE);
            attachFile.setTablePkValue(feedbackId);
            attachFileService.update(attachFile);
        }
    }

    private SystemFeedbackAttachmentVo toAttachmentVo(AttachFile attachFile) {
        SystemFeedbackAttachmentVo vo = new SystemFeedbackAttachmentVo();
        BeanUtils.copyProperties(attachFile, vo);
        return vo;
    }

    private Map<Long, List<AttachFile>> loadAttachmentMap(Collection<Long> feedbackIds) {
        return attachFileService.findFeedbackAttachments(feedbackIds).stream()
            .collect(Collectors.groupingBy(AttachFile::getTablePkValue));
    }

    private void ensureFeedbackManagePermission() {
        boolean hasPermission = CurrentUserHolder.isPlatformAdminOrOperator()
            || CurrentUserHolder.isOrganizationAdmin()
            || CurrentUserHolder.isBusinessAdmin()
            || "adminvip".equalsIgnoreCase(CurrentUserHolder.getCurrentUserCode());
        if (!hasPermission) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("systemfeedback.manage.permission.denied"));
        }
    }

    private void writeExcelHeader(Sheet sheet, CellStyle style) {
        String[] headers = {
            "systemfeedback.manage.excel.index",
            "systemfeedback.manage.excel.type",
            "systemfeedback.manage.excel.title",
            "systemfeedback.manage.excel.content",
            "systemfeedback.manage.excel.user",
            "systemfeedback.manage.excel.contact",
            "systemfeedback.manage.excel.status",
            "systemfeedback.manage.excel.version",
            "systemfeedback.manage.excel.device",
            "systemfeedback.manage.excel.ip",
            "systemfeedback.manage.excel.attachments",
            "systemfeedback.manage.excel.createTime"
        };
        Row row = sheet.createRow(0);
        for (int i = 0; i < headers.length; i++) {
            createExcelCell(row, i, I18nUtil.get(headers[i]), style);
        }
    }

    private void writeExcelRows(Sheet sheet, CellStyle style, List<SystemFeedbackManageVo> feedbackList,
        Map<Long, List<AttachFile>> attachmentMap) {
        SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        for (int i = 0; i < feedbackList.size(); i++) {
            SystemFeedbackManageVo feedback = feedbackList.get(i);
            Row row = sheet.createRow(i + 1);
            List<AttachFile> attachments = attachmentMap.getOrDefault(feedback.getId(), Collections.emptyList());
            String attachmentPaths = attachments.stream().map(this::buildFeedbackAttachmentPath)
                .filter(StringUtils::isNotBlank).collect(Collectors.joining(System.lineSeparator()));

            createExcelCell(row, 0, String.valueOf(i + 1), style);
            createExcelCell(row, 1, getFeedbackTypeName(feedback.getFeedbackType()), style);
            createExcelCell(row, 2, feedback.getTitle(), style);
            createExcelCell(row, 3, feedback.getContent(), style);
            createExcelCell(row, 4, feedback.getUserName(), style);
            createExcelCell(row, 5, feedback.getContactInfo(), style);
            createExcelCell(row, 6, getFeedbackStatusName(feedback.getStatus()), style);
            createExcelCell(row, 7, feedback.getSystemVersion(), style);
            createExcelCell(row, 8, feedback.getDeviceInfo(), style);
            createExcelCell(row, 9, feedback.getIpAddress(), style);
            createExcelCell(row, 10, attachmentPaths, style);
            createExcelCell(row, 11,
                feedback.getCreateDate() == null ? "" : dateFormat.format(feedback.getCreateDate()), style);
        }
    }

    private String getFeedbackTypeName(String feedbackType) {
        if (StringUtils.isBlank(feedbackType)) {
            return "";
        }
        String normalized = feedbackType.toLowerCase();
        if (List.of("bug", "suggestion", "inquiry", "other").contains(normalized)) {
            return I18nUtil.get("systemfeedback.manage.type." + normalized);
        }
        return feedbackType;
    }

    /**
     * Exports a stable logical path rather than a storage-server path so the
     * exported value is valid for MinIO, SFTP, and local storage deployments.
     */
    private String buildFeedbackAttachmentPath(AttachFile attachment) {
        if (attachment == null || StringUtils.isBlank(attachment.getFileLocation())) {
            return "";
        }
        String location = attachment.getFileLocation().trim().replace('\\', '/').replaceAll("/+", "/");
        if (!location.startsWith("/")) {
            location = "/" + location;
        }
        return "/" + Constants.BUCKET_NAME_FEEDBACK + location;
    }

    private String getFeedbackStatusName(String status) {
        if (StringUtils.isBlank(status)) {
            return "";
        }
        String normalized = status.toLowerCase();
        if (FEEDBACK_STATUSES.contains(normalized)) {
            return I18nUtil.get("systemfeedback.manage.status." + normalized);
        }
        return status;
    }

    private CellStyle createExcelHeaderStyle(Workbook workbook) {
        CellStyle style = workbook.createCellStyle();
        Font font = workbook.createFont();
        font.setBold(true);
        style.setFont(font);
        style.setAlignment(HorizontalAlignment.CENTER);
        style.setVerticalAlignment(VerticalAlignment.CENTER);
        style.setFillForegroundColor(IndexedColors.GREY_25_PERCENT.getIndex());
        style.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        applyExcelBorders(style);
        return style;
    }

    private CellStyle createExcelDataStyle(Workbook workbook) {
        CellStyle style = workbook.createCellStyle();
        style.setVerticalAlignment(VerticalAlignment.CENTER);
        style.setWrapText(true);
        applyExcelBorders(style);
        return style;
    }

    private void applyExcelBorders(CellStyle style) {
        style.setBorderTop(BorderStyle.THIN);
        style.setBorderBottom(BorderStyle.THIN);
        style.setBorderLeft(BorderStyle.THIN);
        style.setBorderRight(BorderStyle.THIN);
    }

    private void createExcelCell(Row row, int columnIndex, String value, CellStyle style) {
        Cell cell = row.createCell(columnIndex);
        cell.setCellValue(StringUtils.defaultString(value));
        cell.setCellStyle(style);
    }

    private void setExcelColumnWidths(Sheet sheet) {
        int[] widths = {8, 14, 28, 50, 18, 24, 14, 16, 40, 18, 58, 22};
        for (int i = 0; i < widths.length; i++) {
            sheet.setColumnWidth(i, widths[i] * 256);
        }
    }

    private void setExcelResponseHeaders(HttpServletResponse response) {
        String fileName = I18nUtil.get("systemfeedback.manage.excel.file") + ".xlsx";
        String encodedFileName = URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");
        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition",
            "attachment; filename*=UTF-8''" + encodedFileName);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
    }
}
