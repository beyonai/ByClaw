package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Data;

/**
 * MD文件生成结果
 */
@Data
public class MdGenerationResult {

    /**
     * 文件路径（相对路径）
     */
    private String filePath;

    /**
     * 文件内容
     */
    private String content;

    /**
     * 是否生成成功
     */
    private boolean success;

    /**
     * 错误信息（如果生成失败）
     */
    private String errorMessage;

    public MdGenerationResult() {
    }

    public MdGenerationResult(String filePath, String content) {
        this.filePath = filePath;
        this.content = content;
        this.success = true;
    }

    public MdGenerationResult(String errorMessage) {
        this.errorMessage = errorMessage;
        this.success = false;
    }

    /**
     * 创建成功结果
     */
    public static MdGenerationResult success(String filePath, String content) {
        return new MdGenerationResult(filePath, content);
    }

    /**
     * 创建失败结果
     */
    public static MdGenerationResult failure(String errorMessage) {
        return new MdGenerationResult(errorMessage);
    }
}