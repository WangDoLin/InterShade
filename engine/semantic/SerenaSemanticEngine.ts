import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';

export interface SerenaSymbol {
  name: string;
  kind: 'class' | 'interface' | 'type' | 'function' | 'method' | 'enum' | 'variable' | 'property';
  file: string;
  startLine: number;
  endLine: number;
  character: number;
  isExported: boolean;
  signature?: string;
}

export interface SerenaLocation {
  file: string;
  line: number;
  character: number;
  snippet?: string;
}

export interface SerenaDiagnostic {
  file: string;
  line: number;
  character: number;
  category: 'error' | 'warning' | 'suggestion' | 'message';
  code: number;
  message: string;
}

export interface SerenaRenameResult {
  symbolName: string;
  newName: string;
  occurrencesFound: number;
  filesChanged: string[];
}

export class SerenaSemanticEngine {
  /**
   * Extract high-level symbol outline from source code using TypeScript AST parsing
   */
  static getSymbolOutline(filePath: string, fileContent?: string): SerenaSymbol[] {
    const fullPath = path.resolve(filePath);
    let content = fileContent;
    if (content === undefined) {
      if (!fs.existsSync(fullPath)) return [];
      content = fs.readFileSync(fullPath, 'utf-8');
    }

    const sourceFile = ts.createSourceFile(
      path.basename(fullPath),
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const symbols: SerenaSymbol[] = [];

    const visit = (node: ts.Node) => {
      const isExported = Boolean(
        ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export
      );

      const startPos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      const startLine = startPos.line + 1;
      const endLine = endPos.line + 1;
      const character = startPos.character + 1;

      if (ts.isClassDeclaration(node) && node.name) {
        symbols.push({
          name: node.name.text,
          kind: 'class',
          file: fullPath,
          startLine,
          endLine,
          character,
          isExported,
        });
      } else if (ts.isInterfaceDeclaration(node) && node.name) {
        symbols.push({
          name: node.name.text,
          kind: 'interface',
          file: fullPath,
          startLine,
          endLine,
          character,
          isExported,
        });
      } else if (ts.isTypeAliasDeclaration(node) && node.name) {
        symbols.push({
          name: node.name.text,
          kind: 'type',
          file: fullPath,
          startLine,
          endLine,
          character,
          isExported,
        });
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        symbols.push({
          name: node.name.text,
          kind: 'function',
          file: fullPath,
          startLine,
          endLine,
          character,
          isExported,
        });
      } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        symbols.push({
          name: node.name.text,
          kind: 'method',
          file: fullPath,
          startLine,
          endLine,
          character,
          isExported,
        });
      } else if (ts.isEnumDeclaration(node) && node.name) {
        symbols.push({
          name: node.name.text,
          kind: 'enum',
          file: fullPath,
          startLine,
          endLine,
          character,
          isExported,
        });
      } else if (ts.isVariableStatement(node) && isExported) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const declStart = sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile));
            const declEnd = sourceFile.getLineAndCharacterOfPosition(decl.getEnd());
            symbols.push({
              name: decl.name.text,
              kind: 'variable',
              file: fullPath,
              startLine: declStart.line + 1,
              endLine: declEnd.line + 1,
              character: declStart.character + 1,
              isExported: true,
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return symbols;
  }

  /**
   * Find definition of a symbol in a file or its import references
   */
  static findDefinition(
    filePath: string,
    symbolName: string,
    fileContent?: string
  ): SerenaLocation | null {
    const fullPath = path.resolve(filePath);
    let content = fileContent;
    if (content === undefined) {
      if (!fs.existsSync(fullPath)) return null;
      content = fs.readFileSync(fullPath, 'utf-8');
    }

    const sourceFile = ts.createSourceFile(
      path.basename(fullPath),
      content,
      ts.ScriptTarget.Latest,
      true
    );

    let match: SerenaLocation | null = null;

    const visit = (node: ts.Node) => {
      if (match) return;

      if (
        (ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.name &&
        node.name.text === symbolName
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.name.getStart(sourceFile));
        match = {
          file: fullPath,
          line: line + 1,
          character: character + 1,
          snippet: content!.split('\n')[line]?.trim(),
        };
        return;
      }

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === symbolName) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.name.getStart(sourceFile));
        match = {
          file: fullPath,
          line: line + 1,
          character: character + 1,
          snippet: content!.split('\n')[line]?.trim(),
        };
        return;
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return match;
  }

  /**
   * Find all references of a symbol across files in a directory using AST identifier matching
   */
  static findReferences(
    targetSymbol: string,
    searchDir: string,
    options: { filePattern?: string; maxResults?: number } = {}
  ): SerenaLocation[] {
    const pattern = options.filePattern || '**/*.{ts,tsx,js,jsx}';
    const maxResults = options.maxResults || 100;
    const resolvedDir = path.resolve(searchDir);

    const files = fg.sync(pattern, {
      cwd: resolvedDir,
      absolute: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.intershade/**'],
    });

    const results: SerenaLocation[] = [];

    for (const file of files) {
      if (results.length >= maxResults) break;
      try {
        const content = fs.readFileSync(file, 'utf-8');
        if (!content.includes(targetSymbol)) continue;

        const sourceFile = ts.createSourceFile(
          path.basename(file),
          content,
          ts.ScriptTarget.Latest,
          true
        );

        const lines = content.split('\n');

        const visit = (node: ts.Node) => {
          if (results.length >= maxResults) return;

          if (ts.isIdentifier(node) && node.text === targetSymbol) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            results.push({
              file,
              line: line + 1,
              character: character + 1,
              snippet: lines[line]?.trim(),
            });
          }

          ts.forEachChild(node, visit);
        };

        visit(sourceFile);
      } catch {
        // Skip unreadable files
      }
    }

    return results;
  }

  /**
   * Get compiler diagnostics (syntax and type errors) on a target file
   */
  static getDiagnostics(filePath: string, fileContent?: string): SerenaDiagnostic[] {
    const fullPath = path.resolve(filePath);
    let content = fileContent;
    if (content === undefined) {
      if (!fs.existsSync(fullPath)) return [];
      content = fs.readFileSync(fullPath, 'utf-8');
    }

    const options: ts.CompilerOptions = {
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
      allowJs: true,
    };

    const sourceFile = ts.createSourceFile(
      fullPath,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const program = ts.createProgram({
      rootNames: [fullPath],
      options,
      host: {
        getSourceFile: (fileName) => {
          if (path.resolve(fileName) === fullPath) return sourceFile;
          if (fs.existsSync(fileName)) {
            return ts.createSourceFile(
              fileName,
              fs.readFileSync(fileName, 'utf-8'),
              ts.ScriptTarget.Latest,
              true
            );
          }
          return undefined;
        },
        getDefaultLibFileName: () => 'lib.d.ts',
        writeFile: () => {},
        getCurrentDirectory: () => path.dirname(fullPath),
        getCanonicalFileName: (f) => f,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        fileExists: (f) => f === fullPath || fs.existsSync(f),
        readFile: (f) => (f === fullPath ? content : fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : undefined),
      },
    });

    const rawDiagnostics = [
      ...program.getSyntacticDiagnostics(sourceFile),
      ...program.getSemanticDiagnostics(sourceFile),
    ];

    const categoryMap: Record<ts.DiagnosticCategory, SerenaDiagnostic['category']> = {
      [ts.DiagnosticCategory.Error]: 'error',
      [ts.DiagnosticCategory.Warning]: 'warning',
      [ts.DiagnosticCategory.Suggestion]: 'suggestion',
      [ts.DiagnosticCategory.Message]: 'message',
    };

    return rawDiagnostics.map((d) => {
      let line = 1;
      let character = 1;
      if (d.file && d.start !== undefined) {
        const pos = d.file.getLineAndCharacterOfPosition(d.start);
        line = pos.line + 1;
        character = pos.character + 1;
      }
      return {
        file: fullPath,
        line,
        character,
        category: categoryMap[d.category] || 'error',
        code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      };
    });
  }
}
