package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import java.io.Serializable;
import lombok.Data;

/**
 * 本体场景扩展表实体类。
 *
 * @author qin.guoquan
 * @date 2026-07-05 15:38:38
 */
@Data
@TableName("ss_res_ext_scene")
public class SsResExtScene implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    @TableField("scene_code")
    private String sceneCode;

    @TableField("source_content")
    private String sourceContent;

    @TableField("target_content")
    private String targetContent;
}
