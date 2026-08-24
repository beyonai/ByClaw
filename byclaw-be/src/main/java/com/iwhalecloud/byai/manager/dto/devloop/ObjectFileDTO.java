package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/**
 * 项目业务对象关联文件项。
 */
@Data
public class ObjectFileDTO {

    /**
     * 主键；有值则按主键更新，无值则按会话+对象编码+文件名匹配
     */
    private Long id;

    /**
     * 会话ID
     */
    private Long sessionId;

    /**
     * 保存文件类型,保存对象:object,保存知识文件:knowledge
     */
    private String objectType = "object";

    /**
     * 业务对象名称
     */
    private String objectName;

    /**
     * 业务对象编码
     */
    private String objectCode;

    /**
     * 文件原始名称
     */
    private String fileName;

    /**
     * 文件存储路径
     */
    private String filePath;

    /**
     * 对象版本号
     */
    private String version;

    /**
     * 状态编码
     */
    private String statusCd;

    /**
     * 扩展文本内容，存储额外属性信息
     */
    private String extContent;
}
