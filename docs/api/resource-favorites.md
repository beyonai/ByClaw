# Resource favorites

Resource favorites are enabled only when `BYAI_BRAND_VERSION` is `commercial`.
The open-source edition continues to hide the favorite controls and reject favorite mutations.

## Legacy resource compatibility

An enterprise resource with a null `com_acct_id` can appear in historical enterprise
recommendations. It can also be favorited when neither `view_auth_controlled` nor
`use_auth_controlled` is enabled. Null control flags are treated as disabled, matching
the existing recommendation queries. The resource must still have a supported type,
be on shelf, and pass the existing blacklist checks.

This compatibility rule does not admit resources assigned to another enterprise or
resources with a null enterprise ID and either permission control enabled. Existing
same-enterprise resource authorization remains unchanged. Favoriting does not grant
permission to use a resource.

Favorite relations and counts always belong to the enterprise in the authenticated
session. The same legacy resource can therefore have independent favorites and counts
in different enterprises. The favorites list applies the same legacy compatibility
rule to knowledge, skills, tools, and digital employees; each user sees only their own
favorites in the current enterprise.

No migration or update to resource ownership is required. The compatibility path
does not assign a null enterprise ID to whichever enterprise favorites it first.

## Error responses

`POST /byaiService/resource/favorite/set` retains its existing HTTP status and response
shape. Message keys such as `resource.favorite.unavailable` are translated using the
request locale. Unknown message keys and literal reasons retain their original text.

| Status | Meaning |
| --- | --- |
| 400 | Favorites are disabled for the configured edition. |
| 403 | The required authenticated enterprise or user context is missing. |
| 404 | The resource is missing, unsupported, or outside the eligible resource scope. |
| 409 | A new favorite fails availability or permission checks. |
| 503 | Favorite storage tables are not ready. |

Cancellation continues to work for eligible resources after they are taken off shelf
or access is revoked. It only changes the current user's relation in the current
enterprise.
