package com.iwhalecloud.byai.manager.entity.searchask;

import java.io.Serializable;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

/**
 * 空间目录关联关系表实体，对应表：byai_space_dir_rel
 */
@Data
@TableName("byai_space_dir_rel")
public class SpaceDirRel implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 目录关联ID */
    @TableId
    private Long dirRelId;

    /** 目录ID */
    private Long dirId;

    /** 业务数据ID */
    private Long dataId;

    /** 数据类型，取值：REQUEST:归档请求, SHOWCASE:成果空间, RESOURCE:资源, FILE:文件 */
    private String dataType;

    /** 扩展信息（JSON 格式） */
    private String extJson;
}
