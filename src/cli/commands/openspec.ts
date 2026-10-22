import { Command } from 'commander';
import { registerValidateCommand } from './validate.js';

export function registerOpenspecCommand(program: Command): void {
  const openspec = program
    .command('openspec')
    .description('OpenSpec helpers');

  registerValidateCommand(openspec);

  openspec.action(() => {
    openspec.outputHelp();
  });
}
