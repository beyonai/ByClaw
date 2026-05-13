package com.iwhalecloud.byai.manager.infrastructure.embedding.request;

import java.util.List;

import lombok.Data;

/**
 * @description:
 * @author: cxf
 * @create: 2023-11-30 17:22
 **/
@Data
public class CallEmbeddingQo {

    // 这个参数名是老团队定义的，访问的url连接也是他们找的
    private List<String> texts;

    // docchain团队说，docchain的参数名是input
    private List<String> input;

    // 是否批量
    private boolean auto_batch = true;
}
