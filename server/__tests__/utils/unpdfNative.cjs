// Jest maps `unpdf` here (jest.config.mjs, moduleNameMapper). unpdf loads its PDF.js build with a
// dynamic import() of an ES module, which Jest's CommonJS module registry cannot run (it needs
// --experimental-vm-modules). Loading unpdf through Node's own require, outside the registry
// (process.getBuiltinModule is not intercepted by Jest, unlike require("module")), lets that
// import() run natively: the tests still parse real PDFs with the real library. Production
// (esbuild, ESM, packages external) imports unpdf directly and never sees this file.
const nodeRequire = process.getBuiltinModule("node:module").createRequire(__filename);

module.exports = nodeRequire("unpdf");
