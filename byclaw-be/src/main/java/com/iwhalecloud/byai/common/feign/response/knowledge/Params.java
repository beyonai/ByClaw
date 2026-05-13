package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-08-01 15:45:36
 * @description TODO
 */
@Getter
@Setter
public class Params implements Serializable {

    private List<String> texts;
}
