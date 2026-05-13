package com.iwhalecloud.byai.manager.dto.workspace;

import com.fasterxml.jackson.annotation.JsonFormat;
import java.util.Date;
import lombok.Getter;
import lombok.Setter;

/**
 * 会话工作区列表项响应
 *
 * @author system
 */
@Getter
@Setter
public class SessionWorkspaceResponse {

    /**
     * 唯一标识
     */
    private Long id;

    /**
     * 会话id
     */
    private Long sessionId;

    /**
     * 文件名称
     */
    private String name;

    /**
     * 引用数量
     */
    private Integer relCount;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 创建人
     */
    private Long createBy;

    /**
     * 文件id
     */
    private String fileId;

    /**
     * 文件链接
     */
    private String fileUrl;

    /**
     * 文件图标
     */
    private String icon;
}
