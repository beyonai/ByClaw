package com.iwhalecloud.byai.manager.domain.mail;

import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

/** Transactional lookup boundary used by credential resolution. */
public interface MailConnectorLookup {
    ConnectorInfo findActiveConnector(String connectorCode);
}
