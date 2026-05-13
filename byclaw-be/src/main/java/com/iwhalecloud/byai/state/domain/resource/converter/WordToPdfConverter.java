package com.iwhalecloud.byai.state.domain.resource.converter;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.apache.poi.hwpf.HWPFDocument;
import org.apache.poi.hwpf.usermodel.Range;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTableRow;
import org.apache.poi.xwpf.usermodel.XWPFTableCell;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.lowagie.text.Document;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Phrase;
import com.lowagie.text.pdf.BaseFont;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfWriter;
import com.lowagie.text.Chunk;

@Component
public class WordToPdfConverter implements FileConverterStrategy {

    private static final Logger logger = LoggerFactory.getLogger(WordToPdfConverter.class);
    private static final Set<String> SUPPORTED_TYPES = new HashSet<>();

    // 字体缓存
    private Font defaultFont;
    private Font boldFont;
    private Font italicFont;
    private Font boldItalicFont;

    static {
        SUPPORTED_TYPES.add("doc");
        SUPPORTED_TYPES.add("docx");
        SUPPORTED_TYPES.add("dot");
        SUPPORTED_TYPES.add("dotx");
        SUPPORTED_TYPES.add("docm");
        SUPPORTED_TYPES.add("dotm");
        SUPPORTED_TYPES.add("rtf");
    }

    @Override
    public boolean supports(String fileType) {
        return fileType != null && SUPPORTED_TYPES.contains(fileType.toLowerCase());
    }

    @Override
    public byte[] convertToPdf(byte[] bytes) throws Exception {
        if (bytes == null || bytes.length == 0) {
            throw new IllegalArgumentException(I18nUtil.get("word.to.pdf.converter.input.bytes.cannot.be.null.or.empty"));
        }

        // 初始化字体
        initializeFonts();

        ByteArrayInputStream inputStream = null;
        ByteArrayOutputStream outputStream = null;
        
        try {
            inputStream = new ByteArrayInputStream(bytes);
            
            // 创建PDF文档
            outputStream = new ByteArrayOutputStream();
            Document pdfDocument = new Document(PageSize.A4, 50, 50, 50, 50); // 设置页边距
            PdfWriter.getInstance(pdfDocument, outputStream);
            pdfDocument.open();
            
            // 尝试作为DOCX文件处理
            boolean processed = false;
            try {
                XWPFDocument docx = new XWPFDocument(inputStream);
                processDocxDocument(docx, pdfDocument);
                docx.close();
                processed = true;
                logger.debug("Successfully processed DOCX document with formatting");
            } catch (Exception e) {
                logger.debug("DOCX processing failed, trying DOC format: {}", e.getMessage());
            }
            
            // 如果DOCX失败，尝试DOC格式
            if (!processed) {
                try {
                    inputStream.reset();
                    HWPFDocument doc = new HWPFDocument(inputStream);
                    processDocDocument(doc, pdfDocument);
                    doc.close();
                    processed = true;
                    logger.debug("Successfully processed DOC document with formatting");
                } catch (Exception e) {
                    logger.error("Failed to process both DOCX and DOC formats", e);
                    throw new RuntimeException(I18nUtil.get("word.to.pdf.converter.unsupported.format.or.corrupted.file"), e);
                }
            }
            
            pdfDocument.close();
            
            byte[] result = outputStream.toByteArray();
            logger.debug("Successfully converted Word document to PDF with formatting preserved, output size: {} bytes", result.length);
            
            return result;
        } catch (Exception e) {
            logger.error("Error converting Word to PDF with formatting: {}", e.getMessage(), e);
            throw new RuntimeException(I18nUtil.get("word.to.pdf.converter.convert.failed", e.getMessage()), e);
        } finally {
            closeResource(inputStream, "ByteArrayInputStream");
            closeResource(outputStream, "ByteArrayOutputStream");
        }
    }

    private void initializeFonts() {
        try {
            // 尝试使用中文字体
            BaseFont chineseBaseFont = null;
            try {
                chineseBaseFont = BaseFont.createFont("STSong-Light", "UniGB-UCS2-H", BaseFont.NOT_EMBEDDED);
            } catch (Exception e) {
                try {
                    chineseBaseFont = BaseFont.createFont(BaseFont.HELVETICA, BaseFont.CP1252, BaseFont.NOT_EMBEDDED);
                } catch (Exception e2) {
                    chineseBaseFont = BaseFont.createFont(BaseFont.HELVETICA, BaseFont.WINANSI, BaseFont.NOT_EMBEDDED);
                }
            }
            
            defaultFont = new Font(chineseBaseFont, 12, Font.NORMAL);
            boldFont = new Font(chineseBaseFont, 12, Font.BOLD);
            italicFont = new Font(chineseBaseFont, 12, Font.ITALIC);
            boldItalicFont = new Font(chineseBaseFont, 12, Font.BOLD | Font.ITALIC);
            
        } catch (Exception e) {
            logger.warn("Failed to initialize fonts, using default: {}", e.getMessage());
            defaultFont = new Font(Font.HELVETICA, 12, Font.NORMAL);
            boldFont = new Font(Font.HELVETICA, 12, Font.BOLD);
            italicFont = new Font(Font.HELVETICA, 12, Font.ITALIC);
            boldItalicFont = new Font(Font.HELVETICA, 12, Font.BOLD | Font.ITALIC);
        }
    }

    private void processDocxDocument(XWPFDocument docx, Document pdfDocument) throws Exception {
        List<XWPFParagraph> paragraphs = docx.getParagraphs();
        List<XWPFTable> tables = docx.getTables();
        
        // 处理段落
        for (XWPFParagraph paragraph : paragraphs) {
            processParagraph(paragraph, pdfDocument);
        }
        
        // 处理表格
        for (XWPFTable table : tables) {
            processTable(table, pdfDocument);
        }
    }

    private void processParagraph(XWPFParagraph paragraph, Document pdfDocument) throws Exception {
        if (paragraph.getText().trim().isEmpty()) {
            pdfDocument.add(new Paragraph(" ", defaultFont)); // 空行
            return;
        }

        Paragraph pdfParagraph = new Paragraph();
        
        // 设置段落对齐方式
        switch (paragraph.getAlignment()) {
            case CENTER:
                pdfParagraph.setAlignment(Element.ALIGN_CENTER);
                break;
            case RIGHT:
                pdfParagraph.setAlignment(Element.ALIGN_RIGHT);
                break;
            case BOTH:
                pdfParagraph.setAlignment(Element.ALIGN_JUSTIFIED);
                break;
            default:
                pdfParagraph.setAlignment(Element.ALIGN_LEFT);
                break;
        }

        // 处理段落中的文本运行
        List<XWPFRun> runs = paragraph.getRuns();
        if (runs.isEmpty()) {
            pdfParagraph.add(new Chunk(paragraph.getText(), defaultFont));
        } else {
            for (XWPFRun run : runs) {
                processRun(run, pdfParagraph);
            }
        }
        
        pdfDocument.add(pdfParagraph);
    }

    private void processRun(XWPFRun run, Paragraph pdfParagraph) {
        String text = run.getText(0);
        if (text == null || text.isEmpty()) {
            return;
        }

        Font font = getRunFont(run);
        Chunk chunk = new Chunk(text, font);
        
        // 注释掉颜色处理，因为API不可用
        // 设置文本颜色功能暂时禁用，等待更好的解决方案
        /*
        try {
            if (run.getCTR() != null && run.getCTR().getRPr() != null) {
                CTRPr rPr = run.getCTR().getRPr();
                if (rPr.getColor() != null && rPr.getColor().getVal() != null) {
                    String colorHex = rPr.getColor().getVal().toString();
                    if (colorHex.length() == 6) {
                        int r = Integer.parseInt(colorHex.substring(0, 2), 16);
                        int g = Integer.parseInt(colorHex.substring(2, 4), 16);
                        int b = Integer.parseInt(colorHex.substring(4, 6), 16);
                        chunk.setBackground(new Color(r, g, b));
                    }
                }
            }
        } catch (Exception e) {
            // 忽略颜色设置错误
        }
        */
        
        pdfParagraph.add(chunk);
    }

    private Font getRunFont(XWPFRun run) {
        boolean isBold = run.isBold();
        boolean isItalic = run.isItalic();
        
        int fontSize = run.getFontSize();
        if (fontSize == -1) {
            fontSize = 12; // 默认字体大小
        }
        
        Font baseFont;
        if (isBold && isItalic) {
            baseFont = boldItalicFont;
        } else if (isBold) {
            baseFont = boldFont;
        } else if (isItalic) {
            baseFont = italicFont;
        } else {
            baseFont = defaultFont;
        }
        
        // 创建具有正确大小的字体
        if (fontSize != 12) {
            try {
                return new Font(baseFont.getBaseFont(), fontSize, baseFont.getStyle());
            } catch (Exception e) {
                return baseFont;
            }
        }
        
        return baseFont;
    }

    private void processTable(XWPFTable table, Document pdfDocument) throws Exception {
        List<XWPFTableRow> rows = table.getRows();
        if (rows.isEmpty()) {
            return;
        }

        // 确定表格列数
        int maxCols = 0;
        for (XWPFTableRow row : rows) {
            maxCols = Math.max(maxCols, row.getTableCells().size());
        }

        PdfPTable pdfTable = new PdfPTable(maxCols);
        pdfTable.setWidthPercentage(100);
        pdfTable.setSpacingBefore(10f);
        pdfTable.setSpacingAfter(10f);

        // 处理表格行
        for (XWPFTableRow row : rows) {
            List<XWPFTableCell> cells = row.getTableCells();
            
            for (int i = 0; i < maxCols; i++) {
                PdfPCell pdfCell;
                
                if (i < cells.size()) {
                    XWPFTableCell cell = cells.get(i);
                    String cellText = cell.getText();
                    pdfCell = new PdfPCell(new Phrase(cellText, defaultFont));
                } else {
                    pdfCell = new PdfPCell(new Phrase("", defaultFont));
                }
                
                pdfCell.setPadding(5);
                pdfCell.setBorderWidth(1);
                pdfTable.addCell(pdfCell);
            }
        }

        pdfDocument.add(pdfTable);
    }

    private void processDocDocument(HWPFDocument doc, Document pdfDocument) throws Exception {
        Range range = doc.getRange();
        
        // 处理普通文本
        String text = range.text();
        if (text != null && !text.trim().isEmpty()) {
            String[] paragraphs = text.split("\\r?\\n");
            for (String para : paragraphs) {
                if (!para.trim().isEmpty()) {
                    Paragraph paragraph = new Paragraph(para.trim(), defaultFont);
                    pdfDocument.add(paragraph);
                }
            }
        }
        
        // 处理表格 - DOC格式的表格处理比较复杂，暂时简化处理
        try {
            // DOC格式的表格处理需要更复杂的逻辑，这里先简化处理
            // 如果需要完整的DOC表格支持，可以后续增强
            logger.debug("DOC table processing is simplified in current version");
        } catch (Exception e) {
            logger.debug("Failed to process DOC tables: {}", e.getMessage());
        }
    }

    // DOC表格处理方法暂时移除，因为API复杂性
    // 如果需要完整的DOC表格支持，可以后续实现
    // private void processDocTable(Table table, Document pdfDocument) throws Exception { ... }

    private void closeResource(AutoCloseable resource, String resourceName) {
        if (resource != null) {
            try {
                resource.close();
            } catch (Exception e) {
                logger.warn("Error closing {}: {}", resourceName, e.getMessage());
            }
        }
    }
}
