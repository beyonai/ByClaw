package com.iwhalecloud.byai.common.feign.request.knowledge;

import java.util.Collection;
import java.util.List;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class FeignPage {
    private Long pageCount;

    private Long pageIndex;

    private Long pageSize;

    private Long total;

    private Long current;

    private Long resourceStatus;

    private String appName;

    // 归属类型：1=我创建的，2=我管理的
    private Integer ownershipType;

    // 资源状态：0=草稿箱，1=待上架，2=已上架，3=已下架
    private List<Integer> statusList;

    private Long projectId;

    /**
     * 数据员工使用
     */
    private Collection<Long> appIdList;

    private Long businessUserId;

    public static FeignPage init() {
        FeignPage feignPage = new FeignPage();
        feignPage.setPageIndex(1L);
        feignPage.setPageSize(10L);
        return feignPage;
    }
}
