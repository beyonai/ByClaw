package com.iwhalecloud.byai.manager.entity.source;


import java.util.List;
import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class SystemQo {

    private List<String> types;

    private List<Long> catalogIds;

    private String keyword;

    private List<Integer> statusList;

    private Long orgId;
}
