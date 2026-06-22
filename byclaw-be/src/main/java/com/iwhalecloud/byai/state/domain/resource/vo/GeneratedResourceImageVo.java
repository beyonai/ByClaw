package com.iwhalecloud.byai.state.domain.resource.vo;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 资源图片生成结果。
 *
 * @author qin.guoquan
 * @date 2026-06-21 20:38:38
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class GeneratedResourceImageVo {

    private String imageBase64;

    private String mimeType;

    private String fileName;
}
