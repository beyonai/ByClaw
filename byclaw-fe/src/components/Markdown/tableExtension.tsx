import styles from './index.module.less';

export default function createTableExtension() {
  return {
    type: 'html',
    filter(html: string) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      const tableElements = tempDiv.querySelectorAll('table');

      tableElements.forEach((table) => {
        const { parentElement } = table;

        const tableWrapper = document.createElement('div');
        tableWrapper.className = styles.tableWrapper;

        const fullScreenButton = document.createElement('div');
        fullScreenButton.className = styles.markdownIconFullScreen;
        fullScreenButton.innerHTML = '<i class="iconfont icon-a-Full-screen-onequanjufangda1"></i>';

        const myTable = document.createElement('div');
        myTable.className = styles.myTable;
        myTable.appendChild(table.cloneNode(true));

        tableWrapper.appendChild(fullScreenButton);
        tableWrapper.appendChild(myTable);

        parentElement?.replaceChild(tableWrapper, table);
      });

      return tempDiv.innerHTML;
    },
  };
}
