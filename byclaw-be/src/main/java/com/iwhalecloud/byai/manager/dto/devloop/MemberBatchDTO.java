package com.iwhalecloud.byai.manager.dto.devloop;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class MemberBatchDTO {

    private Long projectId;

    private List<Long> userIds;
}
