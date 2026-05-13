package com.iwhalecloud.byai.manager.qo.resource;

import java.util.List;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class PrivListQo {

    private String name;

    private Integer pageSize;

    private Integer pageNum;

    private String type;

    private List<Long> forceIds;

    private List<Long> availableIds;

    private List<Long> resourceIdList;

    private Long userId;

    private List<Long> grantToIdList;

    private List<Long> grantObjIdList;

    /**
     * 终端类型
     */
    private List<String> terminals;

}
