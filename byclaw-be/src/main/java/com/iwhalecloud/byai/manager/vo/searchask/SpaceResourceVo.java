package com.iwhalecloud.byai.manager.vo.searchask;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-03-04 10:41:19
 * @description TODO
 */
@Getter
@Setter
public class SpaceResourceVo {

    private Long dirId;

    private Long parentDirId;

    private String name;

    private String dataType;

    /**
     * 关联数据标识
     */
    private Long dataId;

}
