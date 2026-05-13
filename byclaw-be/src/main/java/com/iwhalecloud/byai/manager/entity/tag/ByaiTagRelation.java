package com.iwhalecloud.byai.manager.entity.tag;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import java.util.Date;
import lombok.Getter;
import lombok.Setter;

/**
 * 标签关系表，记录对象与标签的关联关系
 */
@Getter
@Setter
@TableName("byai_tag_relation")
public class ByaiTagRelation {

    /**
     * 关系ID
     */
    @TableId(value = "relation_id", type = IdType.AUTO)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long relationId;

    /**
     * 标签ID
     */
    private Long tagId;

    /**
     * 对象ID
     */
    private String objId;

    /**
     * 对象类型
     */
    private String objType;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 创建人
     */
    private String creatorBy;

    /**
     * 标签对象类型/编码，如能力编码、慧笔/问数等标识（Story byai_tag_relation.obj_code）
     */
    private String objCode;
}



