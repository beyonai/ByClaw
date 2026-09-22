# Group chat member avatars

The `members` in `GET /group-chats` use `ss_resource.avatar` for `AGENT` members and `po_users.thumbnail_uri` for `USER` members. The corresponding Java field is `Users.avatar`.

Group detail, group creation, member invitation, invitation joining, nickname updates, and invitation preview return the current avatar for `USER` members. Group nicknames remain independent of the user's account name. A missing user record or avatar leaves the response avatar empty.
