package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Positive;
import com.fasterxml.jackson.annotation.JsonFormat;
import java.util.List;
import lombok.Data;

/** 管理员直接添加群成员请求。 */
@Data
public class GroupChatMemberRequest {
    @NotNull
    private String type;
    /** 多选一次提交；兼容旧客户端传入单个 ID。 */
    @NotEmpty
    @JsonFormat(with = JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY)
    private List<@NotNull @Positive Long> id;
}
