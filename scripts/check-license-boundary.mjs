// Keeps MIT packages from importing AGPL code.
//
// The AGPL paths are packages/cloudflare and bridge/. The MIT packages are
// packages/core, packages/react-email, packages/resend, packages/test-readers
// and every directory matching packages/auth-*. The check fails when a file under an MIT
// package's src/ imports (static, type-only, re-export, dynamic or require)
// @rafters/mail-cloudflare, a subpath of it, or a relative path into an AGPL
// path. It also fails when an MIT package lists @rafters/mail-cloudflare in
// dependencies, peerDependencies or optionalDependencies.
//
// Usage: node scripts/check-license-boundary.mjs [root]
// Exits 1 and names each violation, or 0 when the boundary holds.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_PACKAGE = "@rafters/mail-cloudflare";
const AGPL_DIRS = ["packages/cloudflare", "bridge"];
const MIT_PACKAGES = ["core", "react-email", "resend", "test-readers"];
const MANIFEST_DEP_KEYS = ["dependencies", "peerDependencies", "optionalDependencies"];
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

// Each pattern captures the module specifier in group 1.
const SPECIFIER_PATTERNS = [
  /(?:^|[^\w$.])(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
  /(?:^|[^\w$.])import\s*['"]([^'"\n]+)['"]/g,
  /(?:^|[^\w$.])(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

function isMissing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function subdirectories(dir) {
  try {
    return readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function sourceFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (SOURCE_FILE.test(name)) files.push(path);
  }
  return files;
}

function sourceFilesUnder(dir) {
  try {
    return sourceFiles(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function importsIn(text) {
  const found = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      found.push({ specifier: match[1], offset: match.index + match[0].lastIndexOf(match[1]) });
    }
  }
  return found;
}

function lineOf(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function isForbiddenSpecifier(specifier, fromFile, root) {
  if (specifier === FORBIDDEN_PACKAGE || specifier.startsWith(`${FORBIDDEN_PACKAGE}/`)) return true;
  if (!specifier.startsWith(".")) return false;
  const target = resolve(dirname(fromFile), specifier);
  return AGPL_DIRS.some((dir) => {
    const agpl = resolve(root, dir);
    return target === agpl || target.startsWith(agpl + sep);
  });
}

function manifestViolations(root, pkgDir) {
  const manifestPath = join(pkgDir, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const violations = [];
  for (const key of MANIFEST_DEP_KEYS) {
    const deps = manifest[key] ?? {};
    if (Object.hasOwn(deps, FORBIDDEN_PACKAGE)) {
      violations.push(`${relative(root, manifestPath)}: ${key} names "${FORBIDDEN_PACKAGE}"`);
    }
  }
  return violations;
}

function checkLicenseBoundary(root) {
  const violations = [];
  let files = 0;
  let packages = 0;

  const mitPackages = subdirectories(join(root, "packages")).filter(
    (name) => MIT_PACKAGES.includes(name) || name.startsWith("auth-"),
  );
  for (const name of mitPackages) {
    const pkgDir = join(root, "packages", name);
    packages += 1;
    violations.push(...manifestViolations(root, pkgDir));

    for (const file of sourceFilesUnder(join(pkgDir, "src"))) {
      files += 1;
      const text = readFileSync(file, "utf8");
      for (const { specifier, offset } of importsIn(text)) {
        if (isForbiddenSpecifier(specifier, file, root)) {
          violations.push(
            `${relative(root, file)}:${lineOf(text, offset)}: imports "${specifier}"`,
          );
        }
      }
    }
  }

  return { violations, files, packages };
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  const { violations, files, packages } = checkLicenseBoundary(root);
  if (violations.length > 0) {
    for (const violation of violations) console.error(violation);
    console.error(`license boundary: ${violations.length} violation(s)`);
    process.exit(1);
  }
  console.log(`license boundary: ok (${packages} MIT packages, ${files} source files)`);
}
