import path from 'path';
import fs from 'fs';
import os from 'os';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/index.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

export interface McpConfigFile {
  mcpServers?: Record<string, McpServerConfig>;
}

export class McpClientManager {
  private static activeClients: Map<string, Client> = new Map();
  private static registeredTools: Map<string, string> = new Map(); // toolName -> serverName

  /**
   * Discovers and resolves MCP configuration file
   */
  static findConfigFile(cwd: string): string | null {
    const candidates = [
      path.join(cwd, '.intershader', 'mcp.json'),
      path.join(cwd, '.mcp.json'),
      path.join(cwd, 'mcp.json'),
      path.join(os.homedir(), '.intershade', 'mcp.json'),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Initializes MCP servers from configuration and registers their tools
   */
  static async initializeMcpServers(cwd: string, toolRegistry: ToolRegistry): Promise<string[]> {
    const configPath = this.findConfigFile(cwd);
    if (!configPath) {
      return [];
    }

    const loadedTools: string[] = [];

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed: McpConfigFile = JSON.parse(content);

      if (!parsed.mcpServers) return [];

      for (const [serverName, serverCfg] of Object.entries(parsed.mcpServers)) {
        if (serverCfg.disabled) continue;

        try {
          const cleanEnv: Record<string, string> = {};
          for (const [k, v] of Object.entries(process.env)) {
            if (v !== undefined) cleanEnv[k] = v;
          }
          if (serverCfg.env) {
            Object.assign(cleanEnv, serverCfg.env);
          }

          const transport = new StdioClientTransport({
            command: serverCfg.command,
            args: serverCfg.args || [],
            env: cleanEnv,
          });

          const client = new Client(
            {
              name: `intershader-${serverName}`,
              version: '1.0.0',
            },
            {
              capabilities: {},
            }
          );

          await client.connect(transport);
          this.activeClients.set(serverName, client);

          // Retrieve tools provided by this MCP server
          const toolsResponse = await client.listTools();

          for (const mcpTool of toolsResponse.tools) {
            const toolName = `mcp_${serverName}_${mcpTool.name}`;
            this.registeredTools.set(toolName, serverName);

            // Adapt MCP tool into InterShader ToolDefinition
            const adaptedTool: ToolDefinition<any, any> = {
              name: toolName,
              description: `[MCP: ${serverName}] ${mcpTool.description || 'External MCP tool'}`,
              inputSchema: z.record(z.any()),
              isReadOnly: false,
              isDestructive: false,
              requiresPermission: false,
              execute: async (args: Record<string, unknown>, _context: ToolExecutionContext) => {
                try {
                  const result = await client.callTool({
                    name: mcpTool.name,
                    arguments: args,
                  });

                  if (result.content && Array.isArray(result.content)) {
                    return result.content
                      .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
                      .join('\n');
                  }
                  return JSON.stringify(result);
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  return `[MCP Tool Error (${serverName})]: ${msg}`;
                }
              },
            };

            toolRegistry.register(adaptedTool);
            loadedTools.push(toolName);
          }
        } catch (err) {
          // Log or silently skip unavailable MCP servers
        }
      }
    } catch {
      // ignore invalid config
    }

    return loadedTools;
  }

  /**
   * Returns list of connected MCP servers
   */
  static getConnectedServers(): string[] {
    return Array.from(this.activeClients.keys());
  }

  /**
   * Cleanly disconnects all running MCP clients
   */
  static async disconnectAll(): Promise<void> {
    for (const client of this.activeClients.values()) {
      try {
        await client.close();
      } catch {
        // ignore disconnect errors
      }
    }
    this.activeClients.clear();
    this.registeredTools.clear();
  }
}
