const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const {
  answerWithLlm,
  answerWithoutLlm,
  getConfig,
  getServiceSourceLabel,
  loadServices,
} = require("./lib/meadow-vet");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);

const STATIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/api/services" && req.method === "GET") {
    return handleServices(res);
  }

  if (requestUrl.pathname === "/api/chat" && req.method === "POST") {
    return handleChat(req, res);
  }

  return serveStatic(requestUrl.pathname, res);
});

server.listen(PORT, () => {
  console.log(`Meadow Vet Care app running on http://localhost:${PORT}`);
});

async function handleServices(res) {
  try {
    const services = await loadServices();
    return sendJson(res, 200, { services, source: getServiceSourceLabel() });
  } catch (error) {
    return sendJson(res, 500, { error: "Could not load services.", detail: error.message });
  }
}

async function handleChat(req, res) {
  try {
    const body = await readJsonBody(req);
    const message = String(body.message || "").trim();

    if (!message) {
      return sendJson(res, 400, { error: "A message is required." });
    }

    const services = await loadServices();

    if (!getConfig().openAiApiKey) {
      const fallbackReply = answerWithoutLlm(message, services);
      return sendJson(res, 200, {
        reply: `${fallbackReply}\n\nNote: add OPENAI_API_KEY in .env to switch this to natural-language LLM responses.`,
        mode: "fallback",
      });
    }

    const reply = await answerWithLlm(message, services);
    return sendJson(res, 200, { reply, mode: "llm" });
  } catch (error) {
    return sendJson(res, 500, { error: "Could not generate reply.", detail: error.message });
  }
}


function serveStatic(requestPath, res) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(STATIC_DIR, safePath));

  if (!filePath.startsWith(STATIC_DIR)) {
    return sendText(res, 403, "Forbidden");
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      return sendText(res, 404, "Not found");
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
    res.end(data);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
