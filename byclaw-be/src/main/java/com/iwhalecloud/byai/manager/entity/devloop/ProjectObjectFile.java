package com.iwhalecloud.byai.manager.entity.devloop;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 项目业务对象关联文件。
 */
@Getter
@Setter
@TableName("byai_project_object_file")
public class ProjectObjectFile {

    /** 主键ID */
    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /** 会话ID，关联 byai_session 表 */
    private Long sessionId;

    /** 业务对象名称 */
    private String objectName;

    /** 业务对象编码 */
    private String objectCode;

    /** 文件原始名称 */
    private String fileName;

    /** 文件存储路径 */
    private String filePath;

    /** 对象版本号 */
    private String version;

    /** 状态编码 */
    private String statusCd;

    /** 扩展文本内容，存储额外属性信息 */
    private String extContent;

    /** 创建人 */
    private Long createBy;

    /** 创建时间 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /** 更新时间 */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;
}
