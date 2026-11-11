"use strict";
const zlib = require("node:zlib");
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) n = table[(n ^ b) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([name, data])), out.length - 4);
  return out;
}
function encode(map) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(map.w);
  head.writeUInt32BE(map.h, 4);
  head[8] = 8;
  const raw = Buffer.alloc((map.w + 1) * map.h);
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++)
      raw[y * (map.w + 1) + x + 1] = Math.round(
        (map.data[y * map.w + x] * 255) / map.max,
      );
  return Buffer.concat([
    signature,
    chunk("IHDR", head),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function decode(input) {
  const b = Buffer.from(input);
  if (
    b.length > 8388608 ||
    b.length < 33 ||
    !b.subarray(0, 8).equals(signature)
  )
    throw Error("PNG格式/大小错误");
  let head,
    palette,
    alpha,
    ended = false,
    seenIDAT = false,
    endedIDAT = false;
  const parts = [];
  for (let p = 8; p < b.length; ) {
    if (p + 12 > b.length) throw Error("PNG块截断");
    const size = b.readUInt32BE(p),
      end = p + 12 + size;
    if (end > b.length) throw Error("PNG块长度错误");
    const type = b.toString("ascii", p + 4, p + 8),
      data = b.subarray(p + 8, p + 8 + size);
    if (crc(b.subarray(p + 4, p + 8 + size)) !== b.readUInt32BE(p + 8 + size))
      throw Error("PNG校验失败");
    if (!head && type !== "IHDR") throw Error("PNG缺少头部");
    if (type === "IHDR") {
      if (head || size !== 13) throw Error("PNG头部错误");
      head = data;
    } else if (type === "PLTE") {
      if (palette || seenIDAT || !size || size % 3 || size > 768)
        throw Error("PNG调色板错误");
      palette = data;
    } else if (type === "tRNS") {
      if (alpha || seenIDAT) throw Error("PNG透明信息错误");
      alpha = data;
    } else if (type === "IDAT") {
      if (endedIDAT) throw Error("PNG数据块不连续");
      seenIDAT = true;
      parts.push(data);
    } else if (type === "IEND") {
      if (size || end !== b.length || !seenIDAT) throw Error("PNG结尾错误");
      ended = true;
      break;
    } else {
      if (seenIDAT) endedIDAT = true;
      if (!(b[p + 4] & 32)) throw Error("不支持的PNG关键块");
    }
    p = end;
  }
  if (!head || !ended) throw Error("PNG数据不完整");
  const w = head.readUInt32BE(),
    h = head.readUInt32BE(4),
    type = head[9],
    channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (
    !w ||
    !h ||
    w > 16384 ||
    h > 16384 ||
    w * h > 4194304 ||
    head[8] !== 8 ||
    !channels ||
    head[10] ||
    head[11] ||
    head[12]
  )
    throw Error("AI预览需要非交错8位灰度PNG，最多4194304像素");
  if (type === 3 && !palette) throw Error("PNG缺少调色板");
  if (
    alpha &&
    ((type === 0 && alpha.length !== 2) ||
      (type === 2 && alpha.length !== 6) ||
      (type === 3 && alpha.length > palette.length / 3) ||
      [4, 6].includes(type))
  )
    throw Error("PNG透明信息错误");
  const stride = w * channels,
    expected = (stride + 1) * h,
    raw = zlib.inflateSync(Buffer.concat(parts), { maxOutputLength: expected });
  if (raw.length !== expected) throw Error("PNG栅格长度错误");
  const raster = Buffer.alloc(stride * h),
    paeth = (a, b, c) => {
      const p = a + b - c,
        x = Math.abs(p - a),
        y = Math.abs(p - b),
        z = Math.abs(p - c);
      return x <= y && x <= z ? a : y <= z ? b : c;
    };
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw Error("PNG滤波错误");
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x,
        a = x >= channels ? raster[i - channels] : 0,
        up = y ? raster[i - stride] : 0,
        c = y && x >= channels ? raster[i - stride - channels] : 0;
      raster[i] =
        (raw[y * (stride + 1) + 1 + x] +
          [0, a, up, Math.floor((a + up) / 2), paeth(a, up, c)][filter]) &
        255;
    }
  }
  const data = new Uint16Array(w * h);
  for (let i = 0; i < data.length; i++) {
    const p = i * channels;
    let r = raster[p],
      g = r,
      blue = r,
      a = 255;
    if (type === 2 || type === 6) {
      g = raster[p + 1];
      blue = raster[p + 2];
    }
    if (type === 4) a = raster[p + 1];
    if (type === 6) a = raster[p + 3];
    if (type === 3) {
      const index = r;
      if (index * 3 + 2 >= palette.length) throw Error("PNG调色板索引错误");
      r = palette[index * 3];
      g = palette[index * 3 + 1];
      blue = palette[index * 3 + 2];
      a = alpha && index < alpha.length ? alpha[index] : 255;
    }
    if (alpha && type === 0 && r === alpha.readUInt16BE()) a = 0;
    if (
      alpha &&
      type === 2 &&
      r === alpha.readUInt16BE() &&
      g === alpha.readUInt16BE(2) &&
      blue === alpha.readUInt16BE(4)
    )
      a = 0;
    if (a !== 255 || r !== g || r !== blue)
      throw Error("PNG必须为不透明灰度图");
    data[i] = r;
  }
  return { w, h, max: 255, data };
}
module.exports = { encode, decode };
