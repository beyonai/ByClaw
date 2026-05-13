package com.iwhalecloud.byai.common.message.pojo;

import lombok.Getter;
import lombok.Setter;

/**
 * 更新文档请求：含 JSON source，支持 docAsUpsert 非覆盖更新。
 *
 * @author he.duming
 * @since 2026-02-03
 */
@Getter
@Setter
public class UpdateDocument extends Document {

    private String source;

    /**
     * 是否执行非覆盖式更新
     */
    public boolean docAsUpsert;

    public UpdateDocument() {
    }

    public UpdateDocument(boolean docAsUpsert) {
        this.docAsUpsert = docAsUpsert;
    }
}