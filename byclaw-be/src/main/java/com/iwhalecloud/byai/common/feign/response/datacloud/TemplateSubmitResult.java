package com.iwhalecloud.byai.common.feign.response.datacloud;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.Map;

/**
 * 单个工作区模板提交结果。
 */
@Getter
@Setter
public class TemplateSubmitResult {

    /**
     * 模板编码
     */
    private String template;

    /**
     * 对象编码列表
     */
    @JsonProperty("object_codes")
    @JSONField(name = "object_codes")
    private List<String> objectCodes;

    /**
     * 动作编码列表
     */
    @JsonProperty("action_codes")
    @JSONField(name = "action_codes")
    private List<String> actionCodes;

    /**
     * 发布 ID
     */
    @JsonProperty("publish_id")
    @JSONField(name = "publish_id")
    private String publishId;

    /**
     * 已提交的视图列表
     */
    @JsonProperty("submitted_views")
    @JSONField(name = "submitted_views")
    private List<String> submittedViews;

    /**
     * 失败明细
     */
    private List<String> failed;

    /**
     * 对象编码 → 自动生成 SDK 文件内容
     */
    @JsonProperty("sdk_files")
    @JSONField(name = "sdk_files")
    private Map<String, String> sdkFiles;

    /**
     * 当前模板是否成功
     */
    private Boolean ok;

    /**
     * 已提交的对象编码列表
     */
    @JsonProperty("submitted_objects")
    @JSONField(name = "submitted_objects")
    private List<String> submittedObjects;

    /**
     * 工作区名称
     */
    @JsonProperty("workspace_name")
    @JSONField(name = "workspace_name")
    private String workspaceName;

    /**
     * 目标数据源 / 租户上下文
     */
    private TemplateSubmitTarget target;
}
