package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class GroupChatJoinReviewRequest {
    @NotNull
    private Boolean approved;
}
