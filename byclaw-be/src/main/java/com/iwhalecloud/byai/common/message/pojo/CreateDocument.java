package com.iwhalecloud.byai.common.message.pojo;

import lombok.Getter;
import lombok.Setter;

/**
 * 创建文档请求：包含文档 id 与 JSON source。
 *
 * @author he.duming
 * @since 2026-02-03
 */
@Getter
@Setter
public class CreateDocument extends Document {

    private String source;

}