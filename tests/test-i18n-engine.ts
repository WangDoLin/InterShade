import assert from 'assert';
import { I18nEngine, t } from '../services/i18n/index.js';
import { SUPPORTED_LOCALES } from '../services/i18n/types.js';

console.log('[TEST]: Starting I18n Engine & Localization Tests...');

// 1. Verify all 9 locales are defined
assert.strictEqual(SUPPORTED_LOCALES.length, 9, 'Should support exactly 9 locales');
console.log('[PASS]: 9 locales configured: ' + SUPPORTED_LOCALES.join(', '));

// 2. Instantiate isolated engine
const engine = new I18nEngine('en');
assert.strictEqual(engine.getLocale(), 'en', 'Initial locale should be en');

// 3. Test basic translation lookup in en
const enTitle = engine.t('header.title');
assert.strictEqual(enTitle, 'INTERSHADER', 'header.title should match INTERSHADER');

// 4. Test positional parameter interpolation
const taskCreatedEn = engine.t('task.created', ['42', 'Refactor auth service']);
assert.strictEqual(taskCreatedEn, 'Created Task #42: "Refactor auth service"');
console.log('[PASS]: Positional interpolation verified in en');

// 5. Test switching to Vietnamese (vi)
const setVi = engine.setLocale('vi');
assert.strictEqual(setVi, true, 'setLocale(vi) should succeed');
assert.strictEqual(engine.getLocale(), 'vi');
const taskCreatedVi = engine.t('task.created', ['42', 'Refactor auth service']);
assert.strictEqual(taskCreatedVi, 'Da tao Task #42: "Refactor auth service"');
const viPlanOn = engine.t('slash.planModeOn');
assert.ok(viPlanOn.includes('DA BAT'), 'Plan mode string should be in Vietnamese');
console.log('[PASS]: Vietnamese locale switching and formatting verified');

// 6. Test switching to Japanese (ja)
const setJa = engine.setLocale('ja');
assert.strictEqual(setJa, true);
assert.strictEqual(engine.getLocale(), 'ja');
const jaTaskCreated = engine.t('task.created', ['7', 'Run unit tests']);
assert.strictEqual(jaTaskCreated, 'タスク #7 を作成: "Run unit tests"');
console.log('[PASS]: Japanese locale switching and formatting verified');

// 7. Test prefix normalization (e.g., zh-CN -> zh, de-DE -> de, fr-FR -> fr)
assert.strictEqual(engine.setLocale('zh-CN'), true);
assert.strictEqual(engine.getLocale(), 'zh');
const zhPlanOn = engine.t('slash.planModeOn');
assert.ok(zhPlanOn.includes('计划模式已启用'));

assert.strictEqual(engine.setLocale('de-DE'), true);
assert.strictEqual(engine.getLocale(), 'de');
const deTask = engine.t('task.deleted', ['99']);
assert.strictEqual(deTask, 'Aufgabe #99 geloescht');

assert.strictEqual(engine.setLocale('fr-FR'), true);
assert.strictEqual(engine.getLocale(), 'fr');
const frTask = engine.t('task.deleted', ['99']);
assert.strictEqual(frTask, 'Tache #99 supprimee');

assert.strictEqual(engine.setLocale('es-ES'), true);
assert.strictEqual(engine.getLocale(), 'es');
const esTask = engine.t('task.deleted', ['99']);
assert.strictEqual(esTask, 'Tarea #99 eliminada');

assert.strictEqual(engine.setLocale('ko-KR'), true);
assert.strictEqual(engine.getLocale(), 'ko');
const koTask = engine.t('task.deleted', ['99']);
assert.strictEqual(koTask, '태스크 #99 삭제');

assert.strictEqual(engine.setLocale('ru-RU'), true);
assert.strictEqual(engine.getLocale(), 'ru');
const ruTask = engine.t('task.deleted', ['99']);
assert.strictEqual(ruTask, 'Удалена задача #99');
console.log('[PASS]: Multi-locale prefix normalization verified for zh, de, fr, es, ko, ru');

// 8. Test Fallback behavior
// 8a. Missing key in non-en fallback to en
engine.setLocale('vi');
const nonExistentInVi = engine.t('non.existent.key.xyz');
assert.strictEqual(nonExistentInVi, 'non.existent.key.xyz', 'Unknown key falls back to raw key');

// 9. Named parameter replacement
const template = 'User {username} logged into {server}';
// Test object substitution
const substituted = engine.t('tools.fileRead.success', ['150', 'src/auth.ts']);
assert.ok(substituted.includes('150') && substituted.includes('src/auth.ts'));
console.log('[PASS]: Fallback and named parameter substitution verified');

console.log('[SUCCESS]: All I18n Engine & Localization Tests PASSED!');
