package com.iwhalecloud.byai.state.domain.resource.service;

import com.alibaba.fastjson.JSONArray;
import com.iwhalecloud.byai.state.domain.resource.dto.ParsedViewField;
import com.iwhalecloud.byai.state.domain.resource.dto.ParsedViewFieldRef;
import com.iwhalecloud.byai.state.domain.resource.dto.ParsedViewOwl;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 视图 OWL 解析器。
 */
@Service
public class ViewOwlImportParser {

    private static final String RDF_TYPE = "type";
    private static final String RDF_RESOURCE = "resource";
    private static final String RDF_ABOUT = "about";
    private static final String SCENE_DEFINITION = "#SceneDefinition";
    private static final String SCENE_FIELD = "#SceneField";
    private static final Pattern ROOT_RDF_OPENING_TAG =
        Pattern.compile("<rdf:RDF\\b[^>]*>", Pattern.DOTALL);
    private static final Pattern XMLNS_ATTR_PATTERN =
        Pattern.compile("\\s+(xmlns(?::[A-Za-z0-9_.-]+)?)=\"([^\"]*)\"");

    public ParsedViewOwl parse(String owlContent) {
        try {
            String normalizedOwlContent = normalizeRootNamespaceDeclarations(owlContent);
            Document document = buildDocument(normalizedOwlContent);
            Element sceneDefinition = findSceneDefinition(document);
            if (sceneDefinition == null) {
                throw new IllegalArgumentException("未找到视图定义节点(SceneDefinition)");
            }

            ParsedViewOwl result = new ParsedViewOwl();
            result.setSourceContent(normalizedOwlContent);
            result.setResourceCode(getChildText(sceneDefinition, "view_code"));
            result.setResourceName(getChildText(sceneDefinition, "view_name"));
            result.setResourceDesc(getChildText(sceneDefinition, "description"));
            result.setResourceVersionId(getChildText(sceneDefinition, "version"));
            result.setResourceBizType("VIEW");
            result.setObjectCodes(parseObjectCodes(getChildText(sceneDefinition, "object_codes")));
            List<String> fieldRefs = extractFieldRefs(sceneDefinition);
            result.setFieldRefs(buildFieldRefs(fieldRefs));
            result.setFields(buildFields(fieldRefs, buildFieldNodeMap(document)));
            return result;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("视图OWL解析失败: " + e.getMessage());
        }
    }

    /**
     * 样例 OWL 的根节点里存在重复的 xmlns/xmlns:rdf/xmlns:rdfs 声明；
     * 这类重复属性会导致标准 XML 解析器直接失败，这里在进入 DOM 解析前做一次去重。
     */
    private String normalizeRootNamespaceDeclarations(String owlContent) {
        Matcher rootMatcher = ROOT_RDF_OPENING_TAG.matcher(owlContent);
        if (!rootMatcher.find()) {
            return owlContent;
        }
        String rootTag = rootMatcher.group();
        Matcher attrMatcher = XMLNS_ATTR_PATTERN.matcher(rootTag);
        StringBuilder normalizedRootTag = new StringBuilder("<rdf:RDF");
        int cursor = 0;
        Set<String> seenNamespaceKeys = new LinkedHashSet<>();
        while (attrMatcher.find()) {
            if (cursor == 0) {
                cursor = attrMatcher.end();
            }
            String attrName = attrMatcher.group(1);
            if (seenNamespaceKeys.add(attrName)) {
                normalizedRootTag.append(" ")
                    .append(attrName)
                    .append("=\"")
                    .append(attrMatcher.group(2))
                    .append("\"");
            }
            cursor = attrMatcher.end();
        }
        String tail = rootTag.substring(cursor > 0 ? cursor : "<rdf:RDF".length(), rootTag.length() - 1).trim();
        if (StringUtils.isNotBlank(tail)) {
            normalizedRootTag.append(" ").append(tail);
        }
        normalizedRootTag.append(">");
        return owlContent.substring(0, rootMatcher.start())
            + normalizedRootTag
            + owlContent.substring(rootMatcher.end());
    }

    private Document buildDocument(String owlContent) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setExpandEntityReferences(false);
        DocumentBuilder builder = factory.newDocumentBuilder();
        return builder.parse(new ByteArrayInputStream(owlContent.getBytes(StandardCharsets.UTF_8)));
    }

    private Element findSceneDefinition(Document document) {
        NodeList individuals = document.getElementsByTagNameNS("*", "NamedIndividual");
        for (int i = 0; i < individuals.getLength(); i++) {
            Element individual = (Element) individuals.item(i);
            if (hasRdfType(individual, SCENE_DEFINITION)) {
                return individual;
            }
        }
        return null;
    }

    private boolean hasRdfType(Element individual, String expectedResource) {
        NodeList children = individual.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node child = children.item(i);
            if (!(child instanceof Element element)) {
                continue;
            }
            if (!RDF_TYPE.equals(element.getLocalName()) && !RDF_TYPE.equals(element.getNodeName())) {
                continue;
            }
            String resource = getAttributeIgnoreNamespace(element, RDF_RESOURCE);
            if (expectedResource.equals(resource)) {
                return true;
            }
        }
        return false;
    }

    private Map<String, Element> buildFieldNodeMap(Document document) {
        Map<String, Element> fieldNodeMap = new LinkedHashMap<>();
        NodeList individuals = document.getElementsByTagNameNS("*", "NamedIndividual");
        for (int i = 0; i < individuals.getLength(); i++) {
            Element individual = (Element) individuals.item(i);
            if (!hasRdfType(individual, SCENE_FIELD)) {
                continue;
            }
            String about = getAttributeIgnoreNamespace(individual, RDF_ABOUT);
            if (StringUtils.isNotBlank(about)) {
                fieldNodeMap.put(about, individual);
            }
        }
        return fieldNodeMap;
    }

    private List<String> extractFieldRefs(Element sceneDefinition) {
        List<String> fieldRefs = new ArrayList<>();
        NodeList children = sceneDefinition.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node child = children.item(i);
            if (!(child instanceof Element element)) {
                continue;
            }
            if (!"field".equals(element.getLocalName()) && !"field".equals(element.getNodeName())) {
                continue;
            }
            String resource = getAttributeIgnoreNamespace(element, RDF_RESOURCE);
            if (StringUtils.isNotBlank(resource)) {
                fieldRefs.add(resource);
            }
        }
        return fieldRefs;
    }

    private List<ParsedViewFieldRef> buildFieldRefs(List<String> fieldRefs) {
        List<ParsedViewFieldRef> refs = new ArrayList<>();
        for (String fieldRef : fieldRefs) {
            ParsedViewFieldRef ref = new ParsedViewFieldRef();
            ref.setRef(fieldRef);
            refs.add(ref);
        }
        return refs;
    }

    private List<ParsedViewField> buildFields(List<String> fieldRefs, Map<String, Element> fieldNodeMap) {
        List<ParsedViewField> fields = new ArrayList<>();
        for (String fieldRef : fieldRefs) {
            Element fieldElement = fieldNodeMap.get(fieldRef);
            if (fieldElement == null) {
                continue;
            }
            ParsedViewField field = new ParsedViewField();
            field.setPropertyCode(getChildText(fieldElement, "property_code"));
            field.setPropertyName(getChildText(fieldElement, "property_name"));
            field.setSourceObjectCode(getChildText(fieldElement, "source_object_code"));
            field.setSourceObjectColumnCode(getChildText(fieldElement, "source_object_column_code"));
            fields.add(field);
        }
        return fields;
    }

    private List<String> parseObjectCodes(String objectCodesRaw) {
        if (StringUtils.isBlank(objectCodesRaw)) {
            return new ArrayList<>();
        }
        try {
            JSONArray array = JSONArray.parseArray(objectCodesRaw);
            if (array == null) {
                return new ArrayList<>();
            }
            Set<String> codes = new LinkedHashSet<>();
            for (Object item : array) {
                if (item == null) {
                    continue;
                }
                String code = StringUtils.trimToEmpty(String.valueOf(item));
                if (StringUtils.isNotBlank(code)) {
                    codes.add(code);
                }
            }
            return new ArrayList<>(codes);
        } catch (Exception e) {
            throw new IllegalArgumentException("object_codes节点内容格式错误，应为JSON数组格式");
        }
    }

    private String getChildText(Element parent, String localName) {
        NodeList children = parent.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node child = children.item(i);
            if (!(child instanceof Element element)) {
                continue;
            }
            String nodeLocalName = element.getLocalName();
            String nodeName = element.getNodeName();
            if (localName.equals(nodeLocalName) || localName.equals(nodeName)) {
                return StringUtils.trimToEmpty(element.getTextContent());
            }
        }
        return "";
    }

    private String getAttributeIgnoreNamespace(Element element, String localName) {
        if (element.hasAttributeNS("*", localName)) {
            return element.getAttributeNS(element.getNamespaceURI(), localName);
        }
        if (element.hasAttribute(localName)) {
            return element.getAttribute(localName);
        }
        if (element.hasAttribute("rdf:" + localName)) {
            return element.getAttribute("rdf:" + localName);
        }
        return "";
    }
}
