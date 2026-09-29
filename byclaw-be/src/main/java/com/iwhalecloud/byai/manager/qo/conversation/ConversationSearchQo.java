package com.iwhalecloud.byai.manager.qo.conversation;

import com.fasterxml.jackson.annotation.JsonFormat;
import java.time.LocalDateTime;
import lombok.Data;

/** Search filters only: caller identity always comes from the authenticated token. */
@Data
public class ConversationSearchQo {

    private String userCode;

    private Long digitalEmployeeId;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime startTime;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime endTime;

    private String keyword;

    private Integer pageNum = 1;

    private Integer pageSize = 20;
}
