package com.iwhalecloud.byai.common.feign.client;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 知识库服务标准动作定义。
 * 这里统一维护系统内部约定的 operationId，以及百应自有知识库模式下对应的固定 path。
 * 当系统接第三方知识库时，会按同名 operationId 去导入 JSON 的 openapiSchema.paths 中找真实 path；
 * 当系统使用百应自有知识库时，则直接使用这里定义的固定 path。
 *
 * @author qin.guoquan
 * @date 2026-04-22 11:10:00
 */
@Getter
@AllArgsConstructor
public enum KnowledgeServiceOperation {

    CREATE_KB("createKb", "/api/v1/knowledgeBases/create"),
    DELETE_KB("deleteKb", "/api/v1/knowledgeBases/delete"),
    UPDATE_KB("updateKb", "/api/v1/knowledgeBases/update"),
    CREATE_DIR("createDir", "/api/v1/directories/create"),
    EDIT_DIR("editDir", "/api/v1/directories/update"),
    LIST_DIR("listDir", "/api/v1/listDir"),
    DELETE_DIR("deleteDir", "/api/v1/directories/delete"),
    UPLOAD_FILE("uploadFile", "/api/v1/knowledgeItems/import"),
    DELETE_FILE("deleteFile", "/api/v1/knowledgeItems/delete"),
    READ_FILE("readFile", "/api/v1/readFile"),
    MOVE_KNOWLEDGE_ITEMS("moveKnowledgeItems", "/api/v1/knowledgeItems/move"),
    KNOWLEDGE_ITEM_REFERENCES("knowledgeItemReferences", "/api/v1/knowledgeItems/references"),
    GLOB("glob", "/api/v1/glob"),
    KNOWLEDGE_SEARCH("knowledgeSearch", "/api/v1/knowledgeItems/search"),
    KNOWLEDGE_FILE_SEARCH("knowledgeFileSearch", "/api/v1/knowledgeItems/searchFile"),
    FILE_TO_MARKDOWN("fileToMarkdown", "/api/v1/fileToMarkdown"),
    KNOWLEDGE_BUILD("knowledgeBuild", "/api/v1/fileToMarkdownIndex"),
    DOWNLOAD_FILE("downloadFile", "/api/v1/downloadFile"),
    FILE_BUILD_STATUS("fileBuildStatus", "/api/v1/fileBuildStatus");

    private final String operationId;

    private final String localPath;
}
