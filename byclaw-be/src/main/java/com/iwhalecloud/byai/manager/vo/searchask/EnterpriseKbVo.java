package com.iwhalecloud.byai.manager.vo.searchask;

import com.iwhalecloud.byai.common.page.PageInfo;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-03-11 16:21:25
 * @description TODO
 */
@Getter
@Setter
public class EnterpriseKbVo {

    private List<SpaceKbResourceVo> selectedKbs;

    private PageInfo<SpaceKbResourceVo> pageInfo;

}
