package com.iwhalecloud.byai.common.feign.request.knowledge;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-08-08 10:30:32
 * @description TODO
 */
@Getter
@Setter
public class OpenFileTagDTO {

    private List<OpenFileTag> files;
}
