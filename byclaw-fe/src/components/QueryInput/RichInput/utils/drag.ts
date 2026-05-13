export function setDragData(event: React.DragEvent, data: any) {
  if (navigator.userAgent.indexOf('Trident') > -1 && navigator.userAgent.indexOf('rv:11.0') > -1) {
    event.dataTransfer?.setData('text', JSON.stringify(data));
  } else {
    event.dataTransfer?.setData('data', JSON.stringify(data));
  }
}

export function getDropData(event: React.DragEvent) {
  if (!event.dataTransfer || !event.dataTransfer.getData('data')) return null;
  let data;
  try {
    if (navigator.userAgent.indexOf('Trident') > -1 && navigator.userAgent.indexOf('rv:11.0') > -1) {
      data = JSON.parse(event.dataTransfer.getData('text'));
    } else {
      data = JSON.parse(event.dataTransfer.getData('data'));
    }
  } catch (e) {
    return null;
  }
  if (!data) return null;
  return data;
}
