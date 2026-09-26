import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";

const imagePath = fileURLToPath(new URL("../assets/portrait.jpg", import.meta.url));

let source;

function pixels() {
  if (source) return source;
  const decoded = jpeg.decode(readFileSync(imagePath), {
    useTArray: true,
    formatAsRGBA: true,
    maxMemoryUsageInMB: 64,
  });
  source = { width: decoded.width, height: decoded.height, rgba: decoded.data };
  return source;
}

function resize(rgba, sw, sh, dw, dh) {
  const dst = new Uint8Array(dw * dh * 3);
  for (let y = 0; y < dh; y += 1) {
    const sy = ((y + 0.5) * sh) / dh - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < dw; x += 1) {
      const sx = ((x + 0.5) * sw) / dw - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = sx - x0;
      for (let channel = 0; channel < 3; channel += 1) {
        const p00 = rgba[(y0 * sw + x0) * 4 + channel];
        const p10 = rgba[(y0 * sw + x1) * 4 + channel];
        const p01 = rgba[(y1 * sw + x0) * 4 + channel];
        const p11 = rgba[(y1 * sw + x1) * 4 + channel];
        const value = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
        dst[(y * dw + x) * 3 + channel] = Math.round(value);
      }
    }
  }
  return dst;
}

function quantize(rgb, limit, mask) {
  const count = rgb.length / 3;
  const hist = new Map();
  for (let i = 0; i < count; i += 1) {
    if (mask && !mask[i]) continue;
    const key = ((rgb[i * 3] >> 3) << 10) | ((rgb[i * 3 + 1] >> 3) << 5) | (rgb[i * 3 + 2] >> 3);
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const ranked = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const palette = ranked.map(([key]) => [
    Math.round((((key >> 10) & 31) * 255) / 31),
    Math.round((((key >> 5) & 31) * 255) / 31),
    Math.round(((key & 31) * 255) / 31),
  ]);
  const nearest = new Map();
  for (const key of hist.keys()) {
    const r = (((key >> 10) & 31) * 255) / 31;
    const g = (((key >> 5) & 31) * 255) / 31;
    const b = ((key & 31) * 255) / 31;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < palette.length; i += 1) {
      const distance = (palette[i][0] - r) ** 2 + (palette[i][1] - g) ** 2 + (palette[i][2] - b) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    nearest.set(key, best);
  }
  const indexed = new Uint16Array(count);
  indexed.fill(65535);
  for (let i = 0; i < count; i += 1) {
    if (mask && !mask[i]) continue;
    const key = ((rgb[i * 3] >> 3) << 10) | ((rgb[i * 3 + 1] >> 3) << 5) | (rgb[i * 3 + 2] >> 3);
    indexed[i] = nearest.get(key);
  }
  return { palette, indexed };
}

function repeat(char, count) {
  if (count > 3) return `!${count}${char}`;
  return char.repeat(count);
}

export function toSixel(width, height, rgb, mask) {
  const { palette, indexed } = quantize(rgb, 256, mask);
  let body = `\x1bPq"1;1;${width};${height}`;
  palette.forEach((color, index) => {
    const r = Math.round((color[0] * 100) / 255);
    const g = Math.round((color[1] * 100) / 255);
    const b = Math.round((color[2] * 100) / 255);
    body += `#${index};2;${r};${g};${b}`;
  });
  for (let y = 0; y < height; y += 6) {
    let first = true;
    for (let color = 0; color < palette.length; color += 1) {
      let used = false;
      let row = "";
      let runChar = "";
      let run = 0;
      const flush = () => {
        if (!run) return;
        row += repeat(runChar, run);
        run = 0;
      };
      for (let x = 0; x < width; x += 1) {
        let bits = 0;
        for (let bit = 0; bit < 6; bit += 1) {
          const yy = y + bit;
          if (yy < height && indexed[yy * width + x] === color && indexed[yy * width + x] !== 65535) {
            bits |= 1 << bit;
            used = true;
          }
        }
        const char = String.fromCharCode(63 + bits);
        if (char === runChar) run += 1;
        else {
          flush();
          runChar = char;
          run = 1;
        }
      }
      flush();
      if (!used) continue;
      if (!first) body += "$";
      first = false;
      body += `#${color}${row}`;
    }
    body += "-";
  }
  return `${body}\x1b\\`;
}

export function portraitImage(pixelWidth, pixelHeight) {
  const image = pixels();
  const scale = Math.min(1, pixelWidth / image.width, pixelHeight / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const rgb = width === image.width && height === image.height
    ? rgbaToRgb(image.rgba, image.width, image.height)
    : resize(image.rgba, image.width, image.height, width, height);
  return { width, height, sixel: toSixel(width, height, rgb) };
}

function rgbaToRgb(rgba, width, height) {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return rgb;
}
