package com.iwhalecloud.byai.common.message.pojo;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * 批量文档操作体：同一索引下的创建/更新/删除文档集合。
 *
 * @author he.duming
 * @since 2026-02-03
 */
@Setter
@Getter
public class BulkDocumentBody {

    private String indexName;

    private List<CreateDocument> createBulks;

    private List<UpdateDocument> updateBulks;

    private List<DeleteDocument> deleteBulks;

    /**
     * 批量操作构造器，必须指定索引
     * 
     * @param indexName 索引名称
     */
    public BulkDocumentBody(String indexName) {
        this.indexName = indexName;

        this.createBulks = new ArrayList<>();

        this.updateBulks = new ArrayList<>();

        this.deleteBulks = new ArrayList<>();
    }

    /**
     * 新增创创建文档
     * 
     * @param createDocument 文档对象
     */
    public void add(CreateDocument createDocument) {
        createBulks.add(createDocument);
    }

    /**
     * 新增更新类型文档
     * 
     * @param updateDocument 文档
     */
    public void add(UpdateDocument updateDocument) {
        updateBulks.add(updateDocument);
    }

    /**
     * 删除文档
     *
     * @param deleteDocument 文档
     */
    public void add(DeleteDocument deleteDocument) {
        deleteBulks.add(deleteDocument);
    }
}