package com.iwhalecloud.byai.manager.application.service.connector;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorListDto;
import com.iwhalecloud.byai.manager.qo.connector.ConnectorQo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 连接器应用服务。
 *
 * @author he.duming
 * @date 2026-07-30 00:24:22
 */
@Service
public class ConnectorApplicationService {

    @Autowired
    private ConnectorInfoService connectorInfoService;

    /**
     * 分页查询连接器列表。
     *
     * @param qo 分页查询条件（keyword 按连接器名称模糊匹配）
     * @return 分页结果
     */
    public PageInfo<ConnectorListDto> listAll(ConnectorQo qo) {
        qo.setUserId(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        return connectorInfoService.listAll(qo);
    }
}
