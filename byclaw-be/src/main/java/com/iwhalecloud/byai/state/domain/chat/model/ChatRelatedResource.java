package com.iwhalecloud.byai.state.domain.chat.model;

import java.util.List;

import com.iwhalecloud.byai.state.domain.chat.enums.ChatRelatedResourceTypeEnum;

import lombok.Data;

@Data
public class ChatRelatedResource {

    /**
     * 资源主键
     */
    private String documentId;

    /**
     * 资源主键
     */
    private String id;

    /**
     * 资源标题（网站标题、文件名称）
     */
    private String title;

    /**
     * 资源内容
     */
    private String content;

    /**
     * 类型：知识库、联网检索
     */
    private ChatRelatedResourceTypeEnum type;

    /**
     * 如果是知识库subType是文件类型， 如果是联网检索，检索来源
     */
    private String subType;

    /**
     * 联网检索内容的时间、知识库的知识创建时间
     */
    private String resourceTime;

    private String url;

    private String documentUrl;

    private List<ChatRelatedResource> chunkList;
}
