import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const demoRoot = path.join(repositoryRoot, "examples", "agent-before-after");
const port = Number(process.env.PORT ?? 4190);

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = resolveFile(pathname);
  if (!file || !(await exists(file))) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const metadata = await stat(file);
  if (!metadata.isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": mimeType(file), "cache-control": "no-store" });
  createReadStream(file).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Wubble UI Sounds agent demo: http://localhost:${port}/`);
});

function resolveFile(pathname) {
  if (pathname === "/") return path.join(demoRoot, "index.html");
  if (pathname.startsWith("/src/")) return resolveWithin(demoRoot, pathname);
  if (pathname.startsWith("/wubble/")) return resolveWithin(path.join(demoRoot, "public"), pathname);
  if (pathname.startsWith("/packages/")) return resolveWithin(repositoryRoot, pathname);
  return undefined;
}

function resolveWithin(root, pathname) {
  const target = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, target);
  return relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? target : undefined;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function mimeType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".mp3")) return "audio/mpeg";
  if (file.endsWith(".webm")) return "audio/webm";
  if (file.endsWith(".m4a")) return "audio/mp4";
  return "application/octet-stream";
}
