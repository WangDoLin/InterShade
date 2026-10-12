import http from 'node:http';
import { EventEmitter } from 'node:events';
import { SkillCrystallizer } from '../services/skills/SkillCrystallizer.js';
import { FtsMemoryService } from '../services/memory/FtsMemoryService.js';
import { TrajectoryRecorder } from '../services/memory/TrajectoryRecorder.js';

export interface GatewayMessage {
  sessionId: string;
  source: 'cli' | 'telegram' | 'discord' | 'webhook';
  prompt: string;
  senderId?: string;
}

export interface GatewayResponse {
  success: boolean;
  message: string;
  data?: any;
}

export class GatewayServer extends EventEmitter {
  private server: http.Server | null = null;
  private port: number;
  private workspaceDir: string;
  private isRunning: boolean = false;

  constructor(options: { port?: number; workspaceDir: string }) {
    super();
    this.port = options.port || 3847;
    this.workspaceDir = options.workspaceDir;
  }

  /**
   * Start the headless Gateway HTTP daemon
   */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

        // 1. Health check & status
        if (req.method === 'GET' && url.pathname === '/api/status') {
          const skills = SkillCrystallizer.loadSkills(this.workspaceDir);
          const recentTrajs = TrajectoryRecorder.getRecentSuccessful(5);

          const payload: GatewayResponse = {
            success: true,
            message: 'InterShader Gateway Server Operational',
            data: {
              status: 'RUNNING',
              port: this.port,
              workspaceDir: this.workspaceDir,
              crystallizedSkillsCount: skills.length,
              recentSuccessfulRuns: recentTrajs.length,
              timestamp: Date.now(),
            },
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
          return;
        }

        // 2. Crystallized Skills registry
        if (req.method === 'GET' && url.pathname === '/api/skills') {
          const skills = SkillCrystallizer.loadSkills(this.workspaceDir);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, skills }));
          return;
        }

        // 3. FTS5 Memory Search
        if (req.method === 'GET' && url.pathname === '/api/memories/search') {
          const q = url.searchParams.get('q') || '';
          const results = FtsMemoryService.searchMemories(q, { limit: 10 });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, results }));
          return;
        }

        // 4. Prompt submission & dispatch
        if (req.method === 'POST' && url.pathname === '/api/prompt') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });

          req.on('end', () => {
            try {
              const msg: GatewayMessage = JSON.parse(body || '{}');
              if (!msg.prompt) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Missing prompt in request body.' }));
                return;
              }

              this.emit('user_prompt', msg);

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  success: true,
                  message: 'Prompt enqueued for processing.',
                  sessionId: msg.sessionId,
                })
              );
            } catch (err: any) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Endpoint not found.' }));
      });

      this.server.listen(this.port, () => {
        this.isRunning = true;
        resolve(this.port);
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Gracefully stop the Gateway server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server && this.isRunning) {
        this.server.close(() => {
          this.isRunning = false;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
