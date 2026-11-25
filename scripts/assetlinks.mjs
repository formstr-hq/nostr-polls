#!/usr/bin/env node
// Generate or verify the Digital Asset Links file that makes Android open
// https://pollerama.fun links in the installed app.
//
// The fingerprint in public/.well-known/assetlinks.json must match the
// certificate that signs the release APK. The release pipeline runs `verify`
// against the signed APK and fails before publishing if they diverge.
//
// Usage:
//   node scripts/assetlinks.mjs verify --apk android/app/build/outputs/apk/release/app-release.apk
//   node scripts/assetlinks.mjs generate --apk <signed.apk>
//   node scripts/assetlinks.mjs generate --keystore android/release-key.jks
//   node scripts/assetlinks.mjs generate --fingerprint AA:BB:...
//
// Keystore mode reads ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS (or
// --storepass / --alias). You can also pass one or more fingerprints in
// ANDROID_APP_LINKS_SHA256 (comma or space separated).

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FILE = join(ROOT, "public", ".well-known", "assetlinks.json");
const RELATION = "delegate_permission/common.handle_all_urls";
const FINGERPRINT_RE = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;

function fail(message) {
  console.error(`assetlinks: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`assetlinks: ${message}`);
}

function usage() {
  console.error(
    [
      "usage: node scripts/assetlinks.mjs <generate|verify> [options]",
      "",
      "  --apk <path>              read the signer certificate from a signed APK",
      "  --keystore <path>         read the certificate from a keystore (keytool)",
      "  --alias <name>            keystore alias (default: ANDROID_KEY_ALIAS)",
      "  --storepass <password>    keystore password (default: ANDROID_KEYSTORE_PASSWORD)",
      "  --fingerprint <sha256>    add a SHA-256 certificate fingerprint (repeatable)",
      "  --file <path>             assetlinks.json (default: public/.well-known/assetlinks.json)",
      "",
      "Fingerprints may also come from ANDROID_APP_LINKS_SHA256.",
    ].join("\n")
  );
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "generate" && command !== "verify") usage();

  const options = {
    command,
    file: DEFAULT_FILE,
    apk: "",
    keystore: "",
    alias: process.env.ANDROID_KEY_ALIAS || "",
    storepass: process.env.ANDROID_KEYSTORE_PASSWORD || "",
    fingerprints: [],
  };

  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    switch (flag) {
      case "--apk":
      case "--keystore":
      case "--alias":
      case "--storepass":
      case "--fingerprint":
      case "--file":
        if (!value) fail(`${flag} needs a value`);
        index += 1;
        break;
      default:
        fail(`unknown option: ${flag}`);
    }

    if (flag === "--fingerprint") options.fingerprints.push(value);
    else options[flag.slice(2)] = value;
  }

  const fromEnv = (process.env.ANDROID_APP_LINKS_SHA256 || "")
    .split(/[\s,]+/)
    .filter(Boolean);
  options.fingerprints.push(...fromEnv);
  return options;
}

function normalizeFingerprint(value) {
  const hex = String(value)
    .trim()
    .replace(/^sha-?256:?/i, "")
    .replace(/[^0-9a-f]/gi, "")
    .toUpperCase();
  if (hex.length !== 64) {
    fail(`not a SHA-256 fingerprint: ${value}`);
  }
  return hex.match(/.{2}/g).join(":");
}

function appId() {
  if (process.env.APP_LINK_PACKAGE) return process.env.APP_LINK_PACKAGE;
  try {
    const config = readFileSync(join(ROOT, "capacitor.config.ts"), "utf8");
    const match = config.match(/appId\s*:\s*['"]([^'"]+)['"]/);
    if (match) return match[1];
  } catch {
    // fall through to the project default
  }
  return "com.formstr.pollerama";
}

function sdkRoot() {
  const fromEnv =
    process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
  if (fromEnv) return fromEnv;

  const localProperties = join(ROOT, "android", "local.properties");
  if (existsSync(localProperties)) {
    const match = readFileSync(localProperties, "utf8").match(/^sdk\.dir=(.+)$/m);
    if (match) return match[1].trim();
  }
  return "";
}

function apksignerPath() {
  const sdk = sdkRoot();
  if (sdk) {
    const buildTools = join(sdk, "build-tools");
    if (existsSync(buildTools)) {
      const versions = readdirSync(buildTools).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      );
      for (const version of versions.reverse()) {
        const candidate = join(buildTools, version, "apksigner");
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return "apksigner";
}

function fingerprintsFromApk(apk) {
  if (!existsSync(apk)) fail(`APK not found: ${apk}`);
  let output;
  try {
    output = execFileSync(apksignerPath(), ["verify", "--print-certs", apk], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    fail(
      `could not read the APK certificate (is apksigner installed?): ${
        error.stderr || error.message
      }`
    );
  }
  const fingerprints = [
    ...output.matchAll(/certificate SHA-256 digest:\s*([0-9a-f:]+)/gi),
  ].map((match) => normalizeFingerprint(match[1]));
  if (fingerprints.length === 0) {
    fail(`apksigner found no signer certificate in ${apk}`);
  }
  return fingerprints;
}

function fingerprintsFromKeystore(keystore, alias, storepass) {
  if (!existsSync(keystore)) fail(`keystore not found: ${keystore}`);
  if (!storepass) {
    fail(
      "keystore mode needs ANDROID_KEYSTORE_PASSWORD or --storepass (keytool would prompt)"
    );
  }

  const args = ["-list", "-v", "-keystore", keystore, "-storepass", storepass];
  if (alias) args.push("-alias", alias);

  let output;
  try {
    output = execFileSync("keytool", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    fail(`keytool failed: ${error.stderr || error.message}`);
  }

  const fingerprints = [
    ...output.matchAll(/SHA256:\s*([0-9A-F:]+)/gi),
  ].map((match) => normalizeFingerprint(match[1]));
  if (fingerprints.length === 0) {
    fail(`no certificate found in ${keystore}${alias ? ` for alias ${alias}` : ""}`);
  }
  return fingerprints;
}

function collectFingerprints(options) {
  const fingerprints = new Set(options.fingerprints.map(normalizeFingerprint));

  if (options.apk) {
    for (const fingerprint of fingerprintsFromApk(options.apk)) {
      fingerprints.add(fingerprint);
    }
  }
  if (options.keystore) {
    for (const fingerprint of fingerprintsFromKeystore(
      options.keystore,
      options.alias,
      options.storepass
    )) {
      fingerprints.add(fingerprint);
    }
  }

  if (fingerprints.size === 0) {
    fail(
      "no certificate source: pass --apk, --keystore or --fingerprint (or set ANDROID_APP_LINKS_SHA256)"
    );
  }
  return [...fingerprints].sort();
}

function readFileTargets(file) {
  if (!existsSync(file)) fail(`assetlinks file not found: ${file}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed)) fail(`${file} must be a JSON array`);
  return parsed;
}

function targetFor(targets, packageName) {
  return targets.find(
    (entry) =>
      entry &&
      entry.target &&
      entry.target.namespace === "android_app" &&
      entry.target.package_name === packageName
  );
}

function verify(options) {
  const packageName = appId();
  const expected = collectFingerprints(options);
  const targets = readFileTargets(options.file);
  const target = targetFor(targets, packageName);
  if (!target) {
    fail(
      `${options.file} has no android_app target for ${packageName}; links will open in the browser`
    );
  }

  const listed = new Set(
    (target.target.sha256_cert_fingerprints || []).map(normalizeFingerprint)
  );
  const missing = expected.filter((fingerprint) => !listed.has(fingerprint));
  if (missing.length > 0) {
    fail(
      `${options.file} is missing the release certificate for ${packageName}:\n` +
        missing.map((fingerprint) => `  ${fingerprint}`).join("\n") +
        "\nRun: node scripts/assetlinks.mjs generate --apk <signed.apk>"
    );
  }

  log(`OK: ${packageName} certificate is published in ${options.file}`);
}

function generate(options) {
  const packageName = appId();
  const fingerprints = collectFingerprints(options);
  const file = resolve(options.file);
  const payload = [
    {
      relation: [RELATION],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  log(`wrote ${fingerprints.length} fingerprint(s) for ${packageName} to ${file}`);
}

const options = parseArgs(process.argv.slice(2));
if (options.command === "generate") generate(options);
else verify(options);
