package com.iwhalecloud.byai.state.domain.chat.dto;

import com.alibaba.fastjson.annotation.JSONField;
import lombok.Getter;
import lombok.Setter;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/10/16 16:28
 */
@Getter
@Setter
public class ChatFunctionCloudQo {

    /**
     * { "jingjiaSystem": false, "googleChrome": false }
     */
    @JSONField(name = "jingjiaSystem")
    private Boolean jingjiaSystem = false;

    @JSONField(name = "googleChrome")
    private Boolean googleChrome = false;

}
