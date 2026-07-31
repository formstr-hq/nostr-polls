const fs = require("fs");
const path = require("path");

// wllama-service installs @wllama/wllama transitively.
const possibleSrc = [
  path.resolve(
    __dirname,
    "../node_modules/@wllama/wllama/esm/wasm/wllama.wasm",
  ),
];

const dest = path.resolve(__dirname, "../public/wllama/wllama.wasm");
const src = possibleSrc.find((candidate) => fs.existsSync(candidate));

if (!src) {
  console.warn("⚠ wllama.wasm not found. Run: yarn install");
  process.exit(0);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log("✓ Copied wllama.wasm to public/wllama/");
