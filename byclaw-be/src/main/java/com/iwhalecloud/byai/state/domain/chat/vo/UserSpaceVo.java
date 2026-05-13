package com.iwhalecloud.byai.state.domain.chat.vo;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-05-13 19:30:00
 * @description TODO
 */
@Getter
@Setter
public class UserSpaceVo {

    private String name;

    private String filePath;

    private boolean isDir = false;
}
