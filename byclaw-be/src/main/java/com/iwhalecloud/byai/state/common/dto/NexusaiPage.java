package com.iwhalecloud.byai.state.common.dto;

import lombok.Data;

@Data
public class NexusaiPage {
    private Long pageNum;
    private Long pageSize;

    public NexusaiPage init(NexusaiPage nexusaiPage) {
        if (nexusaiPage.getPageNum() == null) {
            nexusaiPage.setPageNum(1L);
        }
        if (nexusaiPage.getPageSize() == null) {
            nexusaiPage.setPageSize(10L);
        }
        if (nexusaiPage.getPageSize() > 100L || nexusaiPage.getPageSize() < 0L) {
            nexusaiPage.setPageSize(100L);
        }
        return nexusaiPage;
    }
}
