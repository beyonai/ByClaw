const pptxgen = require('pptxgenjs');
const path = require('path');

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';

const theme = {
  primary:   "000814",
  secondary: "001d3d",
  accent:    "003566",
  light:     "ffc300",
  bg:        "001d3d"
};

for (let i = 1; i <= 11; i++) {
  const num = String(i).padStart(2, '0');
  const mod = require(`./slide-${num}.js`);
  mod.createSlide(pres, theme);
}

const outPath = path.join(__dirname, 'output/lore_podcast.pptx');
pres.writeFile({ fileName: outPath }).then(() => {
  console.log('✅ PPTX written to', outPath);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
