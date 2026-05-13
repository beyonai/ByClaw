package com.iwhalecloud.byai.manager.entity.showcase;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 成果空间表实体
 *
 * @author system
 * @date 2025-11-10
 */
@Getter
@Setter
@TableName("byai_showcase")
public class ByaiShowcase {

    /**
     * 主键
     */
    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /**
     * 会话id
     */
    private Long sessionId;

    /**
     * 类型，ppt,text,chat等前端保存的类型
     */
    private String type;

    /**
     * 智办任务Id
     */
    private Long taskId;

    /**
     * 内容
     */
    private String content;

    /**
     * 文件状态：1-有效；0-无效
     */
    private Integer status;

    /**
     * 对象存储文件编码
     */
    private String fileCode;

    /**
     * 对象存储文件ID
     */
    private String fileId;

    /**
     * 成果文件访问地址
     */
    private String url;

    /**
     * 文件名字/目录名字
     */
    private String name;

    /**
     * 当前消息Id
     */
    private Long messageId;

    /**
     * 特殊数字员工id
     */
    private Long agentId;

    /**
     * 数字员工唯一标识code--byai_tag_relation
     */
    private String agentCode;

    /**
     * 会话模式
     */
    private String sessionMode;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 修改时间
     */
    private Date updateTime;

    /**
     * 创建人
     */
    private Long createBy;

    /**
     * 修改人
     */
    private Long updateBy;

    /**
     * 是否已从逻辑删除记录中恢复
     */
    @TableField(exist = false)
    private transient boolean recovered;

}
