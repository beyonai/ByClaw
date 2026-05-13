package com.iwhalecloud.byai.manager.qo.index;

import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-12-02 15:05:07
 * @description TODO
 */
@Getter
@Setter
public class AuthResourceQo extends AuthQo {

    /**
     * 资源类型
     */
    private List<String> resourceBizTypes;

    /**
     * all:全部,authorize-授权给我的 + owner-我创建的
     */
    private String type;

}
