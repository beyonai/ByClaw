package com.iwhalecloud.byai.state.domain.session.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
@Getter
public enum SessionType {
    /**
     * 人与超级助手/数字员工单聊
     */
    H_AS("h_as", "人与超级助手/数字员工单聊"),

    /**
     * 群聊
     */
    HS_AS("hs_as", "群聊"),

    /**
     * 人与人单聊
     */
    H_H("h_h", "人与人单聊"),
    /**
     * 通知到人
     */
    N_H("n_h", "通知到人"),
    /**
     * 即时搜问
     */
    H_S_A("h_s_a", "即时搜问");

    final String code;

    final String name;
}
