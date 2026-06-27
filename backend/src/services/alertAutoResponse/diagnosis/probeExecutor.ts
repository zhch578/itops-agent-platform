/**
 * =============================================================================
 * AARS v2 — 探针执行池（并发控制 + 超时保护）
 *
 * 功能：
 *   1. 接收探针列表和设备信息，并发执行
 *   2. SSH 探针 → 通过 sshService 远程执行命令
 *   3. SNMP 探针 → 通过 snmpService 轮询 OID
 *   4. 收集结果、合并输出、返回 ProbeResult[]
 * =============================================================================
 */

import db from '../../../models/database';
import { decrypt } from '../../encryptionService';
import { withRetry } from '../../../utils/retry';
import { logger } from '../../../utils/logger';
import { Client } from 'ssh2';
import { getProbeById } from '../probeUnit';
import type { ProbeUnit, ProbeResult, DeviceRuntimeProfile } from '../types';

// SSDP 执行并发池
const MAX_CONCURRENT = 5;

class ProbeExecutor {
  private semaphore = 0;

  /**
   * 并发执行一组探针
   */
  async executeProbes(
    probes: ProbeUnit[],
    device: DeviceRuntimeProfile,
    alertTitle?: string
  ): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];
    const queue = [...probes];

    // 并发控制：最多同时执行 MAX_CONCURRENT 个
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(MAX_CONCURRENT, queue.length); i++) {
      workers.push(this.workerLoop(queue, device, alertTitle, results));
    }
    await Promise.allSettled(workers);

    return results;
  }

  private async workerLoop(
    queue: ProbeUnit[],
    device: DeviceRuntimeProfile,
    alertTitle: string | undefined,
    results: ProbeResult[]
  ): Promise<void> {
    while (true) {
      const probe = queue.shift();
      if (!probe) break;

      try {
        const result = await this.executeSingleProbe(probe, device);
        results.push(result);
      } catch (err: any) {
        results.push({
          probeId: probe.id,
          success: false,
          rawOutput: `Executor error: ${err.message}`,
          durationMs: 0,
          error: err.message,
        });
      }
    }
  }

  /**
   * 执行单个探针
   */
  private async executeSingleProbe(probe: ProbeUnit, device: DeviceRuntimeProfile): Promise<ProbeResult> {
    const start = Date.now();
    const isSnmp = probe.oids && probe.oids.length > 0;

    try {
      if (isSnmp) {
        return await this.executeSnmpProbe(probe, device, start);
      } else {
        return await this.executeSshProbe(probe, device, start);
      }
    } catch (err: any) {
      return {
        probeId: probe.id,
        success: false,
        rawOutput: `Error: ${err.message}`,
        durationMs: Date.now() - start,
        error: err.message,
      };
    }
  }

  /**
   * SSH 探针执行
   */
  private async executeSshProbe(probe: ProbeUnit, device: DeviceRuntimeProfile, start: number): Promise<ProbeResult> {
    if (!probe.commands || probe.commands.length === 0) {
      return { probeId: probe.id, success: false, rawOutput: 'No commands defined', durationMs: 0, error: 'No commands' };
    }

    const outputParts: string[] = [];
    let allSuccess = true;

    for (const cmdRaw of probe.commands) {
      try {
        const output = await this.sshExec(
          device.ip,
          cmdRaw,
          probe.timeoutMs,
          device
        );
        outputParts.push(`## ${cmdRaw}\n\`\`\`\n${output.trim() || '(no output)'}\n\`\`\``);
      } catch (err: any) {
        allSuccess = false;
        outputParts.push(`## ${cmdRaw}\n\`\`\`\n[ERROR] ${err.message}\n\`\`\``);
      }
    }

    return {
      probeId: probe.id,
      success: allSuccess,
      rawOutput: outputParts.join('\n\n'),
      durationMs: Date.now() - start,
    };
  }

  /**
   * SNMP 探针执行
   */
  private async executeSnmpProbe(probe: ProbeUnit, device: DeviceRuntimeProfile, start: number): Promise<ProbeResult> {
    if (!probe.oids || probe.oids.length === 0) {
      return { probeId: probe.id, success: false, rawOutput: 'No OIDs defined', durationMs: 0, error: 'No OIDs' };
    }

    try {
      // 从数据库获取设备的 community
      let community = 'public';
      try {
        const nd = db.prepare('SELECT community FROM network_devices WHERE id = ?').get(device.deviceId) as { community: string } | undefined;
        if (nd?.community) community = nd.community;
      } catch {}

      const outputParts: string[] = [];
      let allSuccess = true;

      for (const oid of probe.oids) {
        try {
          const value = await withRetry(
            () => this.snmpGet(device.ip, community, oid),
            { maxRetries: 2, initialDelayMs: 500 }
          );
          outputParts.push(`OID ${oid}: ${value}`);
        } catch (err: any) {
          allSuccess = false;
          outputParts.push(`OID ${oid}: [ERROR] ${err.message}`);
        }
      }

      return {
        probeId: probe.id,
        success: allSuccess,
        rawOutput: outputParts.join('\n'),
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        probeId: probe.id,
        success: false,
        rawOutput: `SNMP error: ${err.message}`,
        durationMs: Date.now() - start,
        error: err.message,
      };
    }
  }

  /**
   * SSH 执行一条命令
   */
  private sshExec(host: string, command: string, timeoutMs: number, device: DeviceRuntimeProfile): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let output = '';
      let timer: NodeJS.Timeout;

      conn.on('ready', () => {
        conn.exec(command, { pty: { term: 'vt100', cols: 200, rows: 50 } }, (err, stream) => {
          if (err) { conn.end(); reject(err); return; }
          stream.on('data', (data: Buffer) => { output += data.toString('utf8'); });
          stream.stderr.on('data', (data: Buffer) => { output += data.toString('utf8'); });
          stream.on('close', () => { clearTimeout(timer); conn.end(); resolve(output); });
        });
      });

      conn.on('error', (err) => { clearTimeout(timer); reject(err); });

      timer = setTimeout(() => {
        conn.end();
        reject(new Error(`SSH timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      // 获取凭证
      try {
        const creds = this.getDeviceCredentials(device);
        conn.connect({
          host: host,
          port: creds.port || 22,
          username: creds.username || 'root',
          password: creds.password,
          readyTimeout: timeoutMs,
        });
      } catch (err: any) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /**
   * 获取 SSH/SNMP 凭证
   */
  private getDeviceCredentials(device: DeviceRuntimeProfile): { username?: string; password?: string; port?: number } {
    try {
      if (device.type === 'server') {
        const sv = db.prepare('SELECT username, password, port FROM servers WHERE id = ?').get(device.deviceId) as any;
        if (sv) {
          return {
            username: sv.username,
            password: sv.password ? decrypt(sv.password) : undefined,
            port: sv.port || 22,
          };
        }
      } else {
        const nd = db.prepare('SELECT username, password, ssh_port FROM network_devices WHERE id = ?').get(device.deviceId) as any;
        if (nd?.username) {
          return {
            username: nd.username,
            password: nd.password ? decrypt(nd.password) : undefined,
            port: nd.ssh_port || 22,
          };
        }
      }
    } catch {
      // fallback
    }
    return { username: 'root' };
  }

  /**
   * 简单的 SNMP GET 实现
   * 实际项目中使用 net-snmp 库
   */
  private snmpGet(host: string, community: string, oid: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let snmp: any;
      try {
        snmp = require('net-snmp');
      } catch {
        // 尝试从平台已有的 snmpService 获取
        try {
          const { getOID } = require('../../services/snmpService');
          resolve(getOID(host, community, oid));
          return;
        } catch {
          reject(new Error('net-snmp module not available'));
          return;
        }
      }

      const session = snmp.createSession(host, community, { timeout: 5000 });
      const oids = [oid];

      session.get(oids, (error: any, varbinds: any[]) => {
        session.close();
        if (error) {
          reject(error);
          return;
        }
        if (varbinds && varbinds.length > 0) {
          const vb = varbinds[0];
          if (snmp.isVarError(vb)) {
            reject(new Error(`SNMP OID ${oid} returned error: ${vb}`));
          } else {
            resolve(String(vb.value));
          }
        } else {
          reject(new Error(`No response for OID ${oid}`));
        }
      });
    });
  }
}

export const probeExecutor = new ProbeExecutor();
