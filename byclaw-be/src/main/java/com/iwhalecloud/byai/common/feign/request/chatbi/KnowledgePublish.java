package com.iwhalecloud.byai.common.feign.request.chatbi;


import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-05-10 19:43:40
 * @description TODO
 */
@Getter
@Setter
public class KnowledgePublish {

    /**
     * 知识库id
     */
    private Long knowledgeBaseId;
    /**
     * org组织，user用户
     */
    private String publishObjType;

    /**
     * 0查看，1编辑
     */
    private String privilegeType;

    /**
     * 组织id或者用户id
     */
    private Long publishObjId;

}
