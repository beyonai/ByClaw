package com.iwhalecloud.byai.manager.application.service.conversation;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

import com.iwhalecloud.byai.manager.domain.staticdata.service.ByaiSystemConfigListService;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import org.apache.commons.collections4.CollectionUtils;
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
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.stereotype.Service;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.dto.conversation.MessageDto;
import com.iwhalecloud.byai.manager.qo.conversation.MessageQo;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.constants.Constants;
import jakarta.servlet.http.HttpServletResponse;

/**
 * 对话消息导出服务 负责处理对话消息的Excel导出功能
 */
@Service
public class ConversationExportService {

    private static final Logger logger = LoggerFactory.getLogger(ConversationExportService.class);


    @Autowired
    private ConversationService conversationService;

    @Autowired
    private ByaiSystemConfigListService byaiSystemConfigListService;

    /**
     * 导出对话消息列表到Excel
     * 
     * @param httpServletResponse HTTP响应对象
     * @param messageQo 查询参数（与列表查询保持一致）
     */
    public void exportMessageList(HttpServletResponse httpServletResponse, MessageQo messageQo) {
        try (Workbook workbook = new XSSFWorkbook()) {
            // 创建Excel工作表
            Sheet sheet = workbook.createSheet(getSheetNameByLanguage());

            logger.info("开始导出对话消息Excel，参数：{}", JSON.toJSONString(messageQo));

            // 获取导出数据（设置最大导出条数，默认8000条
            Integer maxExportCount = 8000; // 可以从配置或参数中获取
            List<MessageDto> messageList = getExportMessageList(messageQo, maxExportCount);

            if (messageList.isEmpty()) {
                logger.info("没有数据需要导出");
                return;
            }

            // 创建样式
            CellStyle titleStyle = createTitleStyle(workbook);
            CellStyle headerStyle = createHeaderStyle(workbook);
            CellStyle dataStyle = createDataStyle(workbook);

            // 创建标题行
            int currentRow = createTitleRow(sheet, titleStyle, 0);

            // 创建表头行
            currentRow = createHeaderRow(sheet, headerStyle, currentRow);

            // 填充数据行
            fillDataRows(sheet, dataStyle, messageList, currentRow);

            // 设置列宽
            setColumnWidths(sheet);

            // 设置响应头
            setResponseHeaders(httpServletResponse);

            // 写入响应头
            workbook.write(httpServletResponse.getOutputStream());

            logger.info("导出完成，总共导出{}条数据", messageList.size());

        }
        catch (Exception e) {
            logger.error("导出Excel失败", e);
            throw new BaseException(I18nUtil.get("conversation.export.excel.failed", e.getMessage()), e);
        }
    }

    /**
     * 获取导出消息列表（分页查询）
     */
    private List<MessageDto> getExportMessageList(MessageQo messageQo, Integer maxCount) {
        List<MessageDto> allMessageList = new ArrayList<>();
        int pageSize = 1000; // 每页最多1000条
        int currentPage = 1;
        int totalFetched = 0;

        logger.info("开始分页导出对话数据，最大导出条数：{}", maxCount);

        // 分页查询数据
        while (totalFetched < maxCount) {
            int currentPageSize = Math.min(pageSize, maxCount - totalFetched);

            // 创建分页查询参数
            MessageQo pageMessageQo = new MessageQo();
            BeanUtils.copyProperties(messageQo, pageMessageQo);
            pageMessageQo.setPageIndex(currentPage);
            pageMessageQo.setPageSize(currentPageSize);

            logger.info("导出查询第{}页，每页{}条", currentPage, currentPageSize);

            try {
                // 直接使用ConversationService的getMessageList方法
                Map<String, Object> res = conversationService.getMessageList(pageMessageQo);
                List<MessageDto> pageMessageList = (List<MessageDto>) res.get("list");

                if (pageMessageList == null || pageMessageList.isEmpty()) {
                    logger.info("第{}页没有数据，导出结束", currentPage);
                    break;
                }

                allMessageList.addAll(pageMessageList);
                totalFetched += pageMessageList.size();

                logger.info("第{}页获取到{}条数据，累计{}条", currentPage, pageMessageList.size(), totalFetched);

                // 如果返回的数据少于请求的数量，说明已经是最后一页
                if (pageMessageList.size() < currentPageSize) {
                    logger.info("当前页数据少于请求条数，已到最后一页，导出结束");
                    break;
                }

                currentPage++;

            }
            catch (Exception e) {
                logger.error("导出第{}页数据失败", currentPage, e);
                break;
            }
        }

        logger.info("导出完成，总共获取{}条数据", allMessageList.size());
        return allMessageList;
    }

    /**
     * 创建Excel标题行
     */
    private int createTitleRow(Sheet sheet, CellStyle titleStyle, int currentRow) {
        Row titleRow = sheet.createRow(currentRow);
        Cell titleCell = titleRow.createCell(0);
        titleCell.setCellValue(getTitleByLanguage());
        titleCell.setCellStyle(titleStyle);

        // 合并标题行单元格
        sheet.addMergedRegion(new CellRangeAddress(currentRow, currentRow, 0, 14));
        return currentRow + 1;
    }

    /**
     * 创建Excel表头行
     */
    private int createHeaderRow(Sheet sheet, CellStyle headerStyle, int currentRow) {
        Row headerRow = sheet.createRow(currentRow);
        String[] headers = getHeadersByLanguage();
        for (int i = 0; i < headers.length; i++) {
            Cell cell = headerRow.createCell(i);
            cell.setCellValue(headers[i]);
            cell.setCellStyle(headerStyle);
        }
        return currentRow + 1;
    }

    /**
     * 填充数据行
     */
    private int fillDataRows(Sheet sheet, CellStyle dataStyle, List<MessageDto> messageList, int currentRow) {
        // 获取反馈标签映射关系
        Map<String, String> feedbackLabelMap = getFeedbackLabelMapping();

        for (MessageDto message : messageList) {
            Row dataRow = sheet.createRow(currentRow);

            // 按照新的字段顺序设置数据
            createCell(dataRow, 0, message.getProjectName(), dataStyle); // 来源渠道
            createCell(dataRow, 1, message.getAccessTerminal(), dataStyle); // 来源终端
            createCell(dataRow, 2, message.getUserQuestion(), dataStyle); // 提问内容
            createCell(dataRow, 3, message.getSystemAnswer(), dataStyle); // 回复内容
            createCell(dataRow, 4, message.getCreateTime(), dataStyle); // 对话时间
            createCell(dataRow, 5, message.getUserName(), dataStyle); // 提问人
            createCell(dataRow, 6, message.getResponseObj(), dataStyle); // 回复对象
            createCell(dataRow, 7, "", dataStyle); // 关联知识库（暂时为空，需要根据实际业务逻辑填充）
            // 耗时(秒)
            String taskDueTime = "";
            if (message.getTaskDueTime() != null) {
                taskDueTime = message.getTaskDueTime().toString();
            }
            String firstTextDuration = "";
            if (message.getFirstTextDuration() != null) {
                firstTextDuration = message.getFirstTextDuration().toString();
            }
            createCell(dataRow, 8, firstTextDuration, dataStyle);
            createCell(dataRow, 9, taskDueTime, dataStyle);
            createCell(dataRow, 10, convertFeedbackType(message.getFeedbackType()), dataStyle); // 用户反馈类型
            createCell(dataRow, 11, convertFeedbackLabels(message.getFeedbackLabels(), feedbackLabelMap), dataStyle); // 用户反馈标签
            // 用户反馈评分
            String feedbackScore = "";
            if (message.getFeedbackScore() != null) {
                feedbackScore = message.getFeedbackScore().toString();
            }
            createCell(dataRow, 12, feedbackScore, dataStyle);
            createCell(dataRow, 13, message.getFeedbackContent(), dataStyle); // 用户反馈内容
            createCell(dataRow, 14, convertHandleStatus(message.getIsHandle()), dataStyle); // 是否已处理

            currentRow++;
        }
        return currentRow;
    }

    /**
     * 创建单元格
     */
    private void createCell(Row row, int columnIndex, String value, CellStyle style) {
        Cell cell = row.createCell(columnIndex);
        cell.setCellValue(Objects.requireNonNullElse(value, ""));
        cell.setCellStyle(style);
    }

    /**
     * 设置列宽
     */
    private void setColumnWidths(Sheet sheet) {
        // 设置各列的宽度
        sheet.setColumnWidth(0, 15 * 256); // 来源渠道
        sheet.setColumnWidth(1, 15 * 256); // 来源终端
        sheet.setColumnWidth(2, 30 * 256); // 提问内容
        sheet.setColumnWidth(3, 30 * 256); // 回复内容
        sheet.setColumnWidth(4, 20 * 256); // 对话时间
        sheet.setColumnWidth(5, 15 * 256); // 提问人
        sheet.setColumnWidth(6, 15 * 256); // 回复对象
        sheet.setColumnWidth(7, 20 * 256); // 关联知识库
        sheet.setColumnWidth(8, 20 * 256); // 首词响应(秒)
        sheet.setColumnWidth(9, 10 * 256); // 耗时(秒)
        sheet.setColumnWidth(10, 15 * 256); // 用户反馈类型
        sheet.setColumnWidth(11, 20 * 256); // 用户反馈标签
        sheet.setColumnWidth(12, 15 * 256); // 用户反馈评分
        sheet.setColumnWidth(13, 25 * 256); // 用户反馈内容
        sheet.setColumnWidth(14, 15 * 256); // 是否已处理
    }

    /**
     * 创建标题样式
     */
    private CellStyle createTitleStyle(Workbook workbook) {
        CellStyle style = workbook.createCellStyle();
        Font font = workbook.createFont();
        font.setBold(true);
        font.setFontHeightInPoints((short) 16);
        style.setFont(font);
        style.setAlignment(HorizontalAlignment.CENTER);
        style.setVerticalAlignment(VerticalAlignment.CENTER);
        style.setFillForegroundColor(IndexedColors.LIGHT_BLUE.getIndex());
        style.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        return style;
    }

    /**
     * 创建表头样式
     */
    private CellStyle createHeaderStyle(Workbook workbook) {
        CellStyle style = workbook.createCellStyle();
        Font font = workbook.createFont();
        font.setBold(true);
        font.setFontHeightInPoints((short) 12);
        style.setFont(font);
        style.setAlignment(HorizontalAlignment.CENTER);
        style.setVerticalAlignment(VerticalAlignment.CENTER);
        style.setFillForegroundColor(IndexedColors.GREY_25_PERCENT.getIndex());
        style.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        style.setBorderTop(BorderStyle.THIN);
        style.setBorderBottom(BorderStyle.THIN);
        style.setBorderLeft(BorderStyle.THIN);
        style.setBorderRight(BorderStyle.THIN);
        return style;
    }

    /**
     * 创建数据样式
     */
    private CellStyle createDataStyle(Workbook workbook) {
        CellStyle style = workbook.createCellStyle();
        style.setAlignment(HorizontalAlignment.LEFT);
        style.setVerticalAlignment(VerticalAlignment.CENTER);
        style.setBorderTop(BorderStyle.THIN);
        style.setBorderBottom(BorderStyle.THIN);
        style.setBorderLeft(BorderStyle.THIN);
        style.setBorderRight(BorderStyle.THIN);
        style.setWrapText(true);
        return style;
    }

    /**
     * 设置响应头
     */
    private void setResponseHeaders(HttpServletResponse response) {
        // 根据语言构建文件名
        String fileName = buildFileNameByLanguage();
        String encodedFileName = URLEncoder.encode(fileName, StandardCharsets.UTF_8);

        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition",
            "attachment; filename=\"" + encodedFileName + "\"; filename*=UTF-8''" + encodedFileName);
        response.setCharacterEncoding("UTF-8");
    }

    /**
     * 获取反馈标签映射关系
     */
    private Map<String, String> getFeedbackLabelMapping() {
        Map<String, String> labelMap = new HashMap<>();
        List<ByaiSystemConfigList> values = byaiSystemConfigListService.findByParamGroupCode(Constants.FEEDBACK_TYPE);

        if (CollectionUtils.isNotEmpty(values)) {
            for (ByaiSystemConfigList byaiSystemConfigList : values) {
                if (byaiSystemConfigList.getParamValue() != null && byaiSystemConfigList.getParamName() != null) {
                    labelMap.put(byaiSystemConfigList.getParamValue(), byaiSystemConfigList.getParamName());
                }
            }
        }
        return labelMap;
    }

    /**
     * 转换反馈标签
     */
    private String convertFeedbackLabels(List<String> feedbackLabels, Map<String, String> labelMap) {
        if (CollectionUtils.isEmpty(feedbackLabels)) {
            return "";
        }

        List<String> convertedLabels = new ArrayList<>();
        for (String label : feedbackLabels) {
            String convertedLabel = labelMap.getOrDefault(label, label);
            convertedLabels.add(convertedLabel);
        }

        return String.join(",", convertedLabels);
    }

    /**
     * 转换反馈类型
     */
    private String convertFeedbackType(String feedbackType) {
        if (feedbackType == null) {
            return "";
        }

        boolean isEnglish = isEnglishLocale();

        return switch (feedbackType.toLowerCase()) {
            case "tread" -> {
                if (isEnglish) {
                    yield "Dislike";
                }
                else {
                    yield "点踩";
                }
            }
            case "praise" -> {
                if (isEnglish) {
                    yield "Like";
                }
                else {
                    yield "点赞";
                }
            }
            default -> feedbackType; // 其他类型保持原样
        };
    }

    /**
     * 转换处理状态
     */
    private String convertHandleStatus(Integer isHandle) {
        if (isHandle == null) {
            boolean isEnglish = isEnglishLocale();
            if (isEnglish) {
                return "Unprocessed";
            }
            else {
                return "未处理";
            }
        }

        boolean isEnglish = isEnglishLocale();
        if (isHandle == 1) {
            if (isEnglish) {
                return "Processed";
            }
            else {
                return "已处理";
            }
        }
        else {
            if (isEnglish) {
                return "Unprocessed";
            }
            else {
                return "未处理";
            }
        }
    }

    /**
     * 判断当前是否为英文语言环境
     */
    private boolean isEnglishLocale() {
        try {
            Locale currentLocale = LocaleContextHolder.getLocale();
            return "en".equalsIgnoreCase(currentLocale.getLanguage());
        }
        catch (Exception e) {
            logger.warn("获取当前语言环境失败，默认使用中文", e);
            return false; // 默认使用中文
        }
    }

    /**
     * 根据语言获取表头
     */
    private String[] getHeadersByLanguage() {
        boolean isEnglish = isEnglishLocale();

        if (isEnglish) {
            return new String[] {
                "Source Channel", "Source Terminal", "Question Content", "Reply Content", "First Text Duration", "Conversation Time",
                "Questioner", "Reply Object", "Related Knowledge Base", "Duration(sec)", "User Feedback Type",
                "User Feedback Labels", "User Feedback Score", "User Feedback Content", "Processed Status"
            };
        }
        else {
            return new String[] {
                "来源渠道", "来源终端", "提问内容", "回复内容", "对话时间", "提问人", "回复对象", "关联知识库", "首词响应时长(秒)", "耗时(秒)", "用户反馈类型", "用户反馈标签", "用户反馈评分",
                "用户反馈内容", "是否已处理"
            };
        }
    }

    /**
     * 根据语言构建文件名
     */
    private String buildFileNameByLanguage() {
        boolean isEnglish = isEnglishLocale();

        if (isEnglish) {
            return "Q&A Log.xlsx";
        }
        else {
            return "问答日志.xlsx";
        }
    }

    /**
     * 根据语言获取Excel标题
     */
    private String getTitleByLanguage() {
        boolean isEnglish = isEnglishLocale();

        if (isEnglish) {
            return "Conversation Message Export List";
        }
        else {
            return "对话消息导出列表";
        }
    }

    /**
     * 根据语言获取Sheet名称
     */
    private String getSheetNameByLanguage() {
        boolean isEnglish = isEnglishLocale();

        if (isEnglish) {
            return "Conversation Messages";
        }
        else {
            return "对话消息导出列表";
        }
    }
}
