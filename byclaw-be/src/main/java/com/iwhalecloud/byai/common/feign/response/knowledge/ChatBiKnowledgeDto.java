package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class ChatBiKnowledgeDto {

    /**
    * 知识库id
    */
    private String knowledgeBaseId;

    /**
     * 数据库名称
     */

    private String knowledgeBaseName;
    /**
     * 数据库类型
     * 1:默认1
     */
    private Integer knowledgeBaseType;

    /**
     * 描述
     */
    private String knowledgeBaseComment;

}
