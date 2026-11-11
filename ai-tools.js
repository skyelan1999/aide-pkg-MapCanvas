"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const core = require("./map-core.js"),
  png = require("./png.js");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
function relative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2048 ||
    value.startsWith("/") ||
    /[:\\\x00-\x1f]/.test(value) ||
    value.split("/").some((x) => !x || x === "." || x === "..") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
  )
    throw Error("需要来源内的规范相对路径");
  return value;
}
async function staged(api, source, name, max, slot) {
  relative(name);
  const r = await api.sources({
    operation: "stage",
    source,
    path: name,
    slot,
    maxBytes: max,
    maxFiles: 1,
  });
  const root = path.resolve(r.workspace),
    file = path.resolve(root, r.path);
  if (!file.startsWith(root + path.sep)) throw Error("暂存路径越界");
  const handle = await fs.open(
    file,
    require("node:fs").constants.O_RDONLY |
      require("node:fs").constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > max) throw Error("文件格式或大小错误");
    const b = await handle.readFile();
    if (b.length !== stat.size || b.length > max)
      throw Error("读取期间文件改变");
    return b;
  } finally {
    await handle.close();
  }
}
async function load(api, a) {
  const source = a.sourceId || "workspace";
  if (
    source !== "workspace" &&
    source !== "context" &&
    !/^source:[A-Za-z0-9_-]+$/.test(source)
  )
    throw Error("来源ID错误，请先调用mapcanvas_sources");
  const yamlPath = relative(a.yamlPath);
  if (!/\.ya?ml$/i.test(yamlPath)) throw Error("需要YAML路径");
  const yamlBytes = await staged(api, source, yamlPath, 65536, "left"),
    metadata = core.yaml(
      new TextDecoder("utf-8", { fatal: true }).decode(yamlBytes),
    );
  const imagePath = relative(
    a.imagePath || core.path(yamlPath, metadata.image),
  );
  if (!/\.(pgm|png)$/i.test(imagePath)) throw Error("需要PGM/PNG路径");
  const imageBytes = await staged(api, source, imagePath, 8388608, "right"),
    map = /\.pgm$/i.test(imagePath)
      ? core.pgm(imageBytes)
      : png.decode(imageBytes);
  return {
    map,
    metadata,
    source,
    yamlPath,
    imagePath,
    yamlSha256: sha(yamlBytes),
    imageSha256: sha(imageBytes),
  };
}
function crop(map, box) {
  const b = box || { x: 0, y: 0, width: map.w, height: map.h };
  if (
    !b ||
    Object.keys(b).some((k) => !["x", "y", "width", "height"].includes(k)) ||
    ![b.x, b.y, b.width, b.height].every(Number.isSafeInteger) ||
    b.x < 0 ||
    b.y < 0 ||
    b.width < 1 ||
    b.height < 1 ||
    b.x + b.width > map.w ||
    b.y + b.height > map.h
  )
    throw Error("裁剪区域越界");
  const scale = Math.min(1, 1024 / b.width, 1024 / b.height),
    w = Math.max(1, Math.round(b.width * scale)),
    h = Math.max(1, Math.round(b.height * scale)),
    data = new Uint16Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      data[y * w + x] =
        map.data[
          (b.y +
            Math.min(b.height - 1, Math.floor(((y + 0.5) * b.height) / h))) *
            map.w +
            b.x +
            Math.min(b.width - 1, Math.floor(((x + 0.5) * b.width) / w))
        ];
  return {
    map: { w, h, max: map.max, data },
    bounds: b,
    pixelsPerPreviewPixel: { x: b.width / w, y: b.height / h },
  };
}
function evidence(map, box) {
  const r = crop(map, box),
    b = png.encode(r.map);
  if (b.length > 2 * 1024 * 1024) throw Error("预览超过图像预算");
  return {
    image: {
      mediaType: "image/png",
      dataBase64: b.toString("base64"),
      sha256: sha(b),
    },
    view: {
      bounds: r.bounds,
      width: r.map.w,
      height: r.map.h,
      pixelsPerPreviewPixel: r.pixelsPerPreviewPixel,
    },
  };
}
function identity(r) {
  return {
    sourceId: r.source,
    yamlPath: r.yamlPath,
    imagePath: r.imagePath,
    yamlSha256: r.yamlSha256,
    imageSha256: r.imageSha256,
    width: r.map.w,
    height: r.map.h,
    maxGray: r.map.max,
    resolution: r.metadata.r,
    origin: r.metadata.a.map(Number),
    negate: r.metadata.n,
    freeThreshold: r.metadata.f,
    occupiedThreshold: r.metadata.o,
    coordinates:
      "integer raster pixels, x right, y down, origin at upper-left; ROS world origin is lower-left with origin yaw",
  };
}
function checkVersion(r, a) {
  if (
    !/^[a-f0-9]{64}$/.test(a.expectedImageSha256 || "") ||
    !/^[a-f0-9]{64}$/.test(a.expectedYamlSha256 || "") ||
    a.expectedImageSha256 !== r.imageSha256 ||
    a.expectedYamlSha256 !== r.yamlSha256
  )
    throw Error("地图版本已变化，请重新预览并使用当前图像和YAML摘要");
}
const S = { type: "string" },
  I = { type: "integer", minimum: 0 },
  hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const operation = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "mode", "size", "points"],
      properties: {
        type: { const: "stroke" },
        mode: { enum: ["wall", "erase", "gray"] },
        size: { type: "integer", minimum: 1, maximum: 200 },
        points: {
          type: "array",
          minItems: 1,
          maxItems: 256,
          items: { type: "array", minItems: 2, maxItems: 2, items: I },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "mode", "x", "y", "width", "height"],
      properties: {
        type: { const: "rect" },
        mode: { enum: ["wall", "erase", "gray"] },
        x: I,
        y: I,
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
      },
    },
  ],
};
const base = { sourceId: S, yamlPath: S, imagePath: S },
  edits = {
    operations: { type: "array", minItems: 1, maxItems: 128, items: operation },
  },
  versions = { expectedImageSha256: hash, expectedYamlSha256: hash };
function register(ctx) {
  ctx.tool({
    name: "mapcanvas_help",
    description:
      "MapCanvas使用指南和可直接复用的提示词。首次地图任务先读此工具；预览返回真实图片和像素坐标，编辑返回PGM+YAML文件提案。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: () => fs.readFile(path.join(__dirname, "AI-GUIDE.md"), "utf8"),
  });
  ctx.tool({
    name: "mapcanvas_preview",
    description:
      "预览已授权来源的ROS地图，返回真实PNG视觉证据、尺寸/坐标/图像与YAML摘要。可传operations只读试画并比较前后；crop缩小范围以精确定位。先mapcanvas_help，勿把Base64当图像。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["yamlPath"],
      properties: {
        ...base,
        ...edits,
        ...versions,
        crop: {
          type: "object",
          additionalProperties: false,
          required: ["x", "y", "width", "height"],
          properties: {
            x: I,
            y: I,
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 },
          },
        },
      },
    },
    handler: async (a, api) => {
      const r = await load(api, a);
      let changed;
      if (a.operations) {
        checkVersion(r, a);
        changed = core.applyOperations(r.map, r.metadata, a.operations);
      }
      const before = evidence(r.map, a.crop),
        after = changed && evidence(changed.map, a.crop);
      return {
        protocol: "plugin-tool-images-v1",
        map: identity(r),
        saved: false,
        previewOnly: true,
        changedPixels: changed?.changedPixels || 0,
        views: [
          { kind: "input", ...before.view },
          ...(after ? [{ kind: "edited-preview", ...after.view }] : []),
        ],
        images: [before.image, ...(after ? [after.image] : [])],
      };
    },
  });
  ctx.tool({
    name: "mapcanvas_edit",
    description:
      "按mapcanvas_preview返回的两项SHA对PGM/PNG执行像素stroke/rect（wall/erase/gray），生成outputPath.pgm和配套YAML两条文件提案。先用preview同批operations试画；输入原图不覆盖，待宿主实际应用后再预览输出YAML核验，不把提案当已保存。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "yamlPath",
        "expectedImageSha256",
        "expectedYamlSha256",
        "operations",
        "outputPath",
      ],
      properties: { ...base, ...edits, ...versions, outputPath: S },
    },
    handler: async (a, api) => {
      const r = await load(api, a);
      checkVersion(r, a);
      const out = relative(a.outputPath);
      if (
        !/\.pgm$/i.test(out) ||
        out.toLowerCase() === r.imagePath.toLowerCase()
      )
        throw Error("输出需不同于输入原图的.pgm相对路径");
      const outputYaml = out.replace(/\.pgm$/i, ".yaml");
      if (outputYaml.toLowerCase() === r.yamlPath.toLowerCase())
        throw Error("输出配套YAML不能覆盖输入YAML");
      const edited = core.applyOperations(r.map, r.metadata, a.operations),
        lines = [...r.metadata.l],
        indent = /^ */.exec(lines[r.metadata.idx])[0];
      lines[r.metadata.idx] =
        indent + "image: " + JSON.stringify(path.posix.basename(out));
      return [
        api.proposeWrite(out, core.encodeP2(edited.map)),
        api.proposeWrite(outputYaml, lines.join("\n")),
      ];
    },
  });
}
module.exports = { register, load, evidence, identity, relative };
