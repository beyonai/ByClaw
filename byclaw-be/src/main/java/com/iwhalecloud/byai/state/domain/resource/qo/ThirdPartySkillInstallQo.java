package com.iwhalecloud.byai.state.domain.resource.qo;

import lombok.Data;

/** 第三方技能超市安装请求。
 *
 * @author qin.guoquan
 * @date 2026-07-17 10:50:57
 */
@Data
public class ThirdPartySkillInstallQo {

    private Long digId;

    private String downloadUrl;
}
