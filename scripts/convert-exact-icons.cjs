const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const webpPath = path.join(__dirname, '../public/lyricfy_logo_icon.webp');
  const webpB64 = fs.readFileSync(webpPath).toString('base64');

  // 1. Write 1:1 SVG of lyricfy_logo_icon.webp
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">
  <image width="1024" height="1024" href="data:image/webp;base64,${webpB64}" />
</svg>
`;
  fs.writeFileSync(path.join(__dirname, '../public/lyricfy_logo_icon.svg'), svgContent, 'utf8');

  // 2. Write temporary HTML that renders the full logo at 512x512 with overflow:hidden
  const htmlPath = path.join(__dirname, 'temp-render.html');
  fs.writeFileSync(
    htmlPath,
    `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;overflow:hidden;background:transparent;}html,body{width:512px;height:512px;overflow:hidden;background:transparent;}img{width:512px;height:512px;object-fit:contain;display:block;}</style></head><body><img src="data:image/webp;base64,${webpB64}" /></body></html>`,
    'utf8'
  );

  const win = new BrowserWindow({
    width: 512,
    height: 512,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    webPreferences: { offscreen: true },
  });

  await win.loadFile(htmlPath);
  await new Promise((r) => setTimeout(r, 400));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const png512 = image.resize({ width: 512, height: 512, quality: 'best' }).toPNG();
  fs.writeFileSync(path.join(__dirname, '../public/icon.png'), png512);

  const icoSizes = [256, 128, 64, 48, 32, 16];
  const buffers = icoSizes.map((s) => image.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const count = icoSizes.length;

  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  let offset = 6 + count * 16;
  for (let i = 0; i < count; i++) {
    const s = icoSizes[i];
    const buf = buffers[i];
    const entryOffset = 6 + i * 16;
    header.writeUInt8(s === 256 ? 0 : s, entryOffset + 0);
    header.writeUInt8(s === 256 ? 0 : s, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(buf.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += buf.length;
  }

  fs.writeFileSync(path.join(__dirname, '../public/icon.ico'), Buffer.concat([header, ...buffers]));
  try { fs.unlinkSync(htmlPath); } catch {}
  app.exit(0);
});
