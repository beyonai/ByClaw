package com.iwhalecloud.byai.state.domain.file.service.impl;

import com.iwhalecloud.byai.state.domain.file.service.DocumentPageCountException;
import com.iwhalecloud.byai.state.domain.file.service.DocumentPageCountService;
import com.iwhalecloud.byai.state.domain.file.service.PageCountResult;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.poi.hwpf.HWPFDocument;
import org.apache.poi.hwpf.extractor.WordExtractor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;
import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 文档页数检查服务实现
 * 使用流式处理，避免将整个文件加载到内存
 * 
 * @author system
 */
@Service
public class DocumentPageCountServiceImpl implements DocumentPageCountService {
    
    private static final Logger logger = LoggerFactory.getLogger(DocumentPageCountServiceImpl.class);
    
    /**
     * 支持的文件类型 - DOC
     */
    private static final String CONTENT_TYPE_DOC = "application/msword";
    
    /**
     * 支持的文件类型 - DOCX
     */
    private static final String CONTENT_TYPE_DOCX = 
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    
    /**
     * 支持的文件类型 - PDF
     */
    private static final String CONTENT_TYPE_PDF = "application/pdf";
    
    /**
     * 文件扩展名 - DOC
     */
    private static final String EXT_DOC = ".doc";
    
    /**
     * 文件扩展名 - DOCX
     */
    private static final String EXT_DOCX = ".docx";
    
    /**
     * 文件扩展名 - PDF
     */
    private static final String EXT_PDF = ".pdf";
    
    @Override
    public boolean supports(String contentType) {
        if (contentType == null) {
            return false;
        }
        String lowerContentType = contentType.toLowerCase();
        return lowerContentType.equals(CONTENT_TYPE_DOC) 
                || lowerContentType.equals(CONTENT_TYPE_DOCX)
                || lowerContentType.equals(CONTENT_TYPE_PDF)
                || lowerContentType.contains("word")
                || lowerContentType.contains("pdf");
    }
    
    @Override
    public PageCountResult checkPageCount(InputStream inputStream, String contentType, int maxPages) 
            throws DocumentPageCountException {
        if (inputStream == null) {
            throw new DocumentPageCountException(I18nUtil.get("document.page.count.input.stream.null"));
        }
        
        if (maxPages <= 0) {
            throw new DocumentPageCountException(I18nUtil.get("document.page.count.max.pages.invalid", maxPages));
        }
        
        int pageCount = getPageCount(inputStream, contentType);
        boolean passed = pageCount <= maxPages;
        
        return new PageCountResult(passed, pageCount, maxPages);
    }
    
    @Override
    public int getPageCount(InputStream inputStream, String contentType) 
            throws DocumentPageCountException {
        if (inputStream == null) {
            throw new DocumentPageCountException(I18nUtil.get("document.page.count.input.stream.null"));
        }
        
        if (!supports(contentType)) {
            throw new DocumentPageCountException(I18nUtil.get("document.page.count.file.type.not.supported", contentType));
        }
        
        // 使用BufferedInputStream包装，支持mark/reset操作
        // 注意：不关闭inputStream，因为可能还需要后续使用
        BufferedInputStream bufferedInputStream = new BufferedInputStream(inputStream);
        
        try {
            // 标记当前位置，以便后续重置
            bufferedInputStream.mark(Integer.MAX_VALUE);
            
            // 根据MIME类型判断文件格式并获取页数
            DocumentType documentType = detectDocumentType(contentType);
            logger.debug(I18nUtil.get("document.page.count.detect.type.log"), documentType, contentType);
            
            return getPageCountByDocumentType(bufferedInputStream, documentType, contentType);
        } catch (Exception e) {
            // DocumentPageCountException是业务异常，直接传播，无需重新包装
            if (e instanceof DocumentPageCountException) {
                throw (DocumentPageCountException) e;
            }
            logger.error(I18nUtil.get("document.page.count.read.failed.log"), e);
            throw new DocumentPageCountException(I18nUtil.get("document.page.count.read.failed", e.getMessage()), e);
        } finally {
            try {
                // 重置流位置，以便后续使用
                bufferedInputStream.reset();
            } catch (IOException e) {
                logger.warn(I18nUtil.get("document.page.count.reset.stream.failed.log"), e);
            }
        }
    }
    
    /**
     * 文档类型枚举
     */
    private enum DocumentType {
        /** PDF文档 */
        PDF,
        /** Word 2007+ 文档 (.docx) */
        DOCX,
        /** Word 97-2003 文档 (.doc) */
        DOC,
        /** 未知类型 */
        UNKNOWN
    }
    
    /**
     * 根据文档类型获取页数
     * 
     * @param inputStream 文档输入流
     * @param documentType 文档类型
     * @param contentType 原始内容类型（用于错误提示）
     * @return 页数
     * @throws DocumentPageCountException 读取失败或类型不支持
     */
    private int getPageCountByDocumentType(InputStream inputStream, DocumentType documentType, String contentType) 
            throws DocumentPageCountException {
        switch (documentType) {
            case PDF:
                return getPdfPageCount(inputStream);
            case DOCX:
                return getDocxPageCount(inputStream);
            case DOC:
                return getDocPageCount(inputStream);
            default:
                throw new DocumentPageCountException(
                        I18nUtil.get("document.page.count.file.type.unrecognized", contentType));
        }
    }
    
    /**
     * 根据contentType检测文档类型
     * 支持通过MIME类型或文件扩展名判断
     * 
     * @param contentType MIME类型或包含文件扩展名的字符串
     * @return 文档类型
     */
    private DocumentType detectDocumentType(String contentType) {
        if (contentType == null || contentType.isEmpty()) {
            return DocumentType.UNKNOWN;
        }
        
        String lowerContentType = contentType.toLowerCase().trim();
        
        // 1. 首先精确匹配标准MIME类型
        DocumentType exactMatchType = detectByExactMimeType(lowerContentType);
        if (exactMatchType != DocumentType.UNKNOWN) {
            return exactMatchType;
        }
        
        // 2. 通过MIME类型关键字匹配
        DocumentType keywordMatchType = detectByMimeKeyword(lowerContentType);
        if (keywordMatchType != DocumentType.UNKNOWN) {
            return keywordMatchType;
        }
        
        // 3. 通过文件扩展名匹配
        DocumentType extensionMatchType = detectByFileExtension(lowerContentType);
        if (extensionMatchType != DocumentType.UNKNOWN) {
            return extensionMatchType;
        }
        
        // 4. 兜底逻辑：包含"word"但未匹配上述规则，默认为DOC格式
        if (lowerContentType.contains("word")) {
            logger.warn(I18nUtil.get("document.page.count.word.type.detect.failed.log"), contentType);
            return DocumentType.DOC;
        }
        
        return DocumentType.UNKNOWN;
    }
    
    /**
     * 通过精确匹配标准MIME类型检测文档类型
     * 
     * @param lowerContentType 小写的内容类型
     * @return 文档类型，未匹配返回UNKNOWN
     */
    private DocumentType detectByExactMimeType(String lowerContentType) {
        if (CONTENT_TYPE_PDF.equals(lowerContentType)) {
            return DocumentType.PDF;
        }
        if (CONTENT_TYPE_DOCX.equals(lowerContentType)) {
            return DocumentType.DOCX;
        }
        if (CONTENT_TYPE_DOC.equals(lowerContentType)) {
            return DocumentType.DOC;
        }
        return DocumentType.UNKNOWN;
    }
    
    /**
     * 通过MIME类型关键字检测文档类型
     * 注意：必须先判断DOCX再判断DOC，因为DOCX的MIME类型更具体
     * 
     * @param lowerContentType 小写的内容类型
     * @return 文档类型，未匹配返回UNKNOWN
     */
    private DocumentType detectByMimeKeyword(String lowerContentType) {
        if (lowerContentType.contains("pdf")) {
            return DocumentType.PDF;
        }
        // openxmlformats 是 DOCX 特有的标识
        if (lowerContentType.contains("openxmlformats") || lowerContentType.contains("wordprocessingml")) {
            return DocumentType.DOCX;
        }
        // msword 是 DOC 的标准MIME类型
        if (lowerContentType.contains("msword")) {
            return DocumentType.DOC;
        }
        return DocumentType.UNKNOWN;
    }
    
    /**
     * 通过文件扩展名检测文档类型
     * 注意：必须先判断.docx再判断.doc，因为.docx包含.doc
     * 
     * @param lowerContentType 小写的内容类型（可能是文件名）
     * @return 文档类型，未匹配返回UNKNOWN
     */
    private DocumentType detectByFileExtension(String lowerContentType) {
        if (lowerContentType.endsWith(EXT_PDF)) {
            return DocumentType.PDF;
        }
        if (lowerContentType.endsWith(EXT_DOCX)) {
            return DocumentType.DOCX;
        }
        if (lowerContentType.endsWith(EXT_DOC)) {
            return DocumentType.DOC;
        }
        return DocumentType.UNKNOWN;
    }
    
    /**
     * 获取PDF文档页数
     * 使用临时文件方式，避免将整个文件加载到内存
     * 
     * @param inputStream 输入流
     * @return 页数
     * @throws DocumentPageCountException 读取失败
     */
    private int getPdfPageCount(InputStream inputStream) throws DocumentPageCountException {
        // 使用临时文件避免内存占用
        // 对于大文件，这种方式比直接加载到内存更安全
        java.nio.file.Path tempFile = null;
        try {
            // 创建临时文件（系统会自动清理）
            tempFile = java.nio.file.Files.createTempFile("pdf_page_count_", ".pdf");
            
            // 将流写入临时文件（使用缓冲区，避免一次性加载）
            try (OutputStream out = java.nio.file.Files.newOutputStream(tempFile)) {
                byte[] buffer = new byte[8192]; // 8KB缓冲区
                int bytesRead;
                while ((bytesRead = inputStream.read(buffer)) != -1) {
                    out.write(buffer, 0, bytesRead);
                }
            }
            
            // 从临时文件加载PDF（PDFBox支持文件路径加载，更高效且内存友好）
            // 注意：PDDocument会自动管理资源，使用try-with-resources确保释放
            try (PDDocument document = Loader.loadPDF(tempFile.toFile())) {
                int pageCount = document.getNumberOfPages();
                logger.debug(I18nUtil.get("document.page.count.pdf.page.count.log"), pageCount);
                return pageCount;
            }
        } catch (IOException e) {
            logger.error(I18nUtil.get("document.page.count.pdf.read.failed.log"), e);
            throw new DocumentPageCountException(I18nUtil.get("document.page.count.pdf.read.failed", e.getMessage()), e);
        } finally {
            // 确保删除临时文件，释放磁盘空间
            if (tempFile != null) {
                try {
                    java.nio.file.Files.deleteIfExists(tempFile);
                } catch (IOException e) {
                    logger.warn(I18nUtil.get("document.page.count.delete.temp.file.failed.log"), tempFile, e);
                }
            }
        }
    }
    
    /**
     * 获取DOCX文档页数
     * 直接从docx元数据(docProps/app.xml)读取页数，内存效率极高
     * docx文件本质是zip压缩包，只需读取其中的元数据XML文件
     * 
     * @param inputStream 输入流
     * @return 页数
     * @throws DocumentPageCountException 读取失败
     */
    private int getDocxPageCount(InputStream inputStream) throws DocumentPageCountException {
        // 使用ZipInputStream流式读取docx文件（本质是zip压缩包）
        // 只需读取docProps/app.xml，不需要解析整个文档，内存占用极小
        try (ZipInputStream zipInputStream = new ZipInputStream(inputStream)) {
            ZipEntry entry;
            while ((entry = zipInputStream.getNextEntry()) != null) {
                // 查找docProps/app.xml文件，其中包含页数信息
                if ("docProps/app.xml".equals(entry.getName())) {
                    int pageCount = parsePageCountFromAppXml(zipInputStream);
                    if (pageCount > 0) {
                        logger.debug(I18nUtil.get("document.page.count.docx.page.count.from.metadata.log"), pageCount);
                        return pageCount;
                    }
                }
                zipInputStream.closeEntry();
            }
            
            // 如果元数据中没有页数信息，返回默认值1
            // 注意：这种情况较少见，大多数Word/WPS保存的文档都包含页数信息
            logger.warn(I18nUtil.get("document.page.count.docx.metadata.not.found.log"));
            return 1;
            
        } catch (IOException e) {
            logger.error(I18nUtil.get("document.page.count.docx.read.failed.log"), e);
            throw new DocumentPageCountException(I18nUtil.get("document.page.count.docx.read.failed", e.getMessage()), e);
        }
    }
    
    /**
     * 从app.xml中解析页数
     * 使用StAX流式解析XML，内存效率高
     * 
     * @param inputStream app.xml的输入流
     * @return 页数，解析失败返回-1
     */
    private int parsePageCountFromAppXml(InputStream inputStream) {
        XMLInputFactory factory = createSecureXmlInputFactory();
        
        try {
            XMLStreamReader reader = factory.createXMLStreamReader(inputStream);
            return extractPageCountFromXml(reader);
        } catch (XMLStreamException e) {
            logger.warn(I18nUtil.get("document.page.count.parse.app.xml.failed.log"), e.getMessage());
            return -1;
        }
    }
    
    /**
     * 创建安全配置的XMLInputFactory
     * 禁用外部实体解析，防止XXE攻击
     * 
     * @return 安全配置的XMLInputFactory实例
     */
    private XMLInputFactory createSecureXmlInputFactory() {
        XMLInputFactory factory = XMLInputFactory.newInstance();
        factory.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, Boolean.FALSE);
        factory.setProperty(XMLInputFactory.SUPPORT_DTD, Boolean.FALSE);
        return factory;
    }
    
    /**
     * 从XML流中提取页数
     * 
     * @param reader XML流读取器
     * @return 页数，未找到返回-1
     * @throws XMLStreamException XML解析异常
     */
    private int extractPageCountFromXml(XMLStreamReader reader) throws XMLStreamException {
        boolean inPagesElement = false;
        
        while (reader.hasNext()) {
            int event = reader.next();
            
            if (event == XMLStreamConstants.START_ELEMENT && "Pages".equals(reader.getLocalName())) {
                inPagesElement = true;
            } else if (event == XMLStreamConstants.CHARACTERS && inPagesElement) {
                int pageCount = parsePageCountText(reader.getText());
                if (pageCount > 0) {
                    return pageCount;
                }
            } else if (event == XMLStreamConstants.END_ELEMENT && "Pages".equals(reader.getLocalName())) {
                inPagesElement = false;
            }
        }
        return -1;
    }
    
    /**
     * 解析页数文本
     * 
     * @param text 页数文本内容
     * @return 解析后的页数，解析失败返回-1
     */
    private int parsePageCountText(String text) {
        String trimmedText = text.trim();
        if (trimmedText.isEmpty()) {
            return -1;
        }
        try {
            return Integer.parseInt(trimmedText);
        } catch (NumberFormatException e) {
            logger.warn(I18nUtil.get("document.page.count.parse.page.count.failed.log"), trimmedText);
            return -1;
        }
    }
    
    /**
     * 获取DOC文档页数
     * 从OLE文档的SummaryInformation元数据中读取页数信息
     * 这是Word/WPS在保存文档时写入的准确页数
     * 
     * @param inputStream 输入流
     * @return 页数
     * @throws DocumentPageCountException 读取失败
     */
    private int getDocPageCount(InputStream inputStream) throws DocumentPageCountException {
        // HWPFDocument支持从InputStream直接加载
        // 注意：HWPFDocument会自动管理资源，使用try-with-resources确保释放
        try (HWPFDocument document = new HWPFDocument(inputStream)) {
            int pageCount = 0;
            
            // 从SummaryInformation元数据中获取页数
            // 这是Word/WPS在保存文档时写入的准确值，与Python olefile读取的num_pages一致
            org.apache.poi.hpsf.SummaryInformation summaryInfo = document.getSummaryInformation();
            if (summaryInfo != null) {
                pageCount = summaryInfo.getPageCount();
                logger.debug(I18nUtil.get("document.page.count.doc.page.count.from.summary.log"), pageCount);
            } else {
                logger.warn(I18nUtil.get("document.page.count.doc.summary.empty.log"));
            }
            
            // 如果SummaryInformation中没有页数信息（值为0或null），则通过内容长度估算
            if (pageCount <= 0) {
                logger.debug(I18nUtil.get("document.page.count.doc.estimate.from.content.log"));
                try (WordExtractor extractor = new WordExtractor(document)) {
                    String text = extractor.getText();
                    // 简单估算：每页约2000个字符（中文文档约每页800-1000字）
                    // 这里使用2000字符作为保守估计
                    pageCount = Math.max(1, (text.length() + 1999) / 2000);
                    logger.debug(I18nUtil.get("document.page.count.doc.estimated.page.count.log"), pageCount, text.length());
                }
            }
            
            logger.debug(I18nUtil.get("document.page.count.doc.final.page.count.log"), pageCount);
            return pageCount;
        } catch (IOException e) {
            logger.error(I18nUtil.get("document.page.count.doc.read.failed.log"), e);
            throw new DocumentPageCountException(I18nUtil.get("document.page.count.doc.read.failed", e.getMessage()), e);
        }
    }
}
