import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";

/** Runtime dependency directions from ARCH.md; test-only service integration is deliberately excluded. */
const modules = [
  { name: "shared", path: "packages/shared", allows: [] },
  { name: "render", path: "packages/render", allows: ["shared"] },
  { name: "ui", path: "packages/ui", allows: [] },
  { name: "server-kit", path: "packages/server-kit", allows: ["shared"] },
  { name: "storage", path: "services/storage", allows: ["server-kit", "shared"] },
  { name: "api", path: "services/api", allows: ["server-kit", "shared"] },
  { name: "search", path: "services/search", allows: ["server-kit", "shared"] },
  { name: "web", path: "apps/web", allows: ["ui", "render", "shared"] },
];
const root = resolve(import.meta.dirname, "..");
const browserModules = new Set(["shared", "render", "ui", "web"]);
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const violations: string[] = [];
let checked = 0;

function within(file: string, directory: string): boolean {
  return file === directory || file.startsWith(directory + sep);
}

async function* sources(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.[cm]?tsx?$/.test(entry.name) && !/\.test\.[cm]?tsx?$/.test(entry.name)) yield path;
  }
}

for (const owner of modules) {
  for await (const file of sources(resolve(root, owner.path, "src"))) {
    checked++;
    const source = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
    function check(specifier: ts.StringLiteralLike): void {
      const name = specifier.text;
      const location = source.getLineAndCharacterOfPosition(specifier.getStart(source));
      function reject(reason: string): void {
        violations.push(`${relative(root, file)}:${location.line + 1}: ${reason} (${name})`);
      }
      if (browserModules.has(owner.name) && (name.startsWith("node:") || builtins.has(name))) {
        reject(`${owner.name} must remain browser-compatible`);
      }
      const targetPath = name.startsWith(".") ? resolve(dirname(file), name) : null;
      const target = name.startsWith("@memegen/")
        ? modules.find((candidate) => name === `@memegen/${candidate.name}` || name.startsWith(`@memegen/${candidate.name}/`))
        : targetPath ? modules.find((candidate) => within(targetPath, resolve(root, candidate.path))) : undefined;
      if (name.startsWith("@memegen/") && !target) reject("unknown workspace dependency");
      if (target && target.name !== owner.name) {
        if (!owner.allows.includes(target.name)) reject(`${owner.name} must not depend on ${target.name}`);
        else if (targetPath) reject("cross-workspace imports must use the package's public exports");
      }
      if (targetPath && !target) reject("runtime code must not import tooling or files outside its workspace");
      const pages = resolve(root, "apps/web/src/pages");
      if (owner.name === "web" && targetPath && within(file, pages) && within(targetPath, pages)) {
        reject("pages must compose components, not import other pages");
      }
    }
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        check(node.moduleSpecifier);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
        check(node.argument.literal);
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) check(argument);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Import boundaries passed (${checked} runtime source files).`);
}
