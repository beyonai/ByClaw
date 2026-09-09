package com.iwhalecloud.byai.manager.dto.resource;

import java.util.ArrayList;
import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * 门户侧知识文件/目录元数据更新请求。
 * 批量新增、修改或删除指定知识文件或目录的元数据字段，整批操作原子提交。
 * 调用方传资源 ID，门户内部转换为 QA 知识库编码后再转发。
 */
@Getter
@Setter
public class KnowledgeFileMetadataUpdateRequest {

    /**
     * 知识库资源标识。门户校验权限后转换为 QA 知识库编码。
     */
    private Long resourceId;

    /**
     * 知识库内文件或目录路径，以 / 开头（门户会做路径规范化）。
     * 可指向文件或目录，必须属于该知识库。
     */
    private String filePath;

    /**
     * 元数据操作列表。整批原子处理，任一失败则不保留部分更改。
     * 同一个属性名在列表中只能出现一次。
     */
    private List<MetadataOperation> operationList = new ArrayList<>();

    /**
     * 单项元数据操作。操作类型支持 set、unset、append、remove、clear。
     */
    @Getter
    @Setter
    public static class MetadataOperation {

        /**
         * 自定义元数据属性名。
         * 不允许写入系统只读字段：fileName、fileType、fileSize、mimeType、
         * createdAt、updatedAt、fileSignature、filePath。
         */
        private String propertyName;

        /**
         * 操作类型。
         * set：属性不存在时新增，已存在时整值覆盖，可通过 valueType 变更类型；
         * unset：删除整个属性，属性不存在也视为成功；
         * append：仅适用于 stringList，追加尚未存在的元素（不重复）；
         * remove：仅适用于 stringList，删除指定元素（不存在也视为成功）；
         * clear：仅适用于 stringList，将属性值置为空列表，不删除属性。
         */
        private String operation;

        /**
         * 值类型。set 时必填，其他操作不传。
         * 仅允许：string、stringList、number、boolean、datetime。
         */
        private String valueType;

        /**
         * 操作值。set、append、remove 时必填；unset、clear 时不传。
         * set 时须与 valueType 一致；datetime 使用 ISO 8601 字符串；
         * append、remove 的 value 必须是非空字符串数组。不接受 null。
         */
        private Object value;
    }
}
