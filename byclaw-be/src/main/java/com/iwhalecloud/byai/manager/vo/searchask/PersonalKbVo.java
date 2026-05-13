package com.iwhalecloud.byai.manager.vo.searchask;

import com.iwhalecloud.byai.common.page.PageInfo;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-03-11 15:53:09
 * @description TODO
 */
@Getter
@Setter
public class PersonalKbVo {

    private List<SpaceKbResourceVo> selectedKbs;

    private PageInfo<SpaceResourceVo> pageInfo;

}
