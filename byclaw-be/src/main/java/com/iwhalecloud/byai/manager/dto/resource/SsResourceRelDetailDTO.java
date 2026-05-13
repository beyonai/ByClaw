package com.iwhalecloud.byai.manager.dto.resource;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAttribute;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDbDataset;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtTool;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtToolKit;
import java.util.Date;
import java.util.List;
import lombok.Data;

/**
 * 资源关联明细DTO（包含关联查询的资源类型字段）
 * 
 * @author system
 * @date 2025-01-XX
 */
@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
public class SsResourceRelDetailDTO {

    /**
     * 关联关系明细ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceRelDetailId;

    /**
     * 资源来源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 关联资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long relResourceId;

    /**
     * 关联子资源的信息
     */
    private String relResourceInfo;

    /**
     * 创建人ID
     */
    private Long createBy;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 更新人ID
     */
    private Long updateBy;

    /**
     * 更新时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updateTime;

    /**
     * 所属企业ID
     */
    private Long comAcctId;

    /**
     * 关联类型名称（主从关系ID，格式：主id:从id）
     */
    private String relTypeName;

    /**
     * 关联状态（1-开启，0-关闭）
     */
    private Integer relStatus;

    /**
     * 资源类型（resourceId对应的resource_type，ATOM：原子资源/COMBIN：组合资源）
     * 该字段通过关联查询 ss_resource 表获取
     */
    private String resourceType;

    /**
     * 资源编码
     */
    private String resourceCode;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 资源描述
     */
    private String resourceDesc;

    /**
     * 资源业务类型
     */
    private String resourceBizType;

    /**
     * 关联资源的类型（relResourceId对应的resource_type，ATOM：原子资源/COMBIN：组合资源）
     * 该字段通过关联查询 ss_resource 表获取
     */
    private String relResourceType;

    /**
     * 关联资源的业务类型（relResourceId对应的resource_biz_type，如 VIEW、OBJECT）
     */
    private String relResourceBizType;

    /**
     * 关联资源的属性列表（视图为出参，对象为全部属性）
     */
    private List<SsResExtAttribute> relResourceAttributes;

    /**
     * 文档知识库扩展（KG_DOC）
     */
    private SsResExtDoc extDoc;

    /**
     * 工具扩展（TOOL）
     */
    private SsResExtTool extTool;

    /**
     * 插件扩展（TOOLKIT）
     */
    private SsResExtToolKit extToolKit;

    /**
     * 数据知识库扩展（KG_DB），防御性使用列表
     */
    private List<SsResExtDbDataset> extDbDatasets;
}

