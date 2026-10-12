import { ModelCatalogStore } from './ModelCatalogStore.js';
import { ConnectionRegistry } from '../core/ConnectionRegistry.js';
import type { HealthCheckResult } from '../reliability/ProviderHealthChecker.js';
import type { ModelProbeResult } from '../reliability/ModelProbeEngine.js';
import { SecretSanitizer } from '../security/SecretSanitizer.js';

export class GatewayFormatter {
  static formatModelsList(providerFilter?: string): string {
    const models = ModelCatalogStore.list(providerFilter);
    if (models.length === 0) {
      return providerFilter
        ? `No models found for provider '${providerFilter}'.`
        : 'No models registered in catalog.';
    }

    const lines: string[] = [
      'Registered Model Catalog',
      `${'MODEL ID'.padEnd(35)} ${'PROVIDER'.padEnd(12)} ${'TOOLS'.padEnd(12)} ${'VISION'.padEnd(8)} ${'CONTEXT'.padEnd(10)} ${'SOURCE'.padEnd(22)} ${'LIFECYCLE'}`,
      '-'.repeat(112),
    ];

    for (const m of models) {
      const tools = m.capabilities.toolCalling;
      const vision = m.inputModalities.includes('image') ? 'yes' : 'no';
      const context = m.contextWindow ? `${Math.round(m.contextWindow / 1024)}k` : 'unknown';
      lines.push(
        `${m.modelId.padEnd(35)} ${m.providerId.padEnd(12)} ${tools.padEnd(12)} ${vision.padEnd(8)} ${context.padEnd(10)} ${m.capabilitySource.padEnd(22)} ${m.lifecycle}`
      );
    }

    return lines.join('\n');
  }

  static formatModelInspect(providerId: string, modelId: string): string {
    const descriptor = ModelCatalogStore.get(providerId, modelId) || ModelCatalogStore.resolveOrCreate(providerId, modelId);
    const conn = ConnectionRegistry.findByProvider(providerId) || ConnectionRegistry.getDefault();

    const contextStr = descriptor.contextWindow
      ? `${descriptor.contextWindow.toLocaleString()} tokens`
      : 'unknown';

    return [
      'Model Gateway Inspection',
      `Model:          ${descriptor.modelId}`,
      `Provider:       ${descriptor.providerId}`,
      `Connection:     ${conn.id}`,
      `Protocol:       ${conn.protocolId}`,
      `Tools:          ${descriptor.capabilities.toolCalling}`,
      `Vision:         ${descriptor.inputModalities.includes('image') ? 'supported' : 'unsupported'}`,
      `Context window: ${contextStr}`,
      `Lifecycle:      ${descriptor.lifecycle}`,
      `Source:         ${descriptor.capabilitySource}`,
      `Reasoning:      ${descriptor.capabilities.reasoningControl}`,
      `Streaming:      ${descriptor.capabilities.streaming}`,
      `Structured Out: ${descriptor.capabilities.structuredOutput}`,
      `Prompt Caching: ${descriptor.capabilities.promptCaching}`,
    ].join('\n');
  }

  static formatProvidersList(): string {
    const list = ConnectionRegistry.list();
    const lines: string[] = [
      'Active Connection Profiles',
      `${'CONNECTION ID'.padEnd(20)} ${'PROVIDER'.padEnd(12)} ${'PROTOCOL'.padEnd(26)} ${'DEFAULT MODEL'.padEnd(30)} ${'CREDENTIAL'}`,
      '-'.repeat(105),
    ];

    for (const c of list) {
      const apiKey = ConnectionRegistry.resolveApiKey(c);
      const credStatus = apiKey ? 'configured' : c.apiKeyEnv ? `missing (${c.apiKeyEnv})` : 'none required';
      const defModel = c.defaultModelId || 'none';
      lines.push(
        `${c.id.padEnd(20)} ${c.providerId.padEnd(12)} ${c.protocolId.padEnd(26)} ${defModel.padEnd(30)} ${credStatus}`
      );
    }

    return lines.join('\n');
  }

  static formatModelProbeResults(results: ModelProbeResult[]): string {
    if (results.length === 0) {
      return 'No probe results to display.';
    }

    const lines: string[] = [
      'Live Model Availability Probe Report',
      `${'PROVIDER'.padEnd(12)} ${'MODEL ID'.padEnd(35)} ${'STATUS'.padEnd(14)} ${'HTTP'.padEnd(6)} ${'LATENCY'.padEnd(10)} ${'TOOLS'.padEnd(12)} ${'DETAILS'}`,
      '-'.repeat(125),
    ];

    for (const r of results) {
      const http = r.httpStatus !== undefined ? String(r.httpStatus) : 'n/a';
      const latency = r.latencyMs !== undefined ? `${r.latencyMs}ms` : 'n/a';
      const tools = r.toolCallingSupport;
      lines.push(
        `${r.providerId.padEnd(12)} ${r.modelId.padEnd(35)} ${r.status.padEnd(14)} ${http.padEnd(6)} ${latency.padEnd(10)} ${tools.padEnd(12)} ${SecretSanitizer.sanitize(r.message)}`
      );
    }

    return lines.join('\n');
  }

  static formatHealthCheck(result: HealthCheckResult): string {
    const latency = result.latencyMs !== undefined ? `${result.latencyMs}ms` : 'n/a';
    const s = result.stages;
    const stagesLine = `Stages:      Configured [${s.configured ? 'YES' : 'NO'}] | Reachable [${s.reachable ? 'YES' : 'NO'}] | Authenticated [${s.authenticated ? 'YES' : 'NO'}] | Model [${s.modelAvailable ? 'YES' : 'NO'}] | Verified [${s.capabilitiesVerified ? 'YES' : 'NO'}]`;

    return [
      `Connection:  ${result.connectionId} (${result.providerId} via ${result.protocolId})`,
      `Status:      [${result.status.toUpperCase()}]`,
      `Stages:      ${stagesLine}`,
      `Latency:     ${latency}`,
      `Message:     ${SecretSanitizer.sanitize(result.message)}`,
    ].join('\n');
  }
}
