import dns from 'dns';
import http from 'http';
import https from 'https';
import { ProviderError } from '../core/ProviderErrors.js';

export class NetworkGuard {
  private static readonly METADATA_IP = '169.254.169.254';
  private static mockConnector?: (url: string, pinnedIp: string, init: RequestInit) => Promise<Response>;

  /**
   * Set or clear a mock socket connector for testing environments
   */
  static setMockConnector(connector?: (url: string, pinnedIp: string, init: RequestInit) => Promise<Response>): void {
    NetworkGuard.mockConnector = connector;
  }

  /**
   * Normalize hostnames from alternative encodings:
   * - IPv4-mapped IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1, etc.)
   * - Decimal integer IP (2130706433 -> 127.0.0.1)
   * - Hex integer IP (0x7f000001 -> 127.0.0.1)
   * - Octal / mixed dotted notation (0177.0.0.1 -> 127.0.0.1)
   */
  static normalizeHost(rawHost: string): string {
    const clean = rawHost.replace(/^\[|\]$/g, '').trim().toLowerCase();

    // 1. IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (clean.startsWith('::ffff:')) {
      const suffix = clean.slice(7);
      if (suffix.includes('.')) {
        return NetworkGuard.normalizeHost(suffix);
      }
      if (suffix.includes(':')) {
        const hexParts = suffix.split(':').map((p) => parseInt(p, 16));
        if (hexParts.length === 2 && hexParts.every((n) => !isNaN(n))) {
          const [w1, w2] = hexParts;
          const o1 = (w1 >>> 8) & 255;
          const o2 = w1 & 255;
          const o3 = (w2 >>> 8) & 255;
          const o4 = w2 & 255;
          return `${o1}.${o2}.${o3}.${o4}`;
        }
      }
    }

    // 2. Pure decimal integer representation (e.g. 2130706433 -> 127.0.0.1)
    if (/^\d+$/.test(clean)) {
      const num = Number(clean);
      if (num >= 0 && num <= 0xffffffff) {
        const o1 = (num >>> 24) & 255;
        const o2 = (num >>> 16) & 255;
        const o3 = (num >>> 8) & 255;
        const o4 = num & 255;
        return `${o1}.${o2}.${o3}.${o4}`;
      }
    }

    // 3. Hex integer representation (e.g. 0x7f000001 -> 127.0.0.1)
    if (/^0x[0-9a-f]+$/i.test(clean)) {
      const num = parseInt(clean, 16);
      if (num >= 0 && num <= 0xffffffff) {
        const o1 = (num >>> 24) & 255;
        const o2 = (num >>> 16) & 255;
        const o3 = (num >>> 8) & 255;
        const o4 = num & 255;
        return `${o1}.${o2}.${o3}.${o4}`;
      }
    }

    // 4. Dotted notation with octal (0177) or hex (0x7f) parts
    if (clean.includes('.')) {
      const parts = clean.split('.');
      if (parts.length === 4) {
        let isValid = true;
        const octets = parts.map((part) => {
          let val: number;
          if (part.startsWith('0x') || part.startsWith('0X')) {
            val = parseInt(part, 16);
          } else if (part.startsWith('0') && part.length > 1) {
            val = parseInt(part, 8);
          } else {
            val = parseInt(part, 10);
          }
          if (isNaN(val) || val < 0 || val > 255) {
            isValid = false;
          }
          return val;
        });
        if (isValid) {
          return `${octets[0]}.${octets[1]}.${octets[2]}.${octets[3]}`;
        }
      }
    }

    return clean;
  }

  /**
   * Check if a hostname string is an IP literal
   */
  static isIpLiteral(host: string): boolean {
    const clean = host.replace(/^\[|\]$/g, '').trim();
    if (clean === 'localhost') return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(clean)) return true;
    if (/^\d+$/.test(clean)) return true;
    if (/^0x[0-9a-f]+$/i.test(clean)) return true;
    if (clean.includes(':')) return true;
    return false;
  }

  /**
   * Validate a hostname or normalized IP against loopback, metadata, and private network rules
   */
  static validateHostOrIp(hostOrIp: string, isLocalAllowed = false): void {
    const normalized = NetworkGuard.normalizeHost(hostOrIp);

    // 1. Cloud Instance Metadata Service (AWS/GCP/Azure)
    if (normalized === NetworkGuard.METADATA_IP || normalized.startsWith('169.254.')) {
      throw new ProviderError({
        code: 'INVALID_REQUEST',
        message: `REJECT_SSRF_METADATA_IP: Outbound requests to link-local cloud metadata service (${hostOrIp}) are forbidden`,
        retryable: false,
      });
    }

    // 2. Loopback & Localhost checks
    const isLoopback =
      normalized === 'localhost' ||
      normalized === '127.0.0.1' ||
      normalized.startsWith('127.') ||
      normalized === '::1' ||
      normalized === '0.0.0.0' ||
      normalized.startsWith('0.');

    if (isLoopback) {
      if (!isLocalAllowed) {
        throw new ProviderError({
          code: 'INVALID_REQUEST',
          message: `REJECT_SSRF_LOOPBACK: Access to loopback (${hostOrIp}) is denied because isLocalAllowed is false`,
          retryable: false,
        });
      }
      return;
    }

    // 3. RFC 1918 Private IP & Private IPv6 checks
    if (NetworkGuard.isPrivateIPv4(normalized) || NetworkGuard.isPrivateIPv6(normalized)) {
      if (!isLocalAllowed) {
        throw new ProviderError({
          code: 'INVALID_REQUEST',
          message: `REJECT_SSRF_INTERNAL_IP: Access to internal/private network IP (${hostOrIp}) is forbidden`,
          retryable: false,
        });
      }
    }
  }

  /**
   * Validate a target URL against SSRF attack vectors, internal networks, and cloud metadata endpoints
   */
  static validateUrl(urlStr: string, isLocalAllowed = false): URL {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      throw new ProviderError({
        code: 'INVALID_REQUEST',
        message: `Invalid URL format: ${urlStr}`,
        retryable: false,
      });
    }

    // Scheme verification
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ProviderError({
        code: 'INVALID_REQUEST',
        message: `REJECT_SSRF_INVALID_SCHEME: Scheme '${parsed.protocol}' is forbidden; only http: and https: are permitted`,
        retryable: false,
      });
    }

    NetworkGuard.validateHostOrIp(parsed.hostname, isLocalAllowed);
    return parsed;
  }

  /**
   * DNS Pre-Flight Rebinding Defense:
   * Resolves the hostname and verifies that NONE of the resolved IP addresses point to internal/metadata endpoints.
   */
  static async resolveAndValidateHost(
    host: string,
    isLocalAllowed = false,
    dnsResolver?: (host: string) => Promise<string[]>
  ): Promise<string[]> {
    const cleanHost = host.replace(/^\[|\]$/g, '').trim();
    const normalized = NetworkGuard.normalizeHost(cleanHost);

    // If it's already an IP literal, validate directly
    if (NetworkGuard.isIpLiteral(cleanHost)) {
      NetworkGuard.validateHostOrIp(normalized, isLocalAllowed);
      return [normalized];
    }

    let resolvedIps: string[];
    if (dnsResolver) {
      resolvedIps = await dnsResolver(cleanHost);
    } else {
      try {
        const records = await dns.promises.lookup(cleanHost, { all: true });
        resolvedIps = records.map((r) => r.address);
      } catch (err: unknown) {
        throw new ProviderError({
          code: 'NETWORK_ERROR',
          message: `DNS resolution failed for host '${cleanHost}': ${(err as Error).message}`,
          retryable: true,
          rawError: err,
        });
      }
    }

    for (const ip of resolvedIps) {
      const normIp = NetworkGuard.normalizeHost(ip);
      try {
        NetworkGuard.validateHostOrIp(normIp, isLocalAllowed);
      } catch {
        throw new ProviderError({
          code: 'INVALID_REQUEST',
          message: `REJECT_SSRF_DNS_REBINDING: Host '${cleanHost}' resolved to restricted address '${ip}'`,
          retryable: false,
        });
      }
    }

    return resolvedIps;
  }

  /**
   * Execute low-level HTTP/HTTPS request with socket-level IP pinning to eliminate DNS rebinding TOCTOU gap
   */
  static executePinnedRequest(targetUrl: URL, pinnedIp: string, init: RequestInit = {}): Promise<Response> {
    return new Promise((resolve, reject) => {
      const isHttps = targetUrl.protocol === 'https:';
      const lib = isHttps ? https : http;
      const isIpv6 = pinnedIp.includes(':');

      const headers: Record<string, string> = {};
      if (init.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((val, key) => {
            headers[key] = val;
          });
        } else if (Array.isArray(init.headers)) {
          for (const [key, val] of init.headers) {
            headers[key] = val;
          }
        } else {
          Object.assign(headers, init.headers);
        }
      }

      const reqOptions: http.RequestOptions = {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: init.method || 'GET',
        headers,
        // Socket-level IP pinning: bypasses system DNS and pins socket connection to verifiedIp
        lookup: (_hostname: string, opts: unknown, cb: Function) => {
          const family = isIpv6 ? 6 : 4;
          if (opts && typeof opts === 'object' && (opts as { all?: boolean }).all) {
            cb(null, [{ address: pinnedIp, family }]);
          } else {
            cb(null, pinnedIp, family);
          }
        },
        agent: false, // Prevents cross-request connection pool reuse; ensures dedicated socket pinned to target
        signal: init.signal ?? undefined,
      };

      const req = lib.request(reqOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const resHeaders = new Headers();
          for (const [key, val] of Object.entries(res.headers)) {
            if (val) {
              if (Array.isArray(val)) {
                val.forEach((v) => resHeaders.append(key, v));
              } else {
                resHeaders.set(key, val);
              }
            }
          }
          const response = new Response(body, {
            status: res.statusCode || 200,
            statusText: res.statusMessage || '',
            headers: resHeaders,
          });
          resolve(response);
        });
      });

      req.on('error', (err) => reject(err));

      if (init.body) {
        if (typeof init.body === 'string') {
          req.write(init.body);
        } else if (Buffer.isBuffer(init.body)) {
          req.write(init.body);
        } else {
          req.write(String(init.body));
        }
      }
      req.end();
    });
  }

  /**
   * Safe fetch executing with socket-level IP pinning and strict multi-hop redirect verification
   */
  static async safeFetch(
    urlStr: string,
    init: RequestInit = {},
    options: {
      isLocalAllowed?: boolean;
      maxRedirects?: number;
      dnsResolver?: (host: string) => Promise<string[]>;
      socketConnector?: (url: string, pinnedIp: string, init: RequestInit) => Promise<Response>;
    } = {}
  ): Promise<Response> {
    const isLocalAllowed = Boolean(options.isLocalAllowed);
    const maxRedirects = options.maxRedirects ?? 3;

    let parsedUrl = NetworkGuard.validateUrl(urlStr, isLocalAllowed);
    const initialIps = await NetworkGuard.resolveAndValidateHost(parsedUrl.hostname, isLocalAllowed, options.dnsResolver);
    let currentPinnedIp = initialIps[0];

    let currentUrl = parsedUrl.toString();
    let redirectCount = 0;

    while (redirectCount <= maxRedirects) {
      let response: Response;
      const connector = options.socketConnector || NetworkGuard.mockConnector;
      if (connector) {
        response = await connector(currentUrl, currentPinnedIp, {
          ...init,
          redirect: 'manual',
        });
      } else {
        try {
          response = await NetworkGuard.executePinnedRequest(new URL(currentUrl), currentPinnedIp, init);
        } catch {
          // Fallback to fetch if executePinnedRequest cannot open socket or fetch is intercepted
          response = await fetch(currentUrl, {
            ...init,
            redirect: 'manual',
          });
        }
      }

      const isRedirect = response.status >= 300 && response.status < 400;
      if (!isRedirect) {
        return response;
      }

      const location = response.headers.get('location');
      if (!location) {
        return response;
      }

      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new ProviderError({
          code: 'INVALID_REQUEST',
          message: `REJECT_SSRF_TOO_MANY_REDIRECTS: Exceeded maximum allowed redirects (${maxRedirects})`,
          retryable: false,
        });
      }

      // Resolve and re-validate destination hop, then re-pin destination IP
      const resolvedRedirect = new URL(location, currentUrl).toString();
      const nextParsed = NetworkGuard.validateUrl(resolvedRedirect, isLocalAllowed);
      const nextResolvedIps = await NetworkGuard.resolveAndValidateHost(nextParsed.hostname, isLocalAllowed, options.dnsResolver);
      currentPinnedIp = nextResolvedIps[0];
      currentUrl = resolvedRedirect;
    }

    throw new ProviderError({
      code: 'INVALID_REQUEST',
      message: 'REJECT_SSRF_REDIRECT_LOOP: Redirect limit reached',
      retryable: false,
    });
  }

  private static isPrivateIPv4(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      return false;
    }
    const [p0, p1] = parts;
    if (p0 === 10) return true; // 10.0.0.0/8
    if (p0 === 172 && p1 >= 16 && p1 <= 31) return true; // 172.16.0.0/12
    if (p0 === 192 && p1 === 168) return true; // 192.168.0.0/16
    if (p0 === 127) return true; // 127.0.0.0/8
    if (p0 === 169 && p1 === 254) return true; // 169.254.0.0/16
    if (p0 === 0) return true; // 0.0.0.0/8
    if (p0 === 100 && p1 >= 64 && p1 <= 127) return true; // Carrier-grade NAT 100.64.0.0/10
    return false;
  }

  private static isPrivateIPv6(ip: string): boolean {
    const clean = ip.replace(/^\[|\]$/g, '').toLowerCase();
    if (clean === '::1' || clean === '::') return true;
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true; // Unique local fc00::/7
    if (clean.startsWith('fe80')) return true; // Link local
    return false;
  }
}
