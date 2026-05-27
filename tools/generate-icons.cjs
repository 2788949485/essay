const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const sizes = [16, 24, 32, 48, 64, 128, 256];
const icoSizes = [16, 32, 48, 64, 128, 256];

function makeDibIconImage(rawRgba, size) {
  const headerSize = 40;
  const xorSize = size * size * 4;
  const maskStride = Math.ceil(size / 32) * 4;
  const maskSize = maskStride * size;
  const image = Buffer.alloc(headerSize + xorSize + maskSize);

  image.writeUInt32LE(headerSize, 0);
  image.writeInt32LE(size, 4);
  image.writeInt32LE(size * 2, 8);
  image.writeUInt16LE(1, 12);
  image.writeUInt16LE(32, 14);
  image.writeUInt32LE(0, 16);
  image.writeUInt32LE(xorSize + maskSize, 20);
  image.writeInt32LE(0, 24);
  image.writeInt32LE(0, 28);
  image.writeUInt32LE(0, 32);
  image.writeUInt32LE(0, 36);

  let target = headerSize;
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = 0; x < size; x += 1) {
      const source = (y * size + x) * 4;
      image[target++] = rawRgba[source + 2];
      image[target++] = rawRgba[source + 1];
      image[target++] = rawRgba[source];
      image[target++] = rawRgba[source + 3];
    }
  }

  return image;
}

function makeIco(images) {
  const headerSize = 6;
  const entrySize = 16;
  const imageOffset = headerSize + entrySize * images.length;
  const totalSize = imageOffset + images.reduce((sum, item) => sum + item.buffer.length, 0);
  const ico = Buffer.alloc(totalSize);

  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(images.length, 4);

  let offset = imageOffset;
  images.forEach((item, index) => {
    const entryOffset = headerSize + entrySize * index;
    ico.writeUInt8(item.size >= 256 ? 0 : item.size, entryOffset);
    ico.writeUInt8(item.size >= 256 ? 0 : item.size, entryOffset + 1);
    ico.writeUInt8(0, entryOffset + 2);
    ico.writeUInt8(0, entryOffset + 3);
    ico.writeUInt16LE(1, entryOffset + 4);
    ico.writeUInt16LE(32, entryOffset + 6);
    ico.writeUInt32LE(item.buffer.length, entryOffset + 8);
    ico.writeUInt32LE(offset, entryOffset + 12);
    item.buffer.copy(ico, offset);
    offset += item.buffer.length;
  });

  return ico;
}

async function renderPng(svgBuffer, size) {
  return sharp(svgBuffer, { density: 384 })
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}

async function renderRaw(svgBuffer, size) {
  return sharp(svgBuffer, { density: 384 })
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

async function main() {
  const input = process.argv[2] || path.join(process.cwd(), "精灵日报.svg");
  const outputDir = path.join(process.cwd(), "build");
  const svgBuffer = await fs.readFile(input);

  await fs.mkdir(outputDir, { recursive: true });

  const pngs = [];
  const icoImages = [];
  for (const size of sizes) {
    const buffer = await renderPng(svgBuffer, size);
    pngs.push({ size, buffer });
    await fs.writeFile(path.join(outputDir, `icon-${size}.png`), buffer);

    if (icoSizes.includes(size)) {
      const raw = await renderRaw(svgBuffer, size);
      icoImages.push({ size, buffer: makeDibIconImage(raw, size) });
    }
  }

  await fs.writeFile(path.join(outputDir, "tray.png"), pngs.find((item) => item.size === 32).buffer);
  await fs.writeFile(path.join(outputDir, "icon.png"), pngs.find((item) => item.size === 256).buffer);
  await fs.writeFile(path.join(outputDir, "icon.ico"), makeIco(icoImages));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
