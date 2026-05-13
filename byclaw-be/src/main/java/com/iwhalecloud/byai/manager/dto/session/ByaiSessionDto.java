package com.iwhalecloud.byai.manager.dto.session;

import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class ByaiSessionDto extends ByaiSession {

    /**
     * 图标
     */
    private String avatar;

    /**
     * 扩展属性
     */
    private List<ByaiSessionExt> sessionExts;

}
