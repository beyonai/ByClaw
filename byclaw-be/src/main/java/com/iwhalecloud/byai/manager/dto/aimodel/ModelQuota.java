package com.iwhalecloud.byai.manager.dto.aimodel;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-06-30 20:49:12
 * @description TODO
 */
@Getter
@Setter
public class ModelQuota {

    private Long monthlyQuotaLimit;

    private TokenSaver tokenSaver;
}
