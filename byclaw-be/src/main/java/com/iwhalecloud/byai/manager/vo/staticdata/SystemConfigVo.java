package com.iwhalecloud.byai.manager.vo.staticdata;

import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-01-08 22:36:37
 * @description TODO
 */
@Getter
@Setter
public class SystemConfigVo extends ByaiSystemConfig {

    private String cacheJson;
}
