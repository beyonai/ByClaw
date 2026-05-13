package com.iwhalecloud.byai.state.domain.session.dto;

import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * @author he.duming
 * @date 2026-02-14 17:13:15
 * @description TODO
 */
@Getter
@Setter
public class SessionMembersDto extends ByaiSession {

    private List<String> messageIds;

    /**
     * 会话成员列表
     */
    private List<ByaiSessionMember> members = new ArrayList<>();;

    /**
     * 会话的扩展属性
     */
    private List<ByaiSessionExt> sessionExts = new ArrayList<>();
}
