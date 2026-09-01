package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import java.io.StringReader;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.xml.sax.InputSource;

@Component
public class WeixinOpenPlatformXml {
    private static final int MAX_XML_CHARS = 1024 * 1024;

    public String encrypted(String xml) {
        return required(parse(xml), "Encrypt");
    }

    public Event event(String xml) {
        Element root = parse(xml);
        String appid = required(root, "AppId");
        String infoType = required(root, "InfoType");
        long createTime;
        try {
            createTime = Long.parseLong(required(root, "CreateTime"));
        } catch (RuntimeException e) {
            throw invalid();
        }
        return new Event(
            appid,
            infoType,
            createTime,
            optional(root, "ComponentVerifyTicket"),
            optional(root, "AuthorizerAppid")
        );
    }

    private Element parse(String xml) {
        if (!StringUtils.hasText(xml) || xml.length() > MAX_XML_CHARS) {
            throw invalid();
        }
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            Document document = factory.newDocumentBuilder().parse(new InputSource(new StringReader(xml)));
            return document.getDocumentElement();
        } catch (Exception e) {
            throw invalid();
        }
    }

    private String required(Element root, String name) {
        String value = optional(root, name);
        if (!StringUtils.hasText(value)) {
            throw invalid();
        }
        return value;
    }

    private String optional(Element root, String name) {
        var nodes = root.getElementsByTagName(name);
        return nodes.getLength() == 1 ? nodes.item(0).getTextContent().trim() : null;
    }

    private IllegalArgumentException invalid() {
        return new IllegalArgumentException("Weixin Open Platform XML is invalid");
    }

    public record Event(
        String componentAppid,
        String infoType,
        long createTime,
        String componentVerifyTicket,
        String authorizerAppid
    ) {
    }
}
