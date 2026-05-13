package com.iwhalecloud.byai.state.domain.file.service;

/**
 * 文档页数检查异常
 * 
 * @author system
 */
public class DocumentPageCountException extends Exception {
    
    private static final long serialVersionUID = 1L;
    
    /**
     * 构造函数
     * 
     * @param message 异常消息
     */
    public DocumentPageCountException(String message) {
        super(message);
    }
    
    /**
     * 构造函数
     * 
     * @param message 异常消息
     * @param cause 异常原因
     */
    public DocumentPageCountException(String message, Throwable cause) {
        super(message, cause);
    }
}
