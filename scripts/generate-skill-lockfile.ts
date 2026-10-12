import process from 'node:process';
import { SkillRegistry } from '../services/skills/SkillRegistry.js';
import { SkillLockfile } from '../services/skills/SkillLockfile.js';
import { SkillAllowlist } from '../services/skills/SkillAllowlist.js';

const rootDir = process.cwd();
const registry = new SkillRegistry(rootDir, rootDir);
const skills = registry.discoverAllSkills();
console.log(`Discovered ${skills.length} skills in catalog`);

const lockData = SkillLockfile.generateLockfile(skills);
SkillLockfile.writeLockfile(rootDir, lockData);
console.log(`Successfully generated ${SkillLockfile.DEFAULT_FILENAME} with ${Object.keys(lockData.skills).length} entries`);

const allowData = SkillAllowlist.generateAllowlistFromSkills(skills);
SkillAllowlist.writeAllowlist(rootDir, allowData);
console.log(`Successfully generated ${SkillAllowlist.DEFAULT_FILENAME} with ${Object.keys(allowData.allowedSkills).length} entries`);
