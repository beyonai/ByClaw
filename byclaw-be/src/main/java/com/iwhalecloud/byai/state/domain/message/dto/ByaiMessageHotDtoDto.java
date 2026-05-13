package com.iwhalecloud.byai.state.domain.message.dto;

import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.Set;

/**
 * @author he.duming
 * @date 2026-02-13 14:33:36
 * @description TODO
 */
@Getter
@Setter
public class ByaiMessageHotDtoDto extends ByaiMessageHotDto {

    private Long objId;

    private String objType;

    private List<String> collectIds;

    private String creatorName;

    /**
     * 提及的用户ID集合
     */
    private Set<Long> mentionUserIds;

    private String contentTags;

}
