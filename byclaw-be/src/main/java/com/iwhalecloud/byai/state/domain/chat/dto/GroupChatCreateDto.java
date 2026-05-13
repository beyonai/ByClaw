package com.iwhalecloud.byai.state.domain.chat.dto;

import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-02-17 10:38:52
 * @description TODO
 */
@Getter
@Setter
public class GroupChatCreateDto {

    /**
     * 创建的会话信息
     */
    private ByaiSession session;

    /**
     * 创建的成员列表
     */
    private List<ByaiSessionMember> members;
}
