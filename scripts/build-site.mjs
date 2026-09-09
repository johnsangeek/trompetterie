import { mkdir, readdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
const client = join(dist, "client");
const server = join(dist, "server");
const metadata = join(dist, ".openai");
const includedExtensions = new Set([".html", ".css", ".js", ".json", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".ico", ".glb", ".mp3", ".txt", ".ttf"]);

await rm(dist, { recursive: true, force: true });
await mkdir(client, { recursive: true });
await mkdir(server, { recursive: true });
await mkdir(metadata, { recursive: true });

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["dist", ".git", ".openai", "scripts", "trumpet-user"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (includedExtensions.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

const paths = await collect(root);
const assets = {};
for (const source of paths) {
  const name = relative(root, source).split(sep).join("/");
  const target = join(client, name);
  await mkdir(join(client, name.split("/").slice(0, -1).join("/")), { recursive: true });
  await copyFile(source, target);
  assets[`/${name}`] = (await readFile(source)).toString("base64");
}

const worker = `const ASSETS = ${JSON.stringify(assets)};
const TYPES = {html:"text/html; charset=utf-8",css:"text/css; charset=utf-8",js:"text/javascript; charset=utf-8",json:"application/json; charset=utf-8",txt:"text/plain; charset=utf-8",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",svg:"image/svg+xml",webp:"image/webp",ico:"image/x-icon",glb:"model/gltf-binary",mp3:"audio/mpeg",ttf:"font/ttf"};
function decode(value){const raw=atob(value);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;}
export default {async fetch(request){const url=new URL(request.url);let path=decodeURIComponent(url.pathname);if(path==="/")path="/hero.html";if(!ASSETS[path]&&!path.includes("."))path="/hero.html";const asset=ASSETS[path];if(!asset)return new Response("Not found",{status:404});const ext=path.split(".").pop().toLowerCase();return new Response(request.method==="HEAD"?null:decode(asset),{headers:{"content-type":TYPES[ext]||"application/octet-stream","cache-control":ext==="html"?"no-cache":"public, max-age=3600"}});}};
`;

await writeFile(join(server, "index.js"), worker);
await copyFile(join(root, ".openai", "hosting.json"), join(metadata, "hosting.json"));
