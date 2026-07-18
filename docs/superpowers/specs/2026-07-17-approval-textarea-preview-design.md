# Approval Textarea Preview Design

## Goal

Add a “view more” entry to `FormItemsRender` textarea fields so users can inspect the current textarea content in the existing main-drawer Markdown preview.

## UI

- Only fields with `formType === 'textarea'` show the entry.
- Wrap the existing Ant Design `TextArea` in a relatively positioned container.
- Place Ant Design's `FullscreenOutlined` in the container's upper-right corner without changing the field's current disabled or form-binding behavior.
- Give the clickable icon a tooltip and accessible label describing the “view more” action.

## Interaction and Data Flow

When the icon is clicked:

1. Read the latest bound value from the current Ant Design form field, rather than using the initial `fieldValue` or `defaultValue`.
2. Emit `beyond-main-driver-open-type` with:
   - `width: '50vw'`
   - `minWidth: '360px'`
   - `maxWidth: '50vw'`
   - `drawerType: 'preview'`
   - `canClose: true`
   - `canFullScreen: true`
3. Emit `beyond-main-driver-message` with:
   - `data`: the latest textarea value
   - `type: 'md'`

The existing `MainDrawer` maps the `preview` drawer type to `Twins.PreViewFile` and spreads the message payload into that component, so no direct preview component import is required.

## Scope

- Modify the textarea rendering and its local styling only.
- Reuse the existing `useGlobal().EventEmitter` integration already started in the target file.
- Do not change other form types, main-drawer behavior, or `Twins.PreViewFile`.

## Verification

Add a focused ApprovalForm component test that verifies:

- the view-more control appears for a textarea;
- clicking it after editing the textarea emits the drawer configuration above;
- the preview message contains the latest textarea value and `type: 'md'`.

Run the focused test, then the non-mutating frontend lint checks for the changed files/module.
