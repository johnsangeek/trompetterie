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
function json(data,status){return new Response(JSON.stringify(data),{status:status||200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
async function hooktheoryTrends(url,env){const cp=url.searchParams.get("cp")||"";if(!cp||cp.length>120||!/^[A-Za-z0-9,/#]+$/.test(cp))return json({error:"Progression invalide"},400);if(!env.HOOKTHEORY_ACTIVKEY)return json({error:"Service harmonique indisponible"},503);const response=await fetch("https://api.hooktheory.com/v1/trends/nodes?cp="+encodeURIComponent(cp),{headers:{Authorization:"Bearer "+env.HOOKTHEORY_ACTIVKEY,Accept:"application/json"}});return new Response(response.body,{status:response.status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=300"}});}
export default {async fetch(request,env){const url=new URL(request.url);if(url.pathname==="/api/hooktheory/trends")return hooktheoryTrends(url,env);let path=decodeURIComponent(url.pathname);if(path==="/")path="/index.html";if(!ASSETS[path]&&!path.includes("."))path="/index.html";const asset=ASSETS[path];if(!asset)return new Response("Not found",{status:404});const ext=path.split(".").pop().toLowerCase();return new Response(request.method==="HEAD"?null:decode(asset),{headers:{"content-type":TYPES[ext]||"application/octet-stream","cache-control":ext==="html"?"no-cache":"public, max-age=3600"}});}};
`;

await writeFile(join(server, "index.js"), worker);
await copyFile(join(root, ".openai", "hosting.json"), join(metadata, "hosting.json"));
