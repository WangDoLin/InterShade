import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

export interface LspSymbol {
  name: string;
  kind: 'class' | 'interface' | 'type' | 'function' | 'method' | 'enum' | 'variable' | 'property';
  file: string;
  line: number;
  character: number;
  isExported: boolean;
}

export interface LspLocation {
  file: string;
  line: number;
  character: number;
  snippet?: string;
}

export interface LspTypeInfo {
  signature: string;
  documentation?: string;
}

export class NativeCodeIntelligence {
  /**
   * Extract document symbols via TypeScript AST parsing
   */
  static getDocumentSymbols(filePath: string, fileContent?: string): LspSymbol[] {
    const content = fileContent !== undefined ? fileContent : fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      path.basename(filePath),
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const symbols: LspSymbol[] = [];

    const visit = (node: ts.Node) => {
      const isExported = Boolean(
        ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export
      );

      let symbol: LspSymbol | null = null;
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

      if (ts.isClassDeclaration(node) && node.name) {
        symbol = {
          name: node.name.text,
          kind: 'class',
          file: filePath,
          line: line + 1,
          character: character + 1,
          isExported,
        };
      } else if (ts.isInterfaceDeclaration(node) && node.name) {
        symbol = {
          name: node.name.text,
          kind: 'interface',
          file: filePath,
          line: line + 1,
          character: character + 1,
          isExported,
        };
      } else if (ts.isTypeAliasDeclaration(node) && node.name) {
        symbol = {
          name: node.name.text,
          kind: 'type',
          file: filePath,
          line: line + 1,
          character: character + 1,
          isExported,
        };
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        symbol = {
          name: node.name.text,
          kind: 'function',
          file: filePath,
          line: line + 1,
          character: character + 1,
          isExported,
        };
      } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        symbol = {
          name: node.name.text,
          kind: 'method',
          file: filePath,
          line: line + 1,
          character: character + 1,
          isExported,
        };
      } else if (ts.isEnumDeclaration(node) && node.name) {
        symbol = {
          name: node.name.text,
          kind: 'enum',
          file: filePath,
          line: line + 1,
          character: character + 1,
          isExported,
        };
      } else if (ts.isVariableStatement(node) && isExported) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const declPos = sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile));
            symbols.push({
              name: decl.name.text,
              kind: 'variable',
              file: filePath,
              line: declPos.line + 1,
              character: declPos.character + 1,
              isExported: true,
            });
          }
        }
      }

      if (symbol) {
        symbols.push(symbol);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return symbols;
  }

  /**
   * Create an in-memory LanguageService Host for high-speed LSP queries
   */
  private static createServiceHost(targetFiles: string[], workspaceDir: string) {
    const filesMap = new Map<string, { version: number; content: string }>();

    for (const f of targetFiles) {
      const fullPath = path.isAbsolute(f) ? f : path.resolve(workspaceDir, f);
      if (fs.existsSync(fullPath)) {
        filesMap.set(fullPath, {
          version: 1,
          content: fs.readFileSync(fullPath, 'utf-8'),
        });
      }
    }

    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => Array.from(filesMap.keys()),
      getScriptVersion: (fileName) => filesMap.get(fileName)?.version.toString() || '0',
      getScriptSnapshot: (fileName) => {
        const entry = filesMap.get(fileName);
        if (entry) {
          return ts.ScriptSnapshot.fromString(entry.content);
        }
        if (fs.existsSync(fileName)) {
          return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf-8'));
        }
        return undefined;
      },
      getCurrentDirectory: () => workspaceDir,
      getCompilationSettings: () => ({
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowJs: true,
      }),
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (p) => fs.existsSync(p),
      readFile: (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : undefined),
    };

    const service = ts.createLanguageService(host, ts.createDocumentRegistry());
    return { service, filesMap };
  }

  /**
   * Jump to symbol definition using Language Server
   */
  static getDefinition(
    filePath: string,
    line: number,
    character: number,
    workspaceDir: string
  ): LspLocation[] {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(workspaceDir, filePath);
    const { service } = this.createServiceHost([fullPath], workspaceDir);

    const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : '';
    const sourceFile = ts.createSourceFile(fullPath, content, ts.ScriptTarget.Latest, true);
    const position = sourceFile.getPositionOfLineAndCharacter(line - 1, character - 1);

    const defs = service.getDefinitionAtPosition(fullPath, position);
    if (!defs || defs.length === 0) {
      return [];
    }

    return defs.map((d) => {
      const defContent = fs.existsSync(d.fileName) ? fs.readFileSync(d.fileName, 'utf-8') : '';
      const defSource = ts.createSourceFile(d.fileName, defContent, ts.ScriptTarget.Latest, true);
      const defPos = defSource.getLineAndCharacterOfPosition(d.textSpan.start);
      const snippet = defContent.split('\n')[defPos.line]?.trim() || '';

      return {
        file: path.relative(workspaceDir, d.fileName),
        line: defPos.line + 1,
        character: defPos.character + 1,
        snippet,
      };
    });
  }

  /**
   * Find symbol references across workspace files
   */
  static getReferences(
    filePath: string,
    line: number,
    character: number,
    workspaceDir: string,
    contextFiles: string[] = []
  ): LspLocation[] {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(workspaceDir, filePath);
    const allFiles = Array.from(new Set([fullPath, ...contextFiles]));
    const { service } = this.createServiceHost(allFiles, workspaceDir);

    const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : '';
    const sourceFile = ts.createSourceFile(fullPath, content, ts.ScriptTarget.Latest, true);
    const position = sourceFile.getPositionOfLineAndCharacter(line - 1, character - 1);

    const refs = service.getReferencesAtPosition(fullPath, position);
    if (!refs || refs.length === 0) {
      return [];
    }

    return refs.map((r) => {
      const refContent = fs.existsSync(r.fileName) ? fs.readFileSync(r.fileName, 'utf-8') : '';
      const refSource = ts.createSourceFile(r.fileName, refContent, ts.ScriptTarget.Latest, true);
      const refPos = refSource.getLineAndCharacterOfPosition(r.textSpan.start);
      const snippet = refContent.split('\n')[refPos.line]?.trim() || '';

      return {
        file: path.relative(workspaceDir, r.fileName),
        line: refPos.line + 1,
        character: refPos.character + 1,
        snippet,
      };
    });
  }

  /**
   * Get TypeScript type signature and documentation (Hover info)
   */
  static getTypeInfo(
    filePath: string,
    line: number,
    character: number,
    workspaceDir: string
  ): LspTypeInfo | null {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(workspaceDir, filePath);
    const { service } = this.createServiceHost([fullPath], workspaceDir);

    const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : '';
    const sourceFile = ts.createSourceFile(fullPath, content, ts.ScriptTarget.Latest, true);
    const position = sourceFile.getPositionOfLineAndCharacter(line - 1, character - 1);

    const quickInfo = service.getQuickInfoAtPosition(fullPath, position);
    if (!quickInfo) {
      return null;
    }

    const signature = ts.displayPartsToString(quickInfo.displayParts);
    const doc = ts.displayPartsToString(quickInfo.documentation);

    return {
      signature,
      documentation: doc || undefined,
    };
  }
}
