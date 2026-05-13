package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;
import java.io.Serializable;

/**
 * 数据库扩展表实体类
 */
@Data
@TableName("ss_res_ext_db")
public class SsResExtDb implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 数字资源标识
     */
    @TableId
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * chatbi知识库ID
     */
    private String chatbiBaseId;
}

