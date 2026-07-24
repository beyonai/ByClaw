package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class MemberBatchDTO {

    private Long projectId;

    private List<Long> userIds;
}
