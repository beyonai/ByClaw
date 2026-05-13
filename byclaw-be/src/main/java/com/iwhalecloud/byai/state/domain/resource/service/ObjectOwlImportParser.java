package com.iwhalecloud.byai.state.domain.resource.service;

import com.iwhalecloud.byai.state.domain.resource.dto.ParsedObjectField;
import com.iwhalecloud.byai.state.domain.resource.dto.ParsedObjectOwl;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 对象 OWL 解析器。
 * 当前用于对象 zip 导入，后续可复用于视图等类似结构的 OWL 解析。
 */
@Service
public class ObjectOwlImportParser {

    private static final String RDF_TYPE = "type";
    private static final String RDF_RESOURCE = "resource";
    private static final String RDF_ABOUT = "about";
    private static final String ENTITY_DEFINITION = "#EntityDefinition";
    private static final String ENTITY_FIELD = "#EntityField";
    private static final Pattern ROOT_RDF_OPENING_TAG =
        Pattern.compile("<(?:rdf:)?RDF\\b[^>]*>", Pattern.DOTALL);
    private static final Pattern XMLNS_ATTR_PATTERN =
        Pattern.compile("\\s+(xmlns(?::[A-Za-z0-9_.-]+)?)=\"([^\"]*)\"");

    public ParsedObjectOwl parse(String owlContent) {
        try {
            String normalizedOwlContent = normalizeRootNamespaceDeclarations(owlContent);
            Document document = buildDocument(normalizedOwlContent);
            Element entityDefinition = findEntityDefinition(document);
            if (entityDefinition == null) {
                throw new IllegalArgumentException("未找到对象定义节点(EntityDefinition)");
            }

            ParsedObjectOwl result = new ParsedObjectOwl();
            result.setSourceContent(normalizedOwlContent);
            result.setResourceCode(getChildText(entityDefinition, "entity_code"));
            result.setResourceName(getChildText(entityDefinition, "entity_name"));
            result.setResourceDesc(getChildText(entityDefinition, "entity_desc"));
            result.setResourceVersionId(getChildText(entityDefinition, "version"));
            result.setResourceBizType("OBJECT");
            result.setEntitySource(getChildText(entityDefinition, "entity_source"));

            List<String> fieldRefs = extractFieldRefs(entityDefinition);
            Map<String, Element> fieldNodeMap = buildFieldNodeMap(document);
            result.setFields(buildFields(fieldRefs, fieldNodeMap));
            return result;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("对象OWL解析失败: " + e.getMessage());
        }
    }

    /**
     * 对重复 xmlns 声明做兜底去重，避免第三方导出的 OWL 因根节点属性重复而无法进入 DOM 解析。
     */
    private String normalizeRootNamespaceDeclarations(String owlContent) {
        Matcher rootMatcher = ROOT_RDF_OPENING_TAG.matcher(owlContent);
        if (!rootMatcher.find()) {
            return owlContent;
        }
        String rootTag = rootMatcher.group();
        Matcher attrMatcher = XMLNS_ATTR_PATTERN.matcher(rootTag);
        String rootPrefix = rootTag.startsWith("<rdf:RDF") ? "<rdf:RDF" : "<RDF";
        StringBuilder normalizedRootTag = new StringBuilder(rootPrefix);
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
        String tail = rootTag.substring(cursor > 0 ? cursor : rootPrefix.length(), rootTag.length() - 1).trim();
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

    private Element findEntityDefinition(Document document) {
        NodeList individuals = document.getElementsByTagNameNS("*", "NamedIndividual");
        for (int i = 0; i < individuals.getLength(); i++) {
            Element individual = (Element) individuals.item(i);
            if (hasRdfType(individual, ENTITY_DEFINITION)) {
                return individual;
            }
        }
        return null;
    }

    private Map<String, Element> buildFieldNodeMap(Document document) {
        Map<String, Element> fieldNodeMap = new LinkedHashMap<>();
        NodeList individuals = document.getElementsByTagNameNS("*", "NamedIndividual");
        for (int i = 0; i < individuals.getLength(); i++) {
            Element individual = (Element) individuals.item(i);
            if (!hasRdfType(individual, ENTITY_FIELD)) {
                continue;
            }
            String about = getAttributeIgnoreNamespace(individual, RDF_ABOUT);
            if (StringUtils.isNotBlank(about)) {
                fieldNodeMap.put(about, individual);
            }
        }
        return fieldNodeMap;
    }

    private List<String> extractFieldRefs(Element entityDefinition) {
        List<String> fieldRefs = new ArrayList<>();
        NodeList children = entityDefinition.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node child = children.item(i);
            if (!(child instanceof Element element)) {
                continue;
            }
            if (!"fields".equals(element.getLocalName()) && !"fields".equals(element.getNodeName())) {
                continue;
            }
            String resource = getAttributeIgnoreNamespace(element, RDF_RESOURCE);
            if (StringUtils.isNotBlank(resource)) {
                fieldRefs.add(resource);
            }
        }
        return fieldRefs;
    }

    private List<ParsedObjectField> buildFields(List<String> fieldRefs, Map<String, Element> fieldNodeMap) {
        List<ParsedObjectField> fields = new ArrayList<>();
        for (String fieldRef : fieldRefs) {
            Element fieldElement = fieldNodeMap.get(fieldRef);
            if (fieldElement == null) {
                continue;
            }
            ParsedObjectField field = new ParsedObjectField();
            field.setPropertyCode(getChildText(fieldElement, "property_code"));
            field.setPropertyName(getChildText(fieldElement, "property_name"));
            field.setDataType(getChildText(fieldElement, "data_type"));
            field.setIsRequired(getChildText(fieldElement, "is_required"));
            field.setDefaultValue(getChildText(fieldElement, "default_value"));
            field.setSourceColumn(getChildText(fieldElement, "source_column"));
            field.setSynonyms(getChildText(fieldElement, "synonyms"));
            field.setDataFormat(getChildText(fieldElement, "data_format"));
            field.setMeasurementUnit(getChildText(fieldElement, "measurement_unit"));
            field.setPropertyCategory(getChildText(fieldElement, "property_category"));
            field.setPropertyGroup(getChildText(fieldElement, "property_group"));
            field.setExtProperty(getChildText(fieldElement, "ext_property"));
            field.setTermTypeCodePath(getChildText(fieldElement, "term_type_code_path"));
            field.setLibraryCode(getChildText(fieldElement, "library_code"));
            field.setRelAction(getChildText(fieldElement, "rel_action"));
            field.setRelTermCodeOrName(getChildText(fieldElement, "rel_term_codeorname"));
            field.setTermDataType(getChildText(fieldElement, "term_data_type"));
            field.setSourceTableCode(getChildText(fieldElement, "source_table_code"));
            field.setSourceColumnCode(getChildText(fieldElement, "source_column_code"));
            field.setSourceDatasourceCode(getChildText(fieldElement, "source_datasource_code"));
            if (StringUtils.isBlank(field.getSourceColumnCode())) {
                field.setSourceColumnCode(field.getSourceColumn());
            }
            fields.add(field);
        }
        return fields;
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
