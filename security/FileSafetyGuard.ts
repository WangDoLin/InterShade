import path from 'node:path';

export interface SafetyCheckResult {
  allowed: boolean;
  resolvedPath: string;
  reason?: string;
}

export class FileSafetyGuard {
  private static readonly FORBIDDEN_DIRS = [
    '.git',
    'node_modules',
    '.intershade/state',
    'C:\\Windows',
    '/etc',
    '/usr',
    '/root'
  ];

  /**
   * Validates if a target path is safe to read or write within the working directory.
   */
  static validatePath(targetPath: string, cwd: string = process.cwd(), isWrite: boolean = false): SafetyCheckResult {
    const resolvedPath = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(cwd, targetPath);

    const resolvedCwd = path.resolve(cwd);
    const rel = path.relative(resolvedCwd, resolvedPath);

    // Prevent escaping workspace root via directory traversal
    if (rel.startsWith('..') && !path.isAbsolute(targetPath)) {
      return {
        allowed: false,
        resolvedPath,
        reason: `[SECURITY GUARD]: Path "${targetPath}" attempts to traverse outside workspace root "${resolvedCwd}".`
      };
    }

    // Check forbidden directories for destructive writes
    if (isWrite) {
      for (const forbidden of this.FORBIDDEN_DIRS) {
        if (resolvedPath.toLowerCase().includes(forbidden.toLowerCase())) {
          return {
            allowed: false,
            resolvedPath,
            reason: `[SECURITY GUARD]: Modifications to forbidden system/vcs path "${forbidden}" are prohibited.`
          };
        }
      }
    }

    return {
      allowed: true,
      resolvedPath
    };
  }
}
