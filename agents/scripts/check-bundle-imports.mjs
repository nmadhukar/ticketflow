#!/usr/bin/env node
/**
 * Fails the image build when the bundled server imports a name that the
 * installed @mastra packages do not export.
 *
 * Taken unchanged from Workforce Nexus. `mastra build` bundles @mastra/server
 * into the output and installs the runtime packages beside it. On 2026-10-28 a
 * Workforce Nexus sidecar was built with @mastra/server 1.80.0 code (published a
 * minute earlier) beside the pinned @mastra/core 1.79.0, and crashed on start:
 *   The requested module '@mastra/core/error' does not provide an export
 *   named 'toPersistedErrorIdentity'
 * The build itself succeeded, so it was deployed. Run in the production image,
 * this turns that crash into a failed build, and the running sidecar stays up.
 * (Here package.json also pins @mastra/server and @mastra/deployer.)
 *
 *   node check-bundle-imports.mjs /app
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const outputDir = resolve(process.argv[2] ?? '.mastra/output');

// `import { a, b as c } from '@mastra/x'`; type-only imports are gone after bundling.
const NAMED_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*['"](@mastra\/[^'"]+)['"]/gm;
// `export { a } from '@mastra/x'`: a re-export fails at load just like an import.
const NAMED_REEXPORT = /^export\s*\{([^}]*)\}\s*from\s*['"](@mastra\/[^'"]+)['"]/gm;
// `import * as coreStorage from '@mastra/core/storage'`: the members used, as `coreStorage.x`.
const NAMESPACE_IMPORT = /^import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"](@mastra\/[^'"]+)['"]/gm;

/*
 * Where the bundler puts module statements: every import at the top of a
 * chunk, every re-export at the bottom. Read only there, because the bundle
 * also carries Mastra's docs as template strings, with example code such as
 * "import { PinoLogger } from '@mastra/loggers'" for a package never installed
 * (found 2026-10-29; counting backticks to skip them proved unreliable).
 * Blank lines and comments may sit between statements.
 */
const BETWEEN_STATEMENTS = /^\s*($|\/\/|\/\*|\*)/;

function headerOf(lines) {
  const head = [];
  for (const line of lines) {
    if (/^import\b/.test(line)) head.push(line);
    else if (!BETWEEN_STATEMENTS.test(line)) break;
  }
  return head.join('\n');
}

function footerOf(lines) {
  const foot = [];
  for (const line of [...lines].reverse()) {
    if (/^export\b/.test(line)) foot.push(line);
    else if (!BETWEEN_STATEMENTS.test(line)) break;
  }
  return foot.join('\n');
}

const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wanted = new Map(); // specifier -> Set of names
const want = (specifier, name) => {
  const set = wanted.get(specifier) ?? new Set();
  if (name && name !== 'default') set.add(name);
  wanted.set(specifier, set);
};

for (const file of readdirSync(outputDir).filter((name) => name.endsWith('.mjs'))) {
  const source = readFileSync(join(outputDir, file), 'utf8');
  const lines = source.split(/\r?\n/);
  const header = headerOf(lines);
  for (const [pattern, text] of [[NAMED_IMPORT, header], [NAMED_REEXPORT, footerOf(lines)]]) {
    for (const [, names, specifier] of text.matchAll(pattern)) {
      want(specifier);
      for (const part of names.split(',')) want(specifier, part.trim().split(/\s+as\s+/)[0]?.trim());
    }
  }
  /*
   * A namespace import loads even when a member is gone, and fails only when
   * the member is called, so the members this file reads are checked too.
   */
  for (const [, alias, specifier] of header.matchAll(NAMESPACE_IMPORT)) {
    want(specifier);
    const member = new RegExp(`(?<![\\w$.])${escapeForRegExp(alias)}\\.([A-Za-z_$][\\w$]*)`, 'g');
    for (const [, name] of source.matchAll(member)) want(specifier, name);
  }
}

if (wanted.size === 0) {
  console.error(`check-bundle-imports: no @mastra imports found in ${outputDir}; is this the build output?`);
  process.exit(1);
}

/*
 * Resolved from inside the output directory, so the check sees exactly the
 * packages the running server will load.
 */
const probe = join(outputDir, `.check-bundle-imports-${process.pid}.mjs`);
writeFileSync(
  probe,
  `const wanted = ${JSON.stringify([...wanted].map(([specifier, names]) => [specifier, [...names]]))};
const missing = [];
for (const [specifier, names] of wanted) {
  let mod;
  try { mod = await import(specifier); } catch (error) { missing.push(specifier + ' (cannot load: ' + error.message + ')'); continue; }
  for (const name of names) if (!(name in mod)) missing.push(specifier + ' has no export ' + name);
}
if (missing.length) { console.error(missing.join('\\n')); process.exit(1); }
console.log('check-bundle-imports: ' + wanted.length + ' @mastra modules, every imported name present');
`,
);

let result;
try {
  result = spawnSync(process.execPath, [probe], { cwd: outputDir, stdio: 'inherit' });
} finally {
  rmSync(probe, { force: true });
}
if (result.status !== 0) {
  console.error(
    'check-bundle-imports: the bundled server and the installed @mastra packages disagree. ' +
      'Refusing to ship an image that would crash on start.',
  );
  process.exit(1);
}
