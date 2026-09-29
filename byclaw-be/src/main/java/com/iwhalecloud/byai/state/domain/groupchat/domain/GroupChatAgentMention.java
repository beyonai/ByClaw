package com.iwhalecloud.byai.state.domain.groupchat.domain;

import java.util.List;

import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;

/** Agent 最终答复中的有效群成员引用及规范化正文。 */
public record GroupChatAgentMention(String normalizedContent, List<ResourceVo> resourceList) {
}
