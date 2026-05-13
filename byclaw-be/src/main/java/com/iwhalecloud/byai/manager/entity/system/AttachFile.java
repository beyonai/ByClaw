package com.iwhalecloud.byai.manager.entity.system;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

@Getter
@Setter
@TableName("byai_attach_file")
public class AttachFile {

    /**
     * 附件文件ID
     */
    @TableId(value = "attach_file_id", type = IdType.INPUT)
    private Long attachFileId;

    /**
     * 源文件ID
     */
    private Long sourceFileId;

    /**
     * 文件类型
     */
    private String fileType;

    /**
     * 文件名称
     */
    private String fileName;

    /**
     * 文件位置类型
     */
    private String fileLocationType;

    /**
     * 文件位置
     */
    private String fileLocation;

    /**
     * 关联表名
     */
    private String tableName;

    /**
     * 关联表主键名
     */
    private String tablePkName;

    /**
     * 关联表主键
     */
    private Long tablePkValue;

    /**
     * 关联表字段名
     */
    private String tableFieldName;

    /**
     * 批次ID
     */
    private Long batchId;

    /**
     * 创建时间
     */
    private Date createDate;

    /**
     * 状态
     */
    private String state;

    /**
     * 源ID
     */
    private Long sourceId;

    /**
     * 创建用户ID
     */
    private Long createUserId;
}
