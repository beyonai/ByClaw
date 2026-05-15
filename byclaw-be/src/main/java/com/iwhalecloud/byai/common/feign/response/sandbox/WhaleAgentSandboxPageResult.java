package com.iwhalecloud.byai.common.feign.response.sandbox;

import java.util.List;

import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxDetail;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class WhaleAgentSandboxPageResult {

    private List<SandboxDetail> items;

    private Pagination pagination;

    @Getter
    @Setter
    public static class Pagination {
        private Boolean hasNextPage;
        private Integer page;
        private Integer pageSize;
        private Integer totalItems;
        private Integer totalPages;
    }
}
