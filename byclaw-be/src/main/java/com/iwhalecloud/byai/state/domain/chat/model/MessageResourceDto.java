package com.iwhalecloud.byai.state.domain.chat.model;

import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * @author zht
 * @version 1.0
 * @date 2025/5/26
 */
@Data
public class MessageResourceDto {
    /**
     * 关联的上传文件
     */
    private List<MessageFileDto> files;

    /**
     * 管理的引用来源
     */
    private List<ChatRelatedResource> resources;

    /**
     * 问答的扩展参数，如慧笔的需要给模板和文件，问数也需要传文件等
     */
    private Map<String, Object> extParams;

    /**
     * 用户@的资源
     */
    private List<ResourceVo> resourceList;
}
