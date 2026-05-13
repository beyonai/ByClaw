package com.iwhalecloud.byai.manager.vo.users;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-05-10 16:32:09
 * @description TODO
 */
@Getter
@Setter
public class UsersOrgPostVo {

    private Long userId;

    private List<UsersOrganizationVo> usersOrganizationVos;

}
