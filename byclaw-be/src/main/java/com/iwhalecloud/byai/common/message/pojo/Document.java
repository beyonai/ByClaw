package com.iwhalecloud.byai.common.message.pojo;

import lombok.Getter;
import lombok.Setter;

/**
 * 文档基类：仅包含文档 id。
 *
 * @author he.duming
 * @since 2026-02-03
 */
@Getter
@Setter
public abstract class Document {

    protected String id;

}