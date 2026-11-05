const { version } = require('pptx-preview/package.json');

const mediaFilter = 'return t.startsWith("ppt/media/image")';
const mediaMimeSwitch =
  'switch(t){case"jpg":case"jpeg":e="image/jpeg";break;case"png":e="image/png";break;case"gif":e="image/gif";break;case"emf":e="image/x-emf";break;case"wmf":e="image/x-wmf";break;default:e="image/*"}';

// Keep the pinned library's parsing/rendering lifecycle; only repair its image discovery and MIME handling.
module.exports = function pptxPreviewMedia(source) {
  this?.cacheable?.();
  if (version !== '1.0.7') {
    throw new Error(`pptx-preview 1.0.7 media compatibility requires review for version ${version}`);
  }
  const patches = [
    [
      mediaFilter,
      'return t.startsWith("ppt/media/image")||t.startsWith("ppt/media/")&&/\\.(?:jpe?g|png|gif|emf|wmf|svg)$/i.test(t)',
    ],
    [
      mediaMimeSwitch,
      mediaMimeSwitch.replace('switch(t){', 'switch(t.toLowerCase()){case"svg":e="image/svg+xml";break;'),
    ],
  ];
  let output = source;
  for (const [original, replacement] of patches) {
    const matches = output.split(original).length - 1;
    if (matches !== 1) {
      throw new Error(`pptx-preview 1.0.7 media compatibility expected one source match, found ${matches}`);
    }
    output = output.replace(original, replacement);
  }
  return output;
};
