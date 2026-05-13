package com.iwhalecloud.byai.state.domain.file.service;

import java.io.InputStream;

/**
 * 文档页数检查服务接口
 * 用于检查上传文档的页数是否超过限制
 * 
 * @author system
 */
public interface DocumentPageCountService {
    
    /**
     * 检查文档页数是否超过限制
     * 
     * @param inputStream 文件输入流（不会被关闭）
     * @param contentType 文件内容类型
     * @param maxPages 最大页数限制
     * @return 检查结果，包含是否通过和实际页数
     * @throws DocumentPageCountException 检查失败时抛出异常
     */
    PageCountResult checkPageCount(InputStream inputStream, String contentType, int maxPages) 
            throws DocumentPageCountException;
    
    /**
     * 获取文档页数
     * 
     * @param inputStream 文件输入流（不会被关闭）
     * @param contentType 文件内容类型
     * @return 文档页数
     * @throws DocumentPageCountException 获取失败时抛出异常
     */
    int getPageCount(InputStream inputStream, String contentType) 
            throws DocumentPageCountException;
    
    /**
     * 检查是否支持该文件类型
     * 
     * @param contentType 文件内容类型
     * @return 是否支持
     */
    boolean supports(String contentType);
}
