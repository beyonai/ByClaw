package com.iwhalecloud.byai.common.message.pojo;

/**
 * 删除文档请求：按文档 id 删除。
 *
 * @author he.duming
 * @since 2026-02-03
 */
public class DeleteDocument extends Document {

    public DeleteDocument(String id) {
        this.id = id;
    }
}