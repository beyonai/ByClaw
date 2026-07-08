import { Button, message, Tooltip } from 'antd';
import copy from 'copy-to-clipboard';
// tslint:disable:ordered-imports
import React, { useCallback, useState } from 'react';
import { useIntl } from '@umijs/max';

import { debounce } from 'lodash';

import AntdIcon from '@/components/AntdIcon';
import btnStyles from '@/components/MessageList/index.module.less';
import useQryResourceList from '@/components/QueryInput/components/ResourceQuestion/useQryResourceList';

function Copy({ text, richText, showText = false }: { text?: string; richText?: string; showText?: boolean }) {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const qryResourceList = useQryResourceList();

  const showToast = useCallback(() => {
    message.destroy();
    message.success(intl.formatMessage({ id: 'common.copySuccess' }));
  }, [intl]);

  const handleCopy = useCallback(
    debounce(() => {
      if (!text) return;
      if (richText && /\{\{.+\}\}/g.test(richText)) {
        setLoading(true);
        qryResourceList(richText, true)
          .then((resourceList) => {
            if (!resourceList || !resourceList.length) {
              copy(text);
              showToast();
              return;
            }
            copy(text, {
              onCopy: (clipboardData) => {
                const clipboard = clipboardData as DataTransfer;
                // clipboard.setData('application/x-slate-fragment', window.btoa(encodeURIComponent(JSON.stringify(slateValue))));
                clipboard.setData(
                  'application/x-byai-slate',
                  window.btoa(
                    encodeURIComponent(
                      JSON.stringify({
                        text: richText,
                        resourceList,
                      })
                    )
                  )
                );
                clipboard.setData('text/plain', text);
                showToast();
              },
            });
          })
          .finally(() => {
            setLoading(false);
          });
      } else {
        copy(text);
        showToast();
      }
    }, 300),
    [intl, text, richText]
  );

  if (!text && !richText) return null;

  const title = intl.formatMessage({ id: 'messageList.copyMessage' });

  return (
    <Tooltip title={title}>
      <Button
        type="text"
        size="small"
        loading={loading}
        icon={<AntdIcon type="icon-a-Copyfuzhi" className={btnStyles.copyIcon} />}
        onClick={handleCopy}
      >
        {showText ? (
          <span className={btnStyles.actionsBarText}>{intl.formatMessage({ id: 'common.copy' })}</span>
        ) : null}
      </Button>
    </Tooltip>
  );
}

export default Copy;
