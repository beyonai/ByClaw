package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/**
 * 运营账号保存参数。
 * accountCode 是平台侧账号标识，accountId 是本系统账号主键，二者不可混用。
 */
@Data
public class OperationAccountDTO {

    /** 编辑时必填的系统账号主键。 */
    private Long accountId;

    /** 所属运营项目。 */
    private Long projectId;

    /** 平台编码，例如 WeChatAccount、Xiaohongshu、WeChatChannels。 */
    private String platformCode;

    /** 平台账号唯一标识。 */
    private String accountCode;

    /** 账号展示名称。 */
    private String accountName;

    /** 自定义链接平台的登录URL，仅当 platformCode = "CustomLink" 时使用。 */
    private String customUrl;

}
