package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.List;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import lombok.Data;

/** 创建群聊及同名项目；创建人由服务端登录态确定。 */
@Data
public class GroupChatCreateRequest {
    @NotBlank
    @Size(max = 100)
    private String name;
    /** 真人成员名单，创建人自动加入，无需重复传入。 */
    private List<@NotNull @Positive Long> userIds;
    /** 数字员工仅加入群聊，不写入项目成员。 */
    private List<@NotNull @Positive Long> agentIds;
}
