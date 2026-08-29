package com.iwhalecloud.byai.manager.domain.connector.service;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorConnectionDto;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorCredentialFieldDto;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorCredentialFormDto;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorListDto;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import com.iwhalecloud.byai.manager.qo.connector.ConnectorQo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 连接器基础元信息领域服务。
 */
@Service
public class ConnectorInfoService {

    private static final int MAX_CREDENTIAL_FIELDS = 8;

    private static final int MAX_HELP_TEXT_LENGTH = 500;

    private static final Pattern CREDENTIAL_FIELD_KEY = Pattern.compile("[A-Za-z][A-Za-z0-9_]{0,63}");

    @Autowired
    private ConnectorInfoMapper connectorInfoMapper;

    /**
     * 分页查询连接器列表（含当前用户启用状态）。
     *
     * @param qo 查询条件
     * @return 分页结果
     */
    public PageInfo<ConnectorListDto> listAll(ConnectorQo qo, String userId) {
        if (qo == null) {
            qo = new ConnectorQo();
        }
        Page<ConnectorListDto> page = PageHelper.startPage(qo.getPageNum(), qo.getPageSize());
        List<ConnectorListDto> connectors = connectorInfoMapper.selectConnectorListByQo(qo, userId);
        if (connectors != null) {
            connectors.forEach(ConnectorInfoService::sanitizeCredentialForm);
        }
        return PageHelperUtil.toPageInfo(page);
    }

    public ConnectorInfo findByCode(String connectorCode) {
        return connectorInfoMapper.selectByConnectorCode(connectorCode);
    }

    public java.util.List<ConnectorConnectionDto> listConnections(String userId) {
        return connectorInfoMapper.selectConnectionsByUserId(userId);
    }

    /**
     * 新增连接器元信息。
     *
     * @param connectorInfo 连接器实体
     */
    public void save(ConnectorInfo connectorInfo) {
        connectorInfoMapper.insert(connectorInfo);
    }

    /**
     * 按主键更新连接器元信息。
     *
     * @param connectorInfo 连接器实体
     */
    public void update(ConnectorInfo connectorInfo) {
        connectorInfoMapper.updateById(connectorInfo);
    }

    /**
     * 按主键查询连接器元信息。
     *
     * @param connectorId 连接器ID
     * @return 连接器实体，不存在时返回 null
     */
    public ConnectorInfo findById(Long connectorId) {
        return connectorInfoMapper.selectById(connectorId);
    }

    static void sanitizeCredentialForm(ConnectorListDto connector) {
        if (connector == null) {
            return;
        }
        try {
            if (!"AK_SK".equals(connector.getAuthMode())) {
                return;
            }
            JSONObject root = JSON.parseObject(connector.getAuthConfig());
            JSONObject form = root == null ? null : root.getJSONObject("credentialForm");
            ConnectorCredentialFormDto sanitized = sanitizeCredentialForm(form);
            connector.setCredentialForm(sanitized);
        } catch (RuntimeException ignored) {
            connector.setCredentialForm(null);
        } finally {
            connector.setAuthConfig(null);
        }
    }

    private static ConnectorCredentialFormDto sanitizeCredentialForm(JSONObject form) {
        if (form == null || !isSafeHelpUrl(form.getString("helpUrl"))) {
            return null;
        }
        String helpText = sanitizeHelpText(form);
        if (form.containsKey("helpText") && helpText == null) {
            return null;
        }
        JSONArray fields = form.getJSONArray("fields");
        if (fields == null || fields.isEmpty() || fields.size() > MAX_CREDENTIAL_FIELDS) {
            return null;
        }
        List<ConnectorCredentialFieldDto> sanitizedFields = new ArrayList<>();
        Set<String> keys = new HashSet<>();
        for (Object value : fields) {
            if (!(value instanceof JSONObject field)) {
                return null;
            }
            ConnectorCredentialFieldDto sanitized = sanitizeCredentialField(field);
            if (sanitized == null || !keys.add(sanitized.getKey())) {
                return null;
            }
            sanitizedFields.add(sanitized);
        }
        ConnectorCredentialFormDto result = new ConnectorCredentialFormDto();
        result.setHelpUrl(form.getString("helpUrl"));
        result.setHelpText(helpText);
        result.setFields(sanitizedFields);
        return result;
    }

    private static String sanitizeHelpText(JSONObject form) {
        String helpText = form.getString("helpText");
        if (helpText == null) {
            return null;
        }
        String sanitized = helpText.trim();
        return sanitized.isEmpty() || sanitized.length() > MAX_HELP_TEXT_LENGTH ? null : sanitized;
    }

    private static ConnectorCredentialFieldDto sanitizeCredentialField(JSONObject field) {
        String key = field.getString("key");
        String label = field.getString("label");
        String inputType = field.getString("inputType");
        Integer maxLength = field.getInteger("maxLength");
        boolean validKey = key != null && CREDENTIAL_FIELD_KEY.matcher(key).matches();
        boolean validType = "text".equals(inputType) || "password".equals(inputType);
        String sanitizedLabel = label == null ? null : label.trim();
        boolean validLabel = sanitizedLabel != null && !sanitizedLabel.isEmpty() && sanitizedLabel.length() <= 100;
        boolean validMaxLength = maxLength != null && maxLength > 0 && maxLength <= 2048;
        if (!validKey || !validType || !validLabel || !validMaxLength) {
            return null;
        }
        ConnectorCredentialFieldDto result = new ConnectorCredentialFieldDto();
        result.setKey(key);
        result.setLabel(sanitizedLabel);
        result.setInputType(inputType);
        result.setMaxLength(maxLength);
        return result;
    }

    private static boolean isSafeHelpUrl(String value) {
        try {
            URI uri = URI.create(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
