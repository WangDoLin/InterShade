import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { runSetupWizard } from '../cli/commands/setupCommand.js';

console.log('[TEST]: Starting Installation Contract & Setup Diagnostics Test Suite...');

// 1. Verify package.json bin mappings
const pkgPath = path.resolve(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

assert.ok(pkg.bin, 'package.json must contain bin field');
assert.strictEqual(pkg.bin.intershader, './dist/index.js', 'bin.intershader must point to ./dist/index.js');
assert.strictEqual(pkg.bin.intershade, './dist/index.js', 'bin.intershade must point to ./dist/index.js');
assert.ok(pkg.scripts.setup, 'package.json must contain setup npm script');
console.log('[PASS]: 1.1 - package.json registers both binary aliases: intershader and intershade');

// 2. Verify existence of installer scripts and documentation
const ps1Script = path.resolve(process.cwd(), 'scripts', 'install.ps1');
const shScript = path.resolve(process.cwd(), 'scripts', 'install.sh');
const setupScript = path.resolve(process.cwd(), 'scripts', 'setup.ts');
const installMd = path.resolve(process.cwd(), 'INSTALL.md');

assert.ok(fs.existsSync(ps1Script), 'scripts/install.ps1 must exist');
assert.ok(fs.existsSync(shScript), 'scripts/install.sh must exist');
assert.ok(fs.existsSync(setupScript), 'scripts/setup.ts must exist');
assert.ok(fs.existsSync(installMd), 'INSTALL.md must exist');

const ps1Content = fs.readFileSync(ps1Script, 'utf-8');
const shContent = fs.readFileSync(shScript, 'utf-8');
const installMdContent = fs.readFileSync(installMd, 'utf-8');

assert.ok(ps1Content.includes('node -v'), 'install.ps1 must check Node.js version');
assert.ok(ps1Content.includes('npm run build'), 'install.ps1 must compile bundle');
assert.ok(ps1Content.includes('npm link'), 'install.ps1 must support npm link');

assert.ok(shContent.includes('command -v node'), 'install.sh must check Node.js');
assert.ok(shContent.includes('npm run build'), 'install.sh must compile bundle');

assert.ok(installMdContent.includes('install.ps1'), 'INSTALL.md must document Windows installation');
assert.ok(installMdContent.includes('install.sh'), 'INSTALL.md must document Linux/macOS installation');
console.log('[PASS]: 2.1 - Installer scripts for Windows (ps1) and Linux/macOS (sh) satisfy requirements');

// 3. Verify execution of runSetupWizard
const setupResult = await runSetupWizard();
assert.strictEqual(setupResult.success, true, 'runSetupWizard must return success: true');
console.log('[PASS]: 3.1 - Onboarding Setup Wizard executes successfully without errors');

console.log('[SUCCESS]: ALL INSTALLATION CONTRACT TESTS PASSED 100%!');
