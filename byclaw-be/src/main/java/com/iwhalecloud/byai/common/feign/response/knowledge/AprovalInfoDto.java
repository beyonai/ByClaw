package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Setter
@Getter
public class AprovalInfoDto {
    /**
     * 需要直接取消订阅的资源ID列表
     */
    private List<Long> objIdList;

}
