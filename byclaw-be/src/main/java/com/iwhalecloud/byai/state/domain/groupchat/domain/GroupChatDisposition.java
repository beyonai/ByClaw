package com.iwhalecloud.byai.state.domain.groupchat.domain;

import lombok.Data;

/** Agent 写入工作区的群聊委派判定。 */
@Data
public class GroupChatDisposition {
    private String schemaVersion;
    private String dispatchId;
    private String kind;
    private String taskName;
    private String ackText;
}
