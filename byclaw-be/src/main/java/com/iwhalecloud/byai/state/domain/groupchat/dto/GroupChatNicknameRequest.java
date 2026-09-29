package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class GroupChatNicknameRequest {
    @NotBlank
    @Size(max = 100)
    private String nickname;
}
