package com.iwhalecloud.byai.manager.entity.workspace;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.util.Date;
import lombok.Getter;
import lombok.Setter;

/**
 * 会话工作区表实体
 * 表 byai_session_workspace：存储会话关联的文件信息
 *
 * @author system
 */
@Getter
@Setter
@TableName("byai_session_workspace")
public class ByaiSessionWorkspace {

    /**
     * 唯一标识
     */
    @TableId(value = "id", type = IdType.INPUT)
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

    private Integer isExist;
}
