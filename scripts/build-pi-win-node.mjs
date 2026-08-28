#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const piRoot = path.join(repoRoot, 'third_party', 'pi');
const codingAgentDir = path.join(piRoot, 'packages', 'coding-agent');
const codingAgentDistDir = path.join(codingAgentDir, 'dist');
const bundleDir = path.join(codingAgentDistDir, 'bundle');
const binDir = path.join(repoRoot, 'resources', 'bin');

/**
 * 本脚本为 Windows 构建一个不需要 AVX/Bun 的 Node 版 pi。
 * 产物：resources/bin/pi-win-node.cmd + bundle/ + 运行所需资源。
 * 当 Bun 编译的 pi-win.exe 在旧 CPU/无 AVX 虚拟机上 panic 时，Agent Studio 会自动回退到此 Node 版。
 */

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.cpSync(src, dest, { recursive: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { force: true });
}

function copyNodeModule(sourceNodeModules, destNodeModules, name) {
  const src = path.join(sourceNodeModules, name);
  const dest = path.join(destNodeModules, name);
  if (!fs.existsSync(src)) return;
  copyDir(src, dest);
}

function buildPiNodeBundle() {
  console.log('Building pi Node bundle (this may take a minute)...');
  ensureDir(piRoot);

  // 安装子模块依赖（如果还没有）
  if (!fs.existsSync(path.join(piRoot, 'node_modules'))) {
    console.log('Installing third_party/pi dependencies...');
    execSync('npm install --ignore-scripts', { cwd: piRoot, stdio: 'inherit' });
  }

  // 下载模型数据（很多功能依赖它）
  console.log('Hydrating model data...');
  execSync('npm run hydrate:model-data', { cwd: piRoot, stdio: 'inherit' });

  // 构建所有工作区包，生成 Node bundle
  console.log('Building workspace packages...');
  execSync('npm run build', { cwd: piRoot, stdio: 'inherit' });
}

function ensureBundle() {
  if (!fs.existsSync(path.join(bundleDir, 'cli.js'))) {
    buildPiNodeBundle();
  }
  if (!fs.existsSync(path.join(bundleDir, 'cli.js'))) {
    throw new Error(`Bundle not found after build: ${path.join(bundleDir, 'cli.js')}`);
  }
}

function stageAssets() {
  ensureDir(binDir);

  // 1. bundle 目录（入口和 chunks）
  copyDir(bundleDir, path.join(binDir, 'bundle'));

  // 2. 运行时资源
  copyDir(path.join(codingAgentDistDir, 'theme'), path.join(binDir, 'theme'));
  copyDir(path.join(codingAgentDistDir, 'assets'), path.join(binDir, 'assets'));
  copyDir(path.join(codingAgentDistDir, 'export-html'), path.join(binDir, 'export-html'));

  // 3. 文档/示例（可选，保持与 Bun 编译产物一致）
  copyDir(path.join(codingAgentDir, 'docs'), path.join(binDir, 'docs'));
  copyDir(path.join(codingAgentDir, 'examples'), path.join(binDir, 'examples'));

  // 4. WASM
  copyFile(path.join(codingAgentDistDir, 'photon_rs_bg.wasm'), path.join(binDir, 'photon_rs_bg.wasm'));
  // 不覆盖 resources/bin/README.md（它是受跟踪的说明文件），也不复制 package.json/CHANGELOG

  // 5. 把运行时仍需要从 node_modules resolve 的包复制到 bin 目录
  const sourceNodeModules = path.join(piRoot, 'node_modules');
  const destNodeModules = path.join(binDir, 'node_modules');
  if (fs.existsSync(sourceNodeModules)) {
    ensureDir(destNodeModules);

    // jiti：按需 TypeScript 编译，jiti 自身已经 bundle 了依赖
    copyNodeModule(sourceNodeModules, destNodeModules, 'jiti');

    // photon-node：图片处理 WASM，bundle 会动态 import 它
    copyNodeModule(sourceNodeModules, destNodeModules, '@silvia-odwyer/photon-node');

    // 可选原生加速器与 clipboard
    for (const mod of ['bufferutil', 'utf-8-validate', 'supports-color', '@mariozechner']) {
      copyNodeModule(sourceNodeModules, destNodeModules, mod);
    }
  }
}

function createCmdWrapper() {
  const cmdPath = path.join(binDir, 'pi-win-node.cmd');
  // 包装器把当前目录切到 resources/bin，然后让 Node 跑 bundle/cli.js
  // 这样 bundle 的 createRequire 就能找到 resources/bin/node_modules 里的外部包
  const wrapper = `@echo off\nsetlocal\ncd /d "%~dp0"\nnode "bundle\\cli.js" %*\n`;
  fs.writeFileSync(cmdPath, wrapper, { encoding: 'utf8' });
  console.log(`Created ${cmdPath}`);
}

function main() {
  ensureBundle();
  stageAssets();
  createCmdWrapper();
  console.log('Done. Node-based pi for Windows is ready at resources/bin/pi-win-node.cmd');
  console.log('You can run: .\\resources\\bin\\pi-win-node.cmd --version');
}

main();
