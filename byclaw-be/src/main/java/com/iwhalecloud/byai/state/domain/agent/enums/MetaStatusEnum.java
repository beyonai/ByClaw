package com.iwhalecloud.byai.state.domain.agent.enums;

import com.google.common.collect.ImmutableList;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.List;

/**
 * @author zht
 * @version 1.0
 * @date 2025/4/28
 */
@Getter
@AllArgsConstructor
public enum MetaStatusEnum {
    //0=草稿箱，1,4=待上架，2=已上架，3=已下架
    DRAFT(0),
    TODO_UP(1),
    UP(2),
    DOWN(3),
    SECOND_UP(4);
    private final int code;

    public static List<Integer> getUpStatusList() {
        return ImmutableList.of(MetaStatusEnum.UP.getCode(), MetaStatusEnum.SECOND_UP.getCode());
    }

}
