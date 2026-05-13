package com.iwhalecloud.byai.manager.dto.ontology;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 对象批量保存请求DTO（resourceId必填，用于更新已有对象）
 */
@Getter
@Setter
@Schema(description = "对象批量保存请求")
public class OntologyBatchSaveRequest {

    /**
     * 对象列表
     */
    @NotNull(message = "对象列表不能为空")
    @jakarta.validation.constraints.NotEmpty(message = "对象列表不能为空")
    @Valid
    @Schema(description = "对象列表", requiredMode = Schema.RequiredMode.REQUIRED)
    private List<ObjectSaveRequest> objects;

    /**
     * 对象保存信息
     */
    @Getter
    @Setter
    @Schema(description = "对象保存信息")
    public static class ObjectSaveRequest {

        private static final long serialVersionUID = 1L;

        /**
         * 资源ID（必填）
         */
        @NotNull(message = "资源ID不能为空")
        @Schema(description = "资源ID", requiredMode = Schema.RequiredMode.REQUIRED, example = "123456")
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
        private Long catalogId;

        /**
         * 数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE
         */
        @Schema(description = "数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE", example = "1")
        private Integer sourceType;

        /**
         * 对象属性列表
         */
        @Valid
        @Schema(description = "对象属性列表")
        private List<ObjectAttribute> attributes;

        /**
         * 函数列表
         */
        @Valid
        @Schema(description = "函数列表")
        private List<FunctionInfo> functions;

        /**
         * 动作列表
         */
        @Valid
        @Schema(description = "动作列表")
        private List<ActionInfo> actions;

        /**
         * 关联对象列表
         */
        @Valid
        @Schema(description = "关联对象列表")
        private List<RelationInfo> relations;
    }

    /**
     * 对象属性信息
     */
    @Getter
    @Setter
    @Schema(description = "对象属性信息")
    public static class ObjectAttribute {

        /**
         * 属性ID（扩展属性主键，用于判断是新增还是修改）
         * 如果为空，表示新增；如果不为空，表示修改
         */
        @Schema(description = "属性ID（扩展属性主键），为空表示新增，不为空表示修改）", example = "123456")
        @JsonSerialize(using = ToStringSerializer.class)
        private Long extAttributeId;

        @NotBlank(message = "属性类型不能为空")
        @Schema(description = "属性类型：in_param-入参，out_param-出参，script-脚本，basic-基本属性，promt-提示词",
                requiredMode = Schema.RequiredMode.REQUIRED, example = "basic")
        private String attributeType;

        @NotBlank(message = "属性编码不能为空")
        @Schema(description = "属性编码", requiredMode = Schema.RequiredMode.REQUIRED, example = "user_id")
        private String attributeCode;

        @Schema(description = "参数值", example = "123456")
        private String attributeValue;

        @NotBlank(message = "数据类型不能为空")
        @Schema(description = "数据类型：String、Integer、Number、Array、Object、Enum",
                requiredMode = Schema.RequiredMode.REQUIRED, example = "String")
        private String type;

        @Schema(description = "属性值正则校验规则", example = "^[a-zA-Z0-9]{1,32}$")
        private String formatExpSt;

        @Schema(description = "单位", example = "元")
        private String unit;

        @Schema(description = "是否必填：0-否，1-是", example = "1")
        private Integer isRequired;

        @Schema(description = "关联的术语类型编码", example = "TERM_TYPE_001")
        private String termTypeCode;

        private String termTypeName;

        /**
         * 属于类型是枚举还是列表
         * 1-枚举
         * 2-列表
         */
        private String termDataType;

        /**
         * 术语库id
         */
        private String datasetId;

        @Schema(description = "关联术语字段：code/name", example = "id")
        private String termField;

        @Schema(description = "属性描述", example = "用户ID")
        private String attributeDesc;

        @Schema(description = "扩展元数据（JSON字符串格式）", example = "{\"is_biz_id\":\"0\",\"is_obj_id\":\"0\",\"is_obj_name\":\"0\"}")
        private String extMeta;

        private Integer isBizId;

        /**
         * 是否业务标签
         */
        private Integer isBizLabel;

        /**
         * 权限维度
         */
        private String perDataScopeType;

        /**
         * 是否查询条件
         */
        private Boolean isQueryAttr = false;

        /**
         * 属性关联的函数信息
         */
        private List<FunctionInfo> relInfos;

        @Schema(description = "排序", example = "1")
        private Integer sort;
    }

    /**
     * 函数信息
     */
    @Getter
    @Setter
    @Schema(description = "函数信息")
    public static class FunctionInfo {


        /**
         * 参数类型，input-入参 output-出参
         */
        private String paramType;


        /**
         * 函数名字
         */
        private String relToolName;

        private String relToolParam;


        /**
         * 关联插件资源ID（用于extMeta）
         */
        @Schema(description = "关联插件资源ID", example = "1500578947808698368")
        @JsonSerialize(using = ToStringSerializer.class)
        private String relPluginResourceId;

        /**
         * 关联工具资源ID（用于extMeta）
         */
        @Schema(description = "关联工具资源ID", example = "1500568553456766976")
        @JsonSerialize(using = ToStringSerializer.class)
        private String relToolResourceId;

        /**
         * 关联工具参数路径（用于extMeta，如：input.staffCode）
         */
        @Schema(description = "关联工具参数路径", example = "input.staffCode")
        private String relToolParamXpath;

        /**
         * 在原参数中是否必填
         */
        private Integer relParamIsRequired;
    }


    /**
     * 动作信息
     */
    @Getter
    @Setter
    @Schema(description = "动作信息")
    public static class ActionInfo {

        /**
         * 动作资源ID（如果存在，表示修改；如果不存在，表示新增）
         */
        @Schema(description = "动作资源ID（如果存在，表示修改；如果不存在，表示新增）", example = "12345")
        @JsonSerialize(using = ToStringSerializer.class)
        private Long resourceId;

        /**
         * 动作资源ID（函数ID）
         */
        @Schema(description = "动作资源ID（函数ID）", example = "12345")
        @JsonSerialize(using = ToStringSerializer.class)
        private Long toolId;

        /**
         * 函数关联的工具集ID
         */
        @Schema(description = "函数关联的工具集ID", example = "12345")
        @JsonSerialize(using = ToStringSerializer.class)
        private Long pluginId;

        /**
         * 动作名称
         */
        @NotBlank(message = "动作名称不能为空")
        @Schema(description = "动作名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "createUser")
        private String name;

        /**
         * 动作描述
         */
        @Schema(description = "动作描述", example = "用户对象描述信息")
        private String desc;

        /**
         * 动作编码
         */
        @Schema(description = "动作编码", example = "getResourceListByPage")
        private String code;

        /**
         * 动作属性列表
         */
        @Valid
        @Schema(description = "动作属性列表")
        private List<ActionAttribute> attributes;
    }

    /**
     * 动作属性信息
     */
    @Getter
    @Setter
    @Schema(description = "动作属性信息")
    public static class ActionAttribute {

        /**
         * 属性ID（扩展属性主键，用于判断是新增还是修改）
         * 如果为空，表示新增；如果不为空，表示修改
         */
        @Schema(description = "属性ID（扩展属性主键），为空表示新增，不为空表示修改）", example = "123456")
        @JsonSerialize(using = ToStringSerializer.class)
        private Long extAttributeId;

        @NotBlank(message = "属性类型不能为空")
        @Schema(description = "属性类型：in_param-入参，out_param-出参，script-脚本，basic-基本属性，promt-提示词",
                requiredMode = Schema.RequiredMode.REQUIRED, example = "in_param")
        private String attributeType;

        @NotBlank(message = "属性编码不能为空")
        @Schema(description = "属性编码", requiredMode = Schema.RequiredMode.REQUIRED, example = "user_id")
        private String attributeCode;

        @Schema(description = "参数值", example = "123456")
        private String attributeValue;

        @NotBlank(message = "数据类型不能为空")
        @Schema(description = "数据类型：String、Integer、Number、Array、Object、Enum",
                requiredMode = Schema.RequiredMode.REQUIRED, example = "String")
        private String type;

        @Schema(description = "属性值正则校验规则", example = "^[a-zA-Z0-9]{1,32}$")
        private String formatExpSt;

        @Schema(description = "单位", example = "元")
        private String unit;

        @Schema(description = "是否必填：0-否，1-是", example = "1")
        private Integer isRequired;

        @Schema(description = "是否必填：0-否，1-是", example = "1")
        private Integer relParamIsRequired;

        @Schema(description = "关联的术语类型编码", example = "TERM_TYPE_001")
        private String termTypeCode;

        private String termTypeName;
        /**
         * 属于类型是枚举还是列表
         * 1-枚举
         * 2-列表
         */
        private String termDataType;
        /**
         * 术语库id
         */
        private String datasetId;

        @Schema(description = "关联术语字段：id/name", example = "id")
        @JsonSerialize(using = ToStringSerializer.class)
        private String termField;


        /**
         * - `user`: 用户维度 - 检查是否有查看用户列表的权限
         * - `org`: 组织维度 - 检查是否有查看组织列表的权限
         * - `position`: 岗位维度 - 检查是否有查看岗位列表的权限
         * - `station`: 驻地维度 - 检查是否有查看驻地列表的权限
         */
        private String perDataScopeType;

        @Schema(description = "属性描述", example = "用户ID")
        private String attributeDesc;

        @Schema(description = "扩展元数据（JSON字符串格式）", example = "{\"rel_obj_id\":\"\",\"rel_obj_attribute_id\":\"\",\"action_xpath\":\"\"}")
        private String extMeta;

        /**
         * 是否业务主键：0-否，1-是
         */
        @Schema(description = "是否业务主键：0-否，1-是", example = "1")
        private Integer isBizId;

        /**
         * 关联的插件资源ID
         */
        @Schema(description = "关联的插件资源ID", example = "1500578947808698368")
        @JsonSerialize(using = ToStringSerializer.class)
        private String relPluginResourceId;

        /**
         * 关联的插件资源ID
         */
        @Schema(description = "关联的工具/函数资源ID", example = "1500578947808698368")
        @JsonSerialize(using = ToStringSerializer.class)
        private String relToolResourceId;

        /**
         * 关联工具参数路径
         */
        @Schema(description = "关联工具参数路径", example = "input.staffId")
        private String relToolParamXpath;

        /**
         * 关联对象ID
         */
        @Schema(description = "关联对象ID", example = "10809145")
        @JsonSerialize(using = ToStringSerializer.class)
        private String relObjId;

        /**
         * 关联对象属性ID
         */
        @Schema(description = "关联对象属性ID", example = "10809542")
        @JsonSerialize(using = ToStringSerializer.class)
        private String relObjAttributeId;

        /**
         * 在动作的参数路径
         */
        @Schema(description = "在动作的参数路径", example = "userId")
        private String actionXpath;

        @Schema(description = "排序", example = "1")
        private Integer sort;

        @Schema(description = "数据来源表编码", example = "po_users")
        private String sourceTableCode;
    }

    /**
     * 关联对象信息
     */
    @Getter
    @Setter
    @Schema(description = "关联对象信息")
    public static class RelationInfo {

        /**
         * 关联对象ID（可选，如果已存在则直接关联）
         */
        @Schema(description = "关联对象ID（可选，如果已存在则直接关联）", example = "789012")
        @JsonSerialize(using = ToStringSerializer.class)
        private Long relId;

        /**
         * 关联对象基本信息（当relId为空时需要创建）
         */
        @Valid
        @Schema(description = "关联对象基本信息（当relId为空时需要创建）")
        private RelationObjectInfo relationObject;
    }

    /**
     * 关联对象基本信息
     */
    @Getter
    @Setter
    @Schema(description = "关联对象基本信息")
    public static class RelationObjectInfo {

        /**
         * 对象名称
         */
        @Schema(description = "对象名称", example = "订单对象")
        private String name;

        /**
         * 对象描述
         */
        @Schema(description = "对象描述", example = "订单对象描述")
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
         * 对象类型（固定为OBJECT）
         */
        @Schema(description = "对象类型（固定为OBJECT）", example = "OBJECT")
        private String type;
    }
}

