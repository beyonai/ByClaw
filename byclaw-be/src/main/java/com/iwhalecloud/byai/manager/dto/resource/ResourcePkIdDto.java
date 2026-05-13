package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-10-23 23:28:27
 * @description TODO
 */
@Getter
@Setter
public class ResourcePkIdDto {

    /**
     * 系统编码,BYAI: 百应，HUIBI: 慧笔，BI:BI 系统，WHAGE_AGENT: 智能体，UIAGENT: 界面智能体，BOT: 博特，AiCollect: 智采，MemoBit:
     * 慧记，OfficeOCR:OfficeOCR 办公，WorkBook: 在线填报，Aigc: 海报生成
     */
    private String systemCode;

    /**
     * 下架资源信息
     */
    private List<ResourcePkIdDetailDto> resourcePkIdDetails;

}
