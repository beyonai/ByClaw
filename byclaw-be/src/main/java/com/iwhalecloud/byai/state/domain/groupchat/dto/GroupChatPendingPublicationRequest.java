package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.ArrayList;
import java.util.List;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/** Tool 与登录客户端共用的待发布内容输入；文件为当前用户桶内的绝对路径。 */
@Data
public class GroupChatPendingPublicationRequest {
    @Size(max = 100000)
    private String text;
    @Size(max = 100)
    private List<@NotBlank @Size(max = 4096) String> sourcePaths = new ArrayList<>();
}
