package com.iwhalecloud.byai.common.feign.request.datacloud;

import com.alibaba.fastjson.annotation.JSONField;
import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.Map;

/**
 * 调用知识库动作 arguments 常用字段。
 * <p>
 * write_*：sourcePath / content / labels / fileDescription<br>
 * search_*：query / select / filters / limit<br>
 * delete_kb_*：sourcePath
 */
@Getter
@Setter
public class Arguments {

    /** 文档在知识库中的路径，必须以 / 开头（write_* / delete_kb_*） */
    @JSONField(name = "source_path")
    private String sourcePath;

    /** Markdown 文档正文（write_*） */
    private String content;

    /** 元数据标签（write_*） */
    private Map<String, Object> labels;

    /** 文件描述（write_*） */
    @JSONField(name = "file_description")
    private String fileDescription;

    /** 语义检索文本（search_*） */
    private String query;

    /** 返回字段列表（search_*） */
    private List<String> select;

    /** 过滤条件（search_*），元素含 field / op / value */
    private List<Map<String, Object>> filters;

    /** 最大返回记录数（search_*） */
    private Integer limit;
}
