package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class GroupChatJoinNumberRequest {
    @NotBlank
    @Pattern(regexp = "[1-9][0-9]{0,18}")
    private String groupNumber;
}
