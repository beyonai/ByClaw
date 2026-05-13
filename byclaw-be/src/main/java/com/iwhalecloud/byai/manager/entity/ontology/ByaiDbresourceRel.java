package com.iwhalecloud.byai.manager.entity.ontology;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;

/**
 * 数据库资源关联表实体类
 */
@Data
@TableName("byai_dbresource_rel")
public class ByaiDbresourceRel implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 关联关系ID
     */
    @TableId(type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long relId;

    /**
     * 用户id，每个用户对应一个库
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long objId;

    /**
     * "USER":标识用户
     */
    private String objType;

    /**
     * 库id
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long recordId;
}

