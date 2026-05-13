package com.iwhalecloud.byai.manager.dto.ontology;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Date;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 对象详情查询响应DTO
 * 包含对象基本信息、对象属性、动作列表及动作属性
 */
@Getter
@Setter
@Schema(description = "对象详情查询响应")
public class OntologyDetailResponse {

    /**
     * 对象资源ID
     */
    @Schema(description = "对象资源ID", example = "123456")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 对象名称
     */
    @Schema(description = "对象名称", example = "用户对象")
    private String name;

    /**
     * 对象描述
     */
    @Schema(description = "对象描述", example = "用户对象描述")
    private String desc;

    /**
     * 目录ID
     */
    @Schema(description = "目录ID", example = "123456")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long catalogId;

    /**
     * 数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE
     */
    @Schema(description = "数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE", example = "1")
    private Integer sourceType;

    /**
     * 对象属性列表
     */
    @Schema(description = "对象属性列表")
    private List<OntologyBatchSaveRequest.ObjectAttribute> attributes;

    /**
     * 动作列表（包含动作属性）
     */
    @Schema(description = "动作列表（包含动作属性）")
    private List<ActionDetail> actions;

    /**
     * 动作详情（包含动作属性和基本信息）
     */
    @Getter
    @Setter
    @Schema(description = "动作详情")
    public static class ActionDetail {
        /**
         * 动作资源ID
         */
        @Schema(description = "动作资源ID", example = "12345")
        @JsonSerialize(using = ToStringSerializer.class)
        private Long resourceId;

        /**
         * 关联的函数ID（Tool的resourceId）
         */
        @Schema(description = "关联的函数ID（Tool的resourceId）", example = "12345")
        @JsonSerialize(using = ToStringSerializer.class)
        private String toolId;

        /**
         * 函数关联的工具集ID
         */
        @Schema(description = "函数关联的工具集ID", example = "12345")
        @JsonSerialize(using = ToStringSerializer.class)
        private String pluginId;

        /**
         * 动作名称
         */
        @Schema(description = "动作名称", example = "createUser")
        private String name;

        /**
         * 动作描述
         */
        @Schema(description = "动作描述", example = "用户对象描述信息")
        private String desc;

        private Date createTime;

        /**
         * 动作编码
         */
        @Schema(description = "动作编码", example = "getResourceListByPage")
        private String code;

        /**
         * 动作属性列表
         */
        @Schema(description = "动作属性列表")
        private List<OntologyBatchSaveRequest.ActionAttribute> attributes;
    }
}

