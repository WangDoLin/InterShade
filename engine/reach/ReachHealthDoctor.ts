import { NetworkGuard } from '../../providers/security/NetworkGuard.js';

export interface ChannelHealth {
  name: string;
  status: 'ONLINE' | 'DEGRADED' | 'UNREACHABLE' | 'NOT_CONFIGURED';
  latencyMs?: number;
  details: string;
}

export interface ReachDoctorReport {
  overallStatus: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
  timestamp: number;
  channels: ChannelHealth[];
  proxyConfigured: boolean;
}

export class ReachHealthDoctor {
  /**
   * Run diagnostic health checks across all internet channels
   */
  static async diagnose(options: { timeoutMs?: number } = {}): Promise<ReachDoctorReport> {
    const timeoutMs = options.timeoutMs ?? 5000;
    const channels: ChannelHealth[] = [];

    // 1. Check DNS resolution
    try {
      const dnsStart = Date.now();
      const resolved = await NetworkGuard.resolveAndValidateHost('github.com', false);
      channels.push({
        name: 'DNS Resolution',
        status: 'ONLINE',
        latencyMs: Date.now() - dnsStart,
        details: `Resolved github.com to ${resolved[0]}`,
      });
    } catch (err: unknown) {
      channels.push({
        name: 'DNS Resolution',
        status: 'UNREACHABLE',
        details: `DNS failure: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 2. Check Jina Reader endpoint
    try {
      const jinaStart = Date.now();
      const res = await NetworkGuard.safeFetch(
        'https://r.jina.ai/https://example.com',
        {
          method: 'GET',
          headers: { 'Accept': 'text/plain' },
          signal: AbortSignal.timeout(timeoutMs),
        },
        { isLocalAllowed: false }
      );
      channels.push({
        name: 'Web Reader (Jina Protocol)',
        status: res.ok ? 'ONLINE' : 'DEGRADED',
        latencyMs: Date.now() - jinaStart,
        details: `HTTP ${res.status} (${res.statusText || 'OK'})`,
      });
    } catch (err: unknown) {
      channels.push({
        name: 'Web Reader (Jina Protocol)',
        status: 'UNREACHABLE',
        details: `Connection error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 3. Check GitHub API
    try {
      const ghStart = Date.now();
      const res = await NetworkGuard.safeFetch(
        'https://api.github.com/zen',
        {
          method: 'GET',
          headers: { 'User-Agent': 'InterShader-Reach-Doctor/1.0' },
          signal: AbortSignal.timeout(timeoutMs),
        },
        { isLocalAllowed: false }
      );
      channels.push({
        name: 'GitHub API',
        status: res.ok ? 'ONLINE' : 'DEGRADED',
        latencyMs: Date.now() - ghStart,
        details: `HTTP ${res.status} (${res.statusText || 'OK'})`,
      });
    } catch (err: unknown) {
      channels.push({
        name: 'GitHub API',
        status: 'UNREACHABLE',
        details: `Connection error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const proxyConfigured = Boolean(process.env.HTTP_PROXY || process.env.HTTPS_PROXY);

    const onlineCount = channels.filter((c) => c.status === 'ONLINE').length;
    let overallStatus: ReachDoctorReport['overallStatus'];
    if (onlineCount === channels.length) {
      overallStatus = 'HEALTHY';
    } else if (onlineCount > 0) {
      overallStatus = 'DEGRADED';
    } else {
      overallStatus = 'OFFLINE';
    }

    return {
      overallStatus,
      timestamp: Date.now(),
      channels,
      proxyConfigured,
    };
  }

  /**
   * Format diagnostic results into structured ASCII report
   */
  static formatReport(report: ReachDoctorReport): string {
    const lines: string[] = [
      '=== AGENT REACH HEALTH DOCTOR REPORT ===',
      `Overall Status: [${report.overallStatus}]`,
      `Proxy Config:   ${report.proxyConfigured ? 'Configured (Active)' : 'None (Direct Connect)'}`,
      '-'.repeat(80),
      `${'CHANNEL'.padEnd(30)} ${'STATUS'.padEnd(14)} ${'LATENCY'.padEnd(10)} ${'DETAILS'}`,
      '-'.repeat(80),
    ];

    for (const c of report.channels) {
      const lat = c.latencyMs !== undefined ? `${c.latencyMs}ms` : 'n/a';
      lines.push(`${c.name.padEnd(30)} ${c.status.padEnd(14)} ${lat.padEnd(10)} ${c.details}`);
    }

    return lines.join('\n');
  }
}
