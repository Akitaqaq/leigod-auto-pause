"use strict";
/**
 * 雷神加速器 HTTP 请求体加解密
 * 算法来源: @leigod/crypto (app.asar)
 *
 * encrypt(obj):
 *   JSON -> zlib.deflate -> RC4(key="abc") -> base64
 * decrypt(b64):
 *   base64 -> RC4(key="abc") -> zlib.inflate -> 去掉 \r\n\r\n 前缀 -> JSON
 */
const zlib = require("zlib");

function rc4(key, data) {
  const S = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 255;
    [S[i], S[j]] = [S[j], S[i]];
  }
  let i = 0;
  j = 0;
  const out = Buffer.alloc(data.length);
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + S[i]) & 255;
    [S[i], S[j]] = [S[j], S[i]];
    out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
  }
  return out;
}

const DEFAULT_KEY = "abc";

function encrypt(obj, key = DEFAULT_KEY) {
  const json = Buffer.from(JSON.stringify(obj ?? {}), "utf8");
  const deflated = zlib.deflateSync(json);
  return rc4(Buffer.from(key, "utf8"), deflated).toString("base64");
}

function decrypt(b64, key = DEFAULT_KEY) {
  if (!b64 || typeof b64 !== "string") return b64;
  const raw = Buffer.from(b64, "base64");
  const dec = rc4(Buffer.from(key, "utf8"), raw);
  let s = zlib.inflateSync(dec).toString("utf8");
  const idx = s.indexOf("\r\n\r\n");
  if (idx > -1) s = s.substring(idx);
  return JSON.parse(s);
}

module.exports = { encrypt, decrypt, rc4, DEFAULT_KEY };
