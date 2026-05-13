package com.iwhalecloud.byai.manager.qo.resource;


import java.util.List;
import java.util.Set;
import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class ResourceRelationQo {

    private Long resourceId;

    // 要查询的数字员工的值
    private List<Long> resourceIds;

    private String resourceName;

    private List<String> resourceBizTypeList;


    // 过滤有权限的
    private Set<Long> resourceIdList;


    private Integer pageNum;


    private Integer pageSize;


}
