const f = require("node:fs/promises"),
  p = require("node:path"),
  c = require("node:crypto");
module.exports = {
  apply(ctx) {
    require("./ai-tools.js").register(ctx);
    const S = { type: "string" },
      P = {
        source: S,
        path: S,
        offset: { type: "integer", minimum: 0, maximum: 8388608 },
      };
    for (const name of [
      "mapcanvas_sources",
      "mapcanvas_browse",
      "mapcanvas_read",
    ])
      ctx.tool({
        name,
        description:
          name === "mapcanvas_sources"
            ? "列出已授权地图来源及sourceId；首次地图任务先mapcanvas_help，再mapcanvas_preview查看真实图像。"
            : name === "mapcanvas_browse"
              ? "浏览来源内地图目录，返回YAML/PGM/PNG路径。预览图像请用mapcanvas_preview。"
              : "低层按块读取地图文件并返回Base64及SHA；人工分块核验用，图像识别请用mapcanvas_preview。",
        parameters: {
          type: "object",
          properties: name === "mapcanvas_sources" ? {} : P,
          required: name === "mapcanvas_read" ? ["path"] : [],
          additionalProperties: false,
        },
        handler: async (a = {}, api) => {
          if (name === "mapcanvas_sources")
            return api.sources({ operation: "sources" });
          const s = a.path || ".";
          if (
            s.length > 2048 ||
            s.startsWith("/") ||
            /[\\\x00-\x1f]/.test(s) ||
            s.split("/").includes("..")
          )
            throw Error("路径错误");
          const path =
              s
                .split("/")
                .filter((v) => v && v !== ".")
                .join("/") || ".",
            source = a.source || "workspace";
          if (name === "mapcanvas_browse") {
            const r = await api.sources({ operation: "browse", source, path });
            return {
              ...r,
              entries: r.entries.filter(
                (e) =>
                  e.kind === "directory" || /\.(ya?ml|pgm|png)$/i.test(e.path),
              ),
            };
          }
          if (!/\.(ya?ml|pgm|png)$/i.test(path)) throw Error("格式错误");
          const max = /\.ya?ml$/i.test(path) ? 65536 : 8388608,
            r = await api.sources({
              operation: "stage",
              source,
              path,
              slot: "path",
              maxBytes: max,
              maxFiles: 1,
            }),
            root = p.resolve(r.workspace),
            q = p.resolve(root, r.path);
          if (
            !q.startsWith(root + p.sep) ||
            (await f.lstat(q)).isFile() !== true
          )
            throw Error("文件错误");
          const b = await f.readFile(q),
            n = a.offset || 0;
          if (b.length > max || !Number.isInteger(n) || n < 0 || n > b.length)
            throw Error("读取超限");
          const v = b.subarray(n, n + 1048576);
          return {
            total: b.length,
            offset: n,
            bytes: v.length,
            sha256: c.createHash("sha256").update(b).digest("hex"),
            content: v.toString("base64"),
          };
        },
      });
    ctx.slot({ id: "mapcanvas-workbench", name: "地图编辑" });
  },
};
