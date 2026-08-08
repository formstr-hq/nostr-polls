const fs = require("fs");
const path = require("path");

// @wllama/wllama is a direct dependency so its runtime can be served locally.
const possibleSrc = [
  path.resolve(
    __dirname,
    "../node_modules/@wllama/wllama/esm/wasm/wllama.wasm",
  ),
];

const dest = path.resolve(__dirname, "../public/wllama/wllama.wasm");
const src = possibleSrc.find((candidate) => fs.existsSync(candidate));

if (!src) {
  console.error("✗ wllama.wasm not found. Install dependencies before starting or building.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log("✓ Copied wllama.wasm to public/wllama/");
