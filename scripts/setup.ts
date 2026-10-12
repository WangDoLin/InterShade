#!/usr/bin/env node
import process from 'node:process';
import { runSetupWizard } from '../cli/commands/setupCommand.js';

runSetupWizard().catch((err: any) => {
  console.error(`Setup error: ${err.message}`);
  process.exit(1);
});
