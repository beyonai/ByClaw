package com.iwhalecloud.byai.manager.dto.session;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Data;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 模板会话响应DTO
 *
 * @author smartcloud
 */
@Data
public class TemplateSessionQueryResponseDto implements Serializable {

    /**
     * 会话ID
     */
    private Long sessionId;

    /**
     * 会话名称
     */
    private String sessionName;

    /**
     * 模板标题
     */
    private String templateTitle;

    /**
     * 模板类型编码
     */
    private String templateType;

    /**
     * 模板类型显示名称
     */
    private String templateTypeName;

    /**
     * 模板封面图片ID
     */
    private String templateCoverId;

    /**
     * 原始会话ID
     */
    private Long originalSessionId;

    /**
     * 创建者ID
     */
    private Long creatorId;

    /**
     * 企业ID
     */
    private Long enterpriseId;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime createTime;

    /**
     * 更新时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime updateTime;

    /**
     * 是否为模板会话
     */
    private Boolean isTemplate;
}
