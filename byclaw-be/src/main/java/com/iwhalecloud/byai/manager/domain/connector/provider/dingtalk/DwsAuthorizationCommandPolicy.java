package com.iwhalecloud.byai.manager.domain.connector.provider.dingtalk;

import java.util.List;

import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;

/** Shared allowlist for every production path that launches a DWS authorization command. */
public final class DwsAuthorizationCommandPolicy {

    private DwsAuthorizationCommandPolicy() {
    }

    public static List<String> command(
            ManifestCommandCatalog catalog,
            String action,
            int index,
            String expectedSubcommand) {
        if (catalog == null) {
            throw new IllegalArgumentException("DWS manifest commands are unavailable");
        }
        List<String> command = catalog.command(action, index);
        if (command.size() < 3
                || !"dws".equals(command.get(0))
                || !"auth".equals(command.get(1))
                || !expectedSubcommand.equals(command.get(2))) {
            throw new IllegalArgumentException("DWS manifest command is not allowed");
        }
        return command;
    }
}
