import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { SchemaValidator } from '../engine/verification/SchemaValidator.js';

console.log('[TEST]: Starting Independent Schema Conformance Test Suite on Exported Disk Artifacts...');

const cwd = process.cwd();
const baseProofDir = path.join(cwd, '.intershader', 'proof');

assert.ok(fs.existsSync(baseProofDir), 'Proof directory must exist');
const runs = fs.readdirSync(baseProofDir).filter((e) => e.startsWith('run-')).sort();
assert.ok(runs.length > 0, 'At least one verification run must be available');

const latestRun = runs[runs.length - 1];
const exportsDir = path.join(baseProofDir, latestRun, 'exports');
assert.ok(fs.existsSync(exportsDir), `Exports directory must exist: ${exportsDir}`);

console.log(`Auditing target export directory: ${exportsDir}`);

// 1. in-toto Link Statement (link/v0.3)
const linkPath = path.join(exportsDir, 'intoto-statement.json');
assert.ok(fs.existsSync(linkPath), 'intoto-statement.json must exist');
const linkJson = JSON.parse(fs.readFileSync(linkPath, 'utf-8'));
const linkReport = SchemaValidator.validateInTotoLinkV03(linkJson);
assert.strictEqual(linkReport.valid, true, `Link statement failed schema: ${linkReport.errors.join(', ')}`);
console.log('[PASS]: in-toto Link v0.3 statement strictly conforms to official spec.');

// 2. in-toto Test Result Statement (test-result/v0.1)
const testResultPath = path.join(exportsDir, 'in-toto-test-result.json');
assert.ok(fs.existsSync(testResultPath), 'in-toto-test-result.json must exist');
const testResultJson = JSON.parse(fs.readFileSync(testResultPath, 'utf-8'));
const testResultReport = SchemaValidator.validateInTotoTestResultV01(testResultJson);
assert.strictEqual(testResultReport.valid, true, `Test result statement failed schema: ${testResultReport.errors.join(', ')}`);
console.log('[PASS]: in-toto Test Result v0.1 statement strictly conforms to official spec.');

// 3. SLSA Provenance v1.2 (Active Spec)
const slsaPath = path.join(exportsDir, 'slsa-provenance-v1.2.json');
assert.ok(fs.existsSync(slsaPath), 'slsa-provenance-v1.2.json must exist');
const slsaJson = JSON.parse(fs.readFileSync(slsaPath, 'utf-8'));
const slsaReport = SchemaValidator.validateSlsaProvenanceV1(slsaJson);
assert.strictEqual(slsaReport.valid, true, `SLSA provenance failed schema: ${slsaReport.errors.join(', ')}`);
console.log('[PASS]: SLSA Provenance v1.2 statement strictly conforms to official spec.');

// 4. Signed Export Bundle Index Schema
const indexPath = path.join(exportsDir, 'bundle-index.json');
assert.ok(fs.existsSync(indexPath), 'bundle-index.json must exist');
const indexJson = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
assert.strictEqual(indexJson._type, 'https://intershader.dev/bundle-index/v1');
assert.ok(typeof indexJson.runId === 'string' && indexJson.runId.length > 0);
assert.ok(typeof indexJson.issuedAt === 'string');
assert.ok(typeof indexJson.builderId === 'string');
assert.ok(typeof indexJson.oracleKeyId === 'string');
assert.ok(typeof indexJson.manifestHashSha256 === 'string' && /^[0-9a-f]{64}$/i.test(indexJson.manifestHashSha256));
assert.ok(typeof indexJson.bundleDigestSha256 === 'string' && /^[0-9a-f]{64}$/i.test(indexJson.bundleDigestSha256));
assert.ok(typeof indexJson.signatureHex === 'string' && indexJson.signatureHex.length > 60);
assert.ok(typeof indexJson.files === 'object' && Object.keys(indexJson.files).length >= 4);
console.log('[PASS]: Signed Export Index structure strictly conforms to InterShader specification.');

// 5. Full Bundle Disk-level Audit via SchemaValidator
const fullReport = SchemaValidator.validateBundleOnDisk(exportsDir);
assert.strictEqual(fullReport.valid, true, 'Full bundle validation on disk must be 100% valid');
console.log('[PASS]: Full export bundle directory audit on disk validated 100% clean.');

console.log('\n[SUCCESS]: ALL INDEPENDENT SCHEMA CONFORMANCE CHECKS PASSED 100%!');
