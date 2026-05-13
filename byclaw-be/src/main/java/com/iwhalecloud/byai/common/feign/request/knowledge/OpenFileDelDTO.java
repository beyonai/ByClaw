package com.iwhalecloud.byai.common.feign.request.knowledge;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-08-08 10:12:30
 * @description TODO
 */
@Getter
@Setter
public class OpenFileDelDTO {

    private List<Long> fileIds;
}
