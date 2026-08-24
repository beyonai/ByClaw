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

/**
 * 连接器基础元信息领域服务。
 */
@Service
public class ConnectorInfoService {

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
            ConnectorCredentialFormDto sanitized = sanitizeImaCredentialForm(form);
            connector.setCredentialForm(sanitized);
        } catch (RuntimeException ignored) {
            connector.setCredentialForm(null);
        } finally {
            connector.setAuthConfig(null);
        }
    }

    private static ConnectorCredentialFormDto sanitizeImaCredentialForm(JSONObject form) {
        if (form == null || !isSafeHelpUrl(form.getString("helpUrl"))) {
            return null;
        }
        JSONArray fields = form.getJSONArray("fields");
        if (fields == null || fields.size() != 2) {
            return null;
        }
        List<ConnectorCredentialFieldDto> sanitizedFields = new ArrayList<>();
        Set<String> keys = new HashSet<>();
        for (Object value : fields) {
            if (!(value instanceof JSONObject field)) {
                return null;
            }
            ConnectorCredentialFieldDto sanitized = sanitizeImaCredentialField(field);
            if (sanitized == null || !keys.add(sanitized.getKey())) {
                return null;
            }
            sanitizedFields.add(sanitized);
        }
        if (!keys.equals(Set.of("clientId", "apiKey"))) {
            return null;
        }
        ConnectorCredentialFormDto result = new ConnectorCredentialFormDto();
        result.setHelpUrl(form.getString("helpUrl"));
        result.setFields(sanitizedFields);
        return result;
    }

    private static ConnectorCredentialFieldDto sanitizeImaCredentialField(JSONObject field) {
        String key = field.getString("key");
        String label = field.getString("label");
        String inputType = field.getString("inputType");
        Integer maxLength = field.getInteger("maxLength");
        boolean clientId = "clientId".equals(key) && "text".equals(inputType) && maxLength != null
            && maxLength > 0 && maxLength <= 256;
        boolean apiKey = "apiKey".equals(key) && "password".equals(inputType) && maxLength != null
            && maxLength > 0 && maxLength <= 2048;
        if ((!clientId && !apiKey) || label == null || label.trim().isEmpty() || label.length() > 100) {
            return null;
        }
        ConnectorCredentialFieldDto result = new ConnectorCredentialFieldDto();
        result.setKey(key);
        result.setLabel(label.trim());
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
