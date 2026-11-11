"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  zlib = require("node:zlib");
const core = require("../map-core.js"),
  png = require("../png.js"),
  root = path.resolve(__dirname, "..");
const tools = new Map();
require("../index.js").apply({ tool: (t) => tools.set(t.name, t), slot() {} });
const yaml = fs.readFileSync(path.join(root, "examples/map.yaml"), "utf8"),
  a = core.yaml(yaml),
  digest = (b) => crypto.createHash("sha256").update(b).digest("hex");
function map(w = 6, h = 4, max = 255) {
  return { w, h, max, data: new Uint16Array(w * h).fill(max) };
}
test("gray remains unknown under negate and 16-bit; rect and stroke use raster coordinates", () => {
  for (const max of [255, 65535])
    for (const n of [0, 1]) {
      const metadata = { ...a, n },
        v = core.brushValue("gray", metadata, max),
        p = n ? v / max : 1 - v / max;
      assert(p > a.f && p < a.o);
      const m = map(6, 4, max),
        r = core.applyOperations(m, metadata, [
          { type: "rect", mode: "gray", x: 2, y: 1, width: 2, height: 1 },
          {
            type: "stroke",
            mode: "wall",
            size: 1,
            points: [
              [0, 0],
              [3, 0],
            ],
          },
        ]);
      assert.equal(r.map.data[8], v);
      assert.equal(r.map.data[9], v);
      assert.equal(r.map.data[10], max);
      assert.deepEqual([...r.map.data.slice(0, 4)], new Array(4).fill(n * max));
      assert(
        m.data.every((v) => v === max),
        "input remains unchanged",
      );
      const roundtrip = core.pgm(Buffer.from(core.encodeP2(r.map)));
      assert.deepEqual([...roundtrip.data], [...r.map.data]);
    }
});
test("whole operation batches reject invalid bounds, modes, work and unknown fields without touching input", () => {
  const m = map();
  for (const operations of [
    [],
    [
      { type: "rect", mode: "gray", x: 0, y: 0, width: 2, height: 2 },
      { type: "rect", mode: "wall", x: 5, y: 0, width: 2, height: 2 },
    ],
    [{ type: "stroke", mode: "gray", size: 5, points: [[0.5, 1]] }],
    [{ type: "stroke", mode: "bad", size: 1, points: [[0, 0]] }],
    [
      {
        type: "rect",
        mode: "wall",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        command: "invalid",
      },
    ],
  ]) {
    assert.throws(() => core.applyOperations(m, a, operations));
    assert(m.data.every((v) => v === 255));
  }
  assert.throws(() => core.brushValue("gray", a, 1));
  const huge = map(4096, 1024);
  assert.throws(
    () =>
      core.applyOperations(
        huge,
        a,
        new Array(9).fill({
          type: "rect",
          mode: "wall",
          x: 0,
          y: 0,
          width: 4096,
          height: 1024,
        }),
      ),
    /工作量/,
  );
});
test("shared inline browser core exactly matches backend module", () => {
  const s = fs.readFileSync(path.join(root, "workbench.html"), "utf8");
  assert.equal(
    s
      .split("/* MAPCANVAS_CORE_BEGIN */")[1]
      .split("/* MAPCANVAS_CORE_END */")[0]
      .trim(),
    fs.readFileSync(path.join(root, "map-core.js"), "utf8").trim(),
  );
});
// Independently assemble PNG fixtures (five filters, palette, transparency).
function crc(b) {
  let n = 0xffffffff;
  for (const v of b) {
    n ^= v;
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  }
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(t, d) {
  const n = Buffer.from(t),
    b = Buffer.alloc(d.length + 12);
  b.writeUInt32BE(d.length);
  n.copy(b, 4);
  d.copy(b, 8);
  b.writeUInt32BE(crc(Buffer.concat([n, d])), b.length - 4);
  return b;
}
function makePNG(type, w, h, bytes, filter = 0, extras = []) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type],
    stride = w * channels,
    raw = Buffer.alloc((stride + 1) * h),
    head = Buffer.alloc(13);
  head.writeUInt32BE(w);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = type;
  const paeth = (a, b, c) => {
    const p = a + b - c,
      x = Math.abs(p - a),
      y = Math.abs(p - b),
      z = Math.abs(p - c);
    return x <= y && x <= z ? a : y <= z ? b : c;
  };
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x,
        a = x >= channels ? bytes[i - channels] : 0,
        b = y ? bytes[i - stride] : 0,
        c = y && x >= channels ? bytes[i - stride - channels] : 0;
      raw[y * (stride + 1) + x + 1] =
        (bytes[i] -
          [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) &
        255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    ...extras,
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
test("PNG grayscale codecs handle all filters and opaque RGB/RGBA/palette; reject corruption/transparency/color", () => {
  const pixels = [0, 42, 255, 18, 99, 201];
  for (let filter = 0; filter <= 4; filter++)
    assert.deepEqual(
      [...png.decode(makePNG(0, 3, 2, pixels, filter)).data],
      pixels,
    );
  for (const type of [2, 4, 6]) {
    const bytes = pixels.flatMap((v) =>
      type === 2 ? [v, v, v] : type === 4 ? [v, 255] : [v, v, v, 255],
    );
    assert.deepEqual(
      [...png.decode(makePNG(type, 3, 2, bytes, 4)).data],
      pixels,
    );
  }
  assert.deepEqual(
    [
      ...png.decode(
        makePNG(3, 3, 1, [0, 1, 2], 0, [
          chunk("PLTE", Buffer.from([0, 0, 0, 128, 128, 128, 255, 255, 255])),
        ]),
      ).data,
    ],
    [0, 128, 255],
  );
  assert.throws(() => png.decode(makePNG(6, 1, 1, [4, 4, 4, 0])));
  assert.throws(() => png.decode(makePNG(2, 1, 1, [4, 5, 4])));
  assert.throws(() =>
    png.decode(makePNG(0, 1, 1, [4], 0, [chunk("tRNS", Buffer.from([0, 4]))])),
  );
  const broken = makePNG(0, 1, 1, [4]);
  broken[40] ^= 1;
  assert.throws(() => png.decode(broken), /校验/);
  const m = map();
  m.data[2] = 147;
  assert.deepEqual([...png.decode(png.encode(m)).data], [...m.data]);
});
async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mapcanvas-ai-"));
  try {
    fs.writeFileSync(path.join(dir, "map.yaml"), yaml + "start: [1, 2, 3]\n");
    fs.writeFileSync(path.join(dir, "map.pgm"), core.encodePGM(map()));
    const calls = [];
    const api = {
      sources: async (args) => {
        calls.push(args);
        return { workspace: dir, path: args.path };
      },
      proposeWrite: (p, content) => ({
        proposal: { type: "file", path: p, content },
      }),
    };
    await fn({ dir, api, calls });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test("preview returns actual cropped PNG pixels and full raster/source identity, not raw file Base64", () =>
  fixture(async ({ api, calls, dir }) => {
    const tool = tools.get("mapcanvas_preview"),
      r = await tool.handler(
        { yamlPath: "map.yaml", crop: { x: 2, y: 1, width: 3, height: 2 } },
        api,
      );
    assert.equal(r.protocol, "plugin-tool-images-v1");
    assert.equal(r.map.width, 6);
    assert.equal(r.map.height, 4);
    assert.equal(
      r.map.imageSha256,
      digest(fs.readFileSync(path.join(dir, "map.pgm"))),
    );
    assert.equal(r.saved, false);
    assert.equal(r.images.length, 1);
    assert.equal(
      png.decode(Buffer.from(r.images[0].dataBase64, "base64")).w,
      3,
    );
    assert.deepEqual(r.views[0].bounds, { x: 2, y: 1, width: 3, height: 2 });
    assert(calls.every((v) => v.operation === "stage"));
    assert.deepEqual(
      calls.map((v) => v.slot),
      ["left", "right"],
    );
    assert.equal(r.content, undefined);
    const wide = map(2048, 2);
    fs.writeFileSync(path.join(dir, "map.pgm"), core.encodePGM(wide));
    const w = await tool.handler({ yamlPath: "map.yaml" }, api);
    assert.equal(w.views[0].width, 1024);
    assert.equal(w.views[0].pixelsPerPreviewPixel.x, 2);
    await assert.rejects(
      () =>
        tool.handler(
          {
            yamlPath: "map.yaml",
            crop: { x: 2047, y: 0, width: 2, height: 1 },
          },
          api,
        ),
      /越界/,
    );
  }));
test("dry-run and version-checked edit produce exact paired proposals; originals remain byte-identical", () =>
  fixture(async ({ api, dir }) => {
    const preview = tools.get("mapcanvas_preview"),
      edit = tools.get("mapcanvas_edit"),
      p = await preview.handler({ yamlPath: "map.yaml" }, api),
      before = fs.readFileSync(path.join(dir, "map.pgm")),
      beforeYaml = fs.readFileSync(path.join(dir, "map.yaml"));
    const args = {
      yamlPath: "map.yaml",
      expectedImageSha256: p.map.imageSha256,
      expectedYamlSha256: p.map.yamlSha256,
      operations: [
        { type: "rect", mode: "gray", x: 2, y: 1, width: 2, height: 1 },
      ],
      outputPath: "exports/result.pgm",
    };
    const dry = await preview.handler(args, api);
    assert.equal(dry.images.length, 2);
    assert.equal(dry.changedPixels, 2);
    assert.equal(dry.previewOnly, true);
    const r = await edit.handler(args, api);
    assert.equal(r.length, 2);
    assert.equal(r[0].proposal.path, "exports/result.pgm");
    const actual = core.pgm(Buffer.from(r[0].proposal.content));
    assert.equal(actual.data[8], core.brushValue("gray", a, 255));
    assert.equal(actual.data[10], 255);
    const meta = core.yaml(r[1].proposal.content);
    assert.equal(meta.image, "result.pgm");
    assert.equal(meta.r, a.r);
    assert(meta.l.includes("start: [1, 2, 3]"));
    assert.equal(r[1].proposal.path, "exports/result.yaml");
    assert(fs.readFileSync(path.join(dir, "map.pgm")).equals(before));
    assert(fs.readFileSync(path.join(dir, "map.yaml")).equals(beforeYaml));
    assert(!fs.existsSync(path.join(dir, "exports")));
    await assert.rejects(
      () => edit.handler({ ...args, outputPath: "map.pgm" }, api),
      /输入原图/,
    );
    await assert.rejects(
      () => edit.handler({ ...args, expectedImageSha256: "0".repeat(64) }, api),
      /版本/,
    );
    fs.appendFileSync(path.join(dir, "map.yaml"), "# changed\n");
    await assert.rejects(() => edit.handler(args, api), /版本/);
  }));
test("PNG preview/edit and help are executable tools; invalid source/stage paths rejected", () =>
  fixture(async ({ api, dir }) => {
    const m = map();
    fs.writeFileSync(path.join(dir, "map.png"), png.encode(m));
    const r = await tools
      .get("mapcanvas_preview")
      .handler({ yamlPath: "map.yaml", imagePath: "map.png" }, api);
    assert.equal(r.map.imagePath, "map.png");
    const help = await tools.get("mapcanvas_help").handler();
    assert(help.includes("mapcanvas_preview"));
    assert(help.includes("提示词"));
    for (const yamlPath of ["../x.yaml", "/x.yaml", "x:y.yaml"])
      await assert.rejects(() =>
        tools.get("mapcanvas_preview").handler({ yamlPath }, api),
      );
    await assert.rejects(() =>
      tools
        .get("mapcanvas_preview")
        .handler({ yamlPath: "map.yaml", sourceId: "http://x" }, api),
    );
    await assert.rejects(
      () =>
        tools
          .get("mapcanvas_preview")
          .handler(
            { yamlPath: "map.yaml" },
            { sources: () => ({ workspace: dir, path: "../outside.yaml" }) },
          ),
      /越界/,
    );
  }));

test("unknown brush inherits exact dominant source gray and freezes GUI value", () => {
  for (const [max, value] of [[255, 128], [255, 205], [65535, 32896]]) {
    const metadata = { ...a, f: 0.196, o: 0.65, n: 0 };
    const m = {w: 6, h: 1, max, data: new Uint16Array([0, max, value, value, value, Math.round(max * .5)])};
    const before = [...m.data], chosen = core.selectGray(m, metadata);
    assert.deepEqual(chosen, {value, source:"map", count:before.filter(v=>v===value).length});
    const r = core.applyOperations(m, metadata, [{type:"rect",mode:"gray",x:0,y:0,width:2,height:1}]);
    assert.deepEqual([...r.map.data.slice(0,2)], [value,value]);
    assert.deepEqual([...m.data],before);
    const frozen = {...metadata,grayValue:chosen.value};
    m.data.fill(max);
    assert.equal(core.brushValue("gray", frozen, max),value);
    assert.equal(core.selectGray(m, metadata).source,"fallback");
  }
  const neg = {...a,n:1,f:.25,o:.65};
  assert.equal(core.selectGray({max:255,data:[128,128,140,0,255]},neg).value,128);
  const narrow = {...a,n:0,f:.499,o:.501};
  const unsupported = core.selectGray({max:65535,data:[32768]},narrow);
  assert.equal(unsupported.source,"unavailable","8-bit Nav2 conversion must also remain unknown");
  assert.equal(core.selectGray({max:1,data:[0,1]},a).source,"unavailable");
  assert.throws(()=>core.applyOperations({w:2,h:1,max:1,data:new Uint16Array([0,1])},a,[{type:"rect",mode:"gray",x:0,y:0,width:1,height:1}]));
});

test("AI preview, dry-run and paired export preserve source unknown gray128", () =>
  fixture(async ({api,dir}) => {
    const m=map();m.data[0]=m.data[1]=m.data[2]=128;
    fs.writeFileSync(path.join(dir,"map.pgm"),core.encodePGM(m));
    const p=await tools.get("mapcanvas_preview").handler({yamlPath:"map.yaml"},api);
    assert.deepEqual(p.map.unknownBrush,{value:128,source:"map",count:3});
    const args={yamlPath:"map.yaml",expectedImageSha256:p.map.imageSha256,expectedYamlSha256:p.map.yamlSha256,operations:[{type:"rect",mode:"gray",x:2,y:1,width:2,height:1}],outputPath:"derived/map.pgm"};
    const dry=await tools.get("mapcanvas_preview").handler(args,api);
    const im=png.decode(Buffer.from(dry.images[1].dataBase64,"base64"));
    assert.equal(im.data[8],128);assert.equal(im.data[9],128);
    const output=await tools.get("mapcanvas_edit").handler(args,api);
    const raster=core.pgm(Buffer.from(output[0].proposal.content));
    assert.equal(raster.data[8],128);assert.equal(raster.data[0],128);
    assert.deepEqual([...core.pgm(fs.readFileSync(path.join(dir,"map.pgm"))).data],[...m.data]);
  }));
