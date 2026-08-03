# Auth Connector Metadata Filter Design

## Objective

Make `metadata.authConnectorList` represent connectors that the current user has successfully authorized, while preserving each authorized connector's enabled or disabled state.

## Behavior Contract

- Include a connector only when the user has an active authorization record in `byai_connector_auth` with `status_cd = '00A'`.
- Do not use `expire_time` when deciding whether to include a connector.
- Return `true` when `enable_flag = 'Y'`; return `false` for any other enable value.
- Use `byai_connector_info.skill_code` as the metadata key, falling back to `connector_code` when `skill_code` is blank.
- Exclude connectors that have never been authorized by the user.

Example for an authorized but disabled Lark connector:

```json
{
  "authConnectorList": {
    "dws": true,
    "fws": false,
    "wecomcli": true
  }
}
```

If Lark has never been authorized, `fws` is omitted.

## Implementation

Change `ConnectorAuthMapper.selectConnectorEnableStates` so the connector catalog is joined only to the current user's active authorization records. An inner join expresses the inclusion rule directly and avoids returning unauthorized catalog entries for Java-side filtering.

`ConnectorAuthService.findConnectorEnableStates` continues to build an ordered map and resolve the Skill key. `ScriptService.getMetadataByassistantChatDto` continues to attach that map without changing the surrounding metadata structure.

## Error and Compatibility Considerations

- An invalid user ID continues to produce an empty map.
- Existing authorized connectors remain present even when disabled.
- Credential expiry remains irrelevant to this metadata contract.
- The Gateway field name and value type do not change, so consumers only observe that unauthorized keys are absent.

## Testing

- Update the service test to model mapper output containing only authorized connectors, including a disabled authorized connector.
- Add a mapper contract assertion that the query uses an inner join and does not filter by `expire_time`.
- Run the focused connector and chat metadata tests, followed by backend verification in proportion to the change.
