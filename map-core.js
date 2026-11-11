(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapCanvasCore = factory();
})(globalThis, () => {
  "use strict";
  const E = (message) => {
      throw Error(message);
    },
    T = new TextEncoder();
  function yaml(text) {
    const l = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/),
      v = Object.create(null),
      rows = l
        .map((s, i) => ({
          i,
          m: /^( *)([\w-]+|"[\w-]+"|'[\w-]+')\s*:(.*)$/.exec(s),
        }))
        .filter((r) => r.m);
    if (
      !rows.length ||
      l.filter((s) => s.trim() === "---").length > 1 ||
      l.some((s) => /^ *\t/.test(s))
    )
      E("不支持的YAML结构");
    const base = Math.min(...rows.map((r) => r.m[1].length));
    let idx = -1;
    for (const { i, m } of rows) {
      if (m[1].length !== base) continue;
      const k = m[2].replace(/^['"]|['"]$/g, "");
      if (Object.hasOwn(v, k)) E("YAML第" + (i + 1) + "行重复键 " + k);
      let s = m[3].replace(/\s+#.*$/, "").trim();
      if (k === "origin") {
        if (!s) {
          const a = [];
          for (let j = i + 1; j < l.length; j++) {
            const n = l[j].replace(/\s+#.*$/, "").trim();
            if (!n || n[0] === "#") continue;
            const q = /^-\s+(.+)$/.exec(n);
            if (!q) break;
            a.push(q[1]);
          }
          s = "[" + a.join(",") + "]";
        } else
          for (
            let j = i + 1;
            s[0] === "[" && !s.includes("]") && j < l.length;
            j++
          )
            s += " " + l[j].replace(/\s+#.*$/, "").trim();
      }
      if (s[0] === '"') s = JSON.parse(s);
      else if (s[0] === "'") {
        if (!/^'(?:[^']|'')*'$/.test(s)) E("YAML引号错误");
        s = s.slice(1, -1).replace(/''/g, "'");
      }
      v[k] = s;
      if (k === "image") idx = i;
    }
    const num = (s) =>
        /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(s) &&
        Number.isFinite(+s),
      r = +v.resolution,
      n = +(v.negate ?? 0),
      f = +v.free_thresh,
      o = +v.occupied_thresh;
    if (
      !num(v.resolution) ||
      !num(v.free_thresh) ||
      !num(v.occupied_thresh) ||
      !num(v.negate ?? "0") ||
      r <= 0 ||
      ![0, 1].includes(n) ||
      f < 0 ||
      f >= o ||
      o > 1 ||
      !v.image ||
      /[\x00-\x1f]/.test(v.image) ||
      (v.mode && v.mode !== "trinary")
    )
      E("地图参数错误");
    if (!/^\[[^\[\]]*\]$/.test(v.origin || "")) E("origin格式错误");
    const a = v.origin
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim());
    if (a.at(-1) === "") a.pop();
    if (a.length !== 3 || !a.every(num)) E("origin需三个数字");
    return { l, idx, image: v.image, r, n, f, o, a };
  }
  function path(base, s) {
    if (
      s.startsWith("/") ||
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(s) ||
      /[\\\x00-\x1f]/.test(s)
    )
      E("请手动指定图片");
    const a = base.split("/").slice(0, -1);
    for (const p of s.split("/"))
      if (p === "..") {
        if (!a.length) E("image越界");
        a.pop();
      } else if (p && p !== ".") a.push(p);
    return a.join("/");
  }
  function pgm(b) {
    let p = 0;
    const ws = (c) => [9, 10, 11, 12, 13, 32].includes(c),
      skip = () => {
        while (p < b.length) {
          if (ws(b[p])) p++;
          else if (b[p] === 35) {
            while (p < b.length && ![10, 13].includes(b[p])) p++;
          } else break;
        }
      },
      tok = () => {
        skip();
        let s = "";
        while (p < b.length && !ws(b[p]) && b[p] !== 35) {
          s += String.fromCharCode(b[p++]);
          if (s.length > 64) E("PGM错误");
        }
        return s;
      },
      num = () => {
        const s = tok();
        if (!/^\d+$/.test(s)) E("PGM数字错误");
        return +s;
      };
    const t = tok(),
      w = num(),
      h = num(),
      max = num(),
      n = w * h;
    if (
      !["P2", "P5"].includes(t) ||
      !w ||
      !h ||
      w > 16384 ||
      h > 16384 ||
      n > 4194304 ||
      max < 1 ||
      max > 65535
    )
      E("PGM尺寸/格式错误");
    const data = new Uint16Array(n);
    if (t === "P5") {
      if (!ws(b[p])) E("PGM分隔错误");
      if (b[p++] === 13 && b[p] === 10) p++;
      if (b.length - p !== n * (max > 255 ? 2 : 1)) E("PGM长度错误");
      for (let i = 0; i < n; i++)
        data[i] = max > 255 ? b[p++] * 256 + b[p++] : b[p++];
    } else {
      for (let i = 0; i < n; i++) {
        const value = num();
        if (value > max) E("像素超限");
        data[i] = value;
      }
      skip();
      if (p !== b.length) E("PGM多余数据");
    }
    if (data.some((v) => v > max)) E("像素超限");
    return { w, h, max, data };
  }
  function encodePGM(M) {
    const h = T.encode("P5\n" + M.w + " " + M.h + "\n" + M.max + "\n"),
      b = new Uint8Array(h.length + M.data.length * (M.max > 255 ? 2 : 1));
    b.set(h);
    let p = h.length;
    for (const v of M.data) {
      if (M.max > 255) b[p++] = v >> 8;
      b[p++] = v & 255;
    }
    return b;
  }

  function isUnknown(value, a, max) {
    const p = a.n ? value / max : 1 - value / max;
    const byte = Math.round(value * 255 / max);
    const q = a.n ? byte / 255 : 1 - byte / 255;
    return p > a.f && p < a.o && q > a.f && q < a.o;
  }
  function selectGray(map, a) {
    const counts = new Uint32Array(map.max + 1);
    for (const value of map.data) counts[value]++;
    let value = -1, count = 0;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] > count && isUnknown(i, a, map.max)) {
        value = i;
        count = counts[i];
      }
    }
    if (value >= 0) return { value, source: "map", count };
    try {
      return { value: brushValue("gray", a, map.max), source: "fallback", count: 0 };
    } catch {
      return { value: null, source: "unavailable", count: 0 };
    }
  }
  function brushValue(mode, a, max) {
    if (mode === "wall") return a.n * max;
    if (mode === "erase") return (1 - a.n) * max;
    if (mode !== "gray") E("未知画笔");
    if (Number.isSafeInteger(a.grayValue) && a.grayValue >= 0 && a.grayValue <= max && isUnknown(a.grayValue, a, max))
      return a.grayValue;
    const probability = (a.f + a.o) / 2;
    const value = Math.round((a.n ? probability : 1 - probability) * max);
    const actual = a.n ? value / max : 1 - value / max;
    if (!(actual > a.f && actual < a.o) || !isUnknown(value, a, max)) E("当前灰阶精度不足以表示未知区域");
    return value;
  }
  function applyOperations(map, a, operations) {
    if (
      !Array.isArray(operations) ||
      operations.length < 1 ||
      operations.length > 128
    )
      E("需1–128个编辑操作");
    if (operations.some(op => op?.mode === "gray"))
      a = { ...a, grayValue: selectGray(map, a).value };
    let work = 0,
      points = 0;
    const integer = (v, min, max) =>
      Number.isSafeInteger(v) && v >= min && v <= max;
    // Validate the entire batch before copying or editing pixels.
    for (const op of operations) {
      if (!op || typeof op !== "object" || Array.isArray(op)) E("操作格式错误");
      brushValue(op.mode, a, map.max);
      const keys =
        op.type === "stroke"
          ? ["type", "mode", "size", "points"]
          : ["type", "mode", "x", "y", "width", "height"];
      if (Object.keys(op).some((k) => !keys.includes(k))) E("未知操作字段");
      if (op.type === "rect") {
        if (
          !integer(op.x, 0, map.w - 1) ||
          !integer(op.y, 0, map.h - 1) ||
          !integer(op.width, 1, map.w - op.x) ||
          !integer(op.height, 1, map.h - op.y)
        )
          E("矩形越界或非整数");
        work += op.width * op.height;
      } else if (op.type === "stroke") {
        if (
          !integer(op.size, 1, 200) ||
          !Array.isArray(op.points) ||
          !op.points.length ||
          op.points.length > 256
        )
          E("笔画尺寸/点数错误");
        points += op.points.length;
        for (const p of op.points)
          if (
            !Array.isArray(p) ||
            p.length !== 2 ||
            !integer(p[0], 0, map.w - 1) ||
            !integer(p[1], 0, map.h - 1)
          )
            E("笔画坐标越界或非整数");
        work += (op.size + 1) ** 2;
        for (let i = 1; i < op.points.length; i++)
          work +=
            (Math.ceil(
              Math.hypot(
                op.points[i][0] - op.points[i - 1][0],
                op.points[i][1] - op.points[i - 1][1],
              ) / Math.max(0.5, op.size / 4),
            ) +
              1) *
            (op.size + 1) ** 2;
      } else E("仅支持stroke或rect");
      if (work > 32000000 || points > 4096) E("编辑工作量超限，请拆分操作");
    }
    const result = { ...map, data: map.data.slice() };
    const stamp = (x, y, size, value) => {
      const r = size / 2;
      for (
        let yy = Math.max(0, Math.floor(y - r));
        yy <= Math.min(map.h - 1, Math.floor(y + r));
        yy++
      )
        for (
          let xx = Math.max(0, Math.floor(x - r));
          xx <= Math.min(map.w - 1, Math.floor(x + r));
          xx++
        ) {
          if (
            size === 1
              ? xx !== Math.floor(x) || yy !== Math.floor(y)
              : (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 > r * r
          )
            continue;
          result.data[yy * map.w + xx] = value;
        }
    };
    for (const op of operations) {
      const value = brushValue(op.mode, a, map.max);
      if (op.type === "rect") {
        for (let y = op.y; y < op.y + op.height; y++)
          result.data.fill(
            value,
            y * map.w + op.x,
            y * map.w + op.x + op.width,
          );
      } else {
        const p = op.points;
        stamp(p[0][0] + 0.5, p[0][1] + 0.5, op.size, value);
        for (let i = 1; i < p.length; i++) {
          const n = Math.ceil(
            Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) /
              Math.max(0.5, op.size / 4),
          );
          for (let j = 0; j <= n; j++)
            stamp(
              p[i - 1][0] + 0.5 + (p[i][0] - p[i - 1][0]) * (n ? j / n : 0),
              p[i - 1][1] + 0.5 + (p[i][1] - p[i - 1][1]) * (n ? j / n : 0),
              op.size,
              value,
            );
        }
      }
    }
    let changedPixels = 0;
    for (let i = 0; i < map.data.length; i++)
      if (map.data[i] !== result.data[i]) changedPixels++;
    return { map: result, changedPixels };
  }
  function encodeP2(map) {
    const rows = ["P2", map.w + " " + map.h, String(map.max)];
    let size = 0;
    for (let y = 0; y < map.h; y++) {
      const line = map.data.subarray(y * map.w, (y + 1) * map.w).join(" ");
      size += line.length + 1;
      if (size > 24 * 1024 * 1024) E("PGM文本导出超过24MiB");
      rows.push(line);
    }
    return rows.join("\n") + "\n";
  }
  return Object.freeze({
    yaml,
    path,
    pgm,
    encodePGM,
    encodeP2,
    brushValue,
    selectGray,
    applyOperations,
  });
});
