import React, { Suspense } from 'react';
import { act, render } from '@testing-library/react';
import { createEditor, Transforms } from 'slate';
import { Editable, ReactEditor, Slate, withReact } from 'slate-react';
import EditableRootWithAria from '../EditableRoot';

describe('RichInput editable lifecycle', () => {
  afterEach(() => jest.useRealTimers());

  it('handles focus moving to a preview while suspended and resumes editing the same draft', async () => {
    jest.useFakeTimers();
    const editor = withReact(createEditor());
    const pending = new Promise<void>(() => {});
    const Preview = ({ loading }: { loading: boolean }) => {
      if (loading) throw pending;
      return null;
    };
    const App = ({ loading }: { loading: boolean }) => (
      <>
        <button>Preview controls</button>
        <Suspense fallback={<div>Loading preview</div>}>
          <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: 'Draft' }] }]}>
            <Editable as={EditableRootWithAria} />
          </Slate>
          <Preview loading={loading} />
        </Suspense>
      </>
    );
    const view = render(<App loading={false} />);
    const editable = view.getByRole('textbox');
    const previewControls = view.getByRole('button');
    // JSDOM does not implement the browser's contenteditable focus detection.
    Object.defineProperty(editable, 'isContentEditable', { value: true, configurable: true });
    const selection = { anchor: { path: [0, 0], offset: 3 }, focus: { path: [0, 0], offset: 3 } };
    await act(async () => {
      Transforms.select(editor, selection);
      editable.focus();
    });
    expect(ReactEditor.isFocused(editor)).toBe(true);
    await act(async () => jest.runOnlyPendingTimers());

    view.rerender(<App loading={true} />);
    expect(view.getByText('Loading preview')).toBeVisible();
    // Suspense detaches the Slate ref while retaining the focused DOM element.
    expect(editable.isConnected).toBe(true);
    expect(document.activeElement).toBe(editable);

    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      act(() => previewControls.focus());
      expect(errors).toEqual([]);
      expect(ReactEditor.isFocused(editor)).toBe(false);
    } finally {
      window.removeEventListener('error', onError);
    }

    view.rerender(<App loading={false} />);
    expect(view.getByRole('textbox')).toBe(editable);
    expect(document.activeElement).toBe(previewControls);
    expect(ReactEditor.toDOMNode(editor, editor)).toBe(editable);
    expect(editor.selection).toEqual(selection);
    await act(async () => {
      ReactEditor.focus(editor);
      Transforms.select(editor, { path: [0, 0], offset: 5 });
      Transforms.insertText(editor, ' continued');
    });
    expect(editable).toHaveTextContent('Draft continued');
    expect(document.activeElement).toBe(editable);

    // Normal rerenders preserve focus; normal blur still reaches Slate.
    view.rerender(<App loading={false} />);
    expect(document.activeElement).toBe(editable);
    // Slate clears its temporary selection-sync flag on the next timer tick.
    await act(async () => jest.runOnlyPendingTimers());
    act(() => previewControls.focus());
    expect(ReactEditor.isFocused(editor)).toBe(false);
  });
});
