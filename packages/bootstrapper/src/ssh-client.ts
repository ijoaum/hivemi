// =============================================================================
// SSH Client
// Thin wrapper around Node.js child_process to execute commands on remote VMs.
// Uses the system `ssh` binary — no native SSH library needed.
// =============================================================================

import { execFile } from "node:child_process";
import { writeFile as fsWriteFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ISSHClient,
  SSHClientConfig,
  SSHExecResult,
  BootstrapperLogger,
} from "./types.js";
import { consoleLogger } from "./types.js";

/**
 * SSH client using the system `ssh` and `scp` binaries.
 *
 * Why not a library? The system SSH binary handles key formats, agent
 * forwarding, and ProxyCommand natively. One less native dep to build.
 */
export class SSHClient implements ISSHClient {
  private _connected = false;
  private keyPath: string | null = null;
  private tmpDir: string | null = null;
  private readonly config: Required<SSHClientConfig>;
  private readonly log: BootstrapperLogger;

  constructor(config: SSHClientConfig, logger?: BootstrapperLogger) {
    this.config = {
      connectTimeoutMs: 30_000,
      execTimeoutMs: 300_000,
      ...config,
    };
    this.log = logger ?? consoleLogger;
  }

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Write the private key to a temp file and test the connection.
   */
  async connect(): Promise<void> {
    this.log.info(`Connecting to ${this.config.username}@${this.config.host}:${this.config.port}`);

    // Write private key to temp file
    this.tmpDir = await mkdtemp(join(tmpdir(), "hivemi-ssh-"));
    this.keyPath = join(this.tmpDir, "key");
    await fsWriteFile(this.keyPath, this.config.privateKey, { mode: 0o600 });

    // Test connection with a simple echo
    const result = await this.rawExec("echo hivemi-ok", this.config.connectTimeoutMs);
    if (result.exitCode !== 0 || !result.stdout.includes("hivemi-ok")) {
      throw new Error(
        `SSH connection test failed (exit ${result.exitCode}): ${result.stderr}`,
      );
    }

    this._connected = true;
    this.log.info(`Connected to ${this.config.host}`);
  }

  /**
   * Execute a command on the remote host.
   */
  async exec(command: string): Promise<SSHExecResult> {
    if (!this._connected || !this.keyPath) {
      throw new Error("SSH client not connected — call connect() first");
    }

    this.log.debug(`exec: ${command.slice(0, 200)}${command.length > 200 ? "..." : ""}`);
    return this.rawExec(command, this.config.execTimeoutMs);
  }

  /**
   * Upload a string as a file on the remote host.
   * Uses a heredoc over SSH rather than scp for simplicity.
   */
  async writeFile(remotePath: string, content: string, mode?: string): Promise<void> {
    if (!this._connected || !this.keyPath) {
      throw new Error("SSH client not connected — call connect() first");
    }

    this.log.debug(`writeFile: ${remotePath} (${content.length} bytes)`);

    // Use base64 encoding to avoid shell escaping issues
    const b64 = Buffer.from(content, "utf-8").toString("base64");

    // Create parent directory, decode content, set permissions
    const dir = remotePath.replace(/\/[^/]+$/, "");
    let cmd = `mkdir -p ${dir} && echo '${b64}' | base64 -d > ${remotePath}`;
    if (mode) {
      cmd += ` && chmod ${mode} ${remotePath}`;
    }

    const result = await this.exec(cmd);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to write ${remotePath} (exit ${result.exitCode}): ${result.stderr}`,
      );
    }
  }

  /**
   * Check if a file exists on the remote host.
   */
  async fileExists(remotePath: string): Promise<boolean> {
    const result = await this.exec(`test -f ${remotePath} && echo EXISTS || echo MISSING`);
    return result.stdout.trim() === "EXISTS";
  }

  /**
   * Disconnect and clean up temp files.
   */
  async disconnect(): Promise<void> {
    this._connected = false;

    if (this.keyPath) {
      try {
        await unlink(this.keyPath);
      } catch {
        // ignore cleanup errors
      }
      this.keyPath = null;
    }

    if (this.tmpDir) {
      try {
        await unlink(this.tmpDir).catch(() => {});
      } catch {
        // ignore
      }
      this.tmpDir = null;
    }

    this.log.debug("Disconnected");
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private rawExec(command: string, timeoutMs: number): Promise<SSHExecResult> {
    return new Promise((resolve, reject) => {
      const args = [
        "-i", this.keyPath!,
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", `ConnectTimeout=${Math.ceil(timeoutMs / 1000)}`,
        "-o", "BatchMode=yes",
        "-o", "LogLevel=ERROR",
        "-p", String(this.config.port),
        `${this.config.username}@${this.config.host}`,
        command,
      ];

      const child = execFile("ssh", args, {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        encoding: "utf-8",
      }, (error, stdout, stderr) => {
        if (error && !("code" in error)) {
          // Timeout or signal — not a normal exit
          reject(new Error(`SSH command timed out or was killed: ${error.message}`));
          return;
        }

        resolve({
          exitCode: (error as NodeJS.ErrnoException & { code?: number })?.code
            ?? (typeof (error as any)?.code === "number" ? (error as any).code : 0),
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      });

      // Safety: kill if the child doesn't exit
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, timeoutMs + 5000);

      child.on("close", () => clearTimeout(timer));
    });
  }
}
