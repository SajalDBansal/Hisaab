import {
  backupEnabled,
  readBackupConfig,
  BackupError,
  backupErrorCode,
} from "./config";
import { backupClient } from "./state";
import { createBackupStorage } from "./storage";
import { createBackupService } from "./runner";
import { parseOperatorCommand, runOperatorAction } from "./operatorActions";

function print(value: string) {
  process.stdout.write(`${value}\n`);
}

// Host-only controls: no HTTP route exposes the installation database or bucket.
async function main() {
  const command = parseOperatorCommand(process.argv.slice(2));
  const config = readBackupConfig();
  const enabled = backupEnabled();
  if (command.kind === "run") {
    if (!enabled) throw new BackupError("BACKUP_DISABLED");
    const service = createBackupService(config, {
      info: (data, message) => print(JSON.stringify({ message, ...data })),
      warn: (data, message) =>
        process.stderr.write(`${JSON.stringify({ message, ...data })}\n`),
    });
    const abort = () => service.abort();
    process.once("SIGTERM", abort);
    process.once("SIGINT", abort);
    try {
      print(
        JSON.stringify(
          await service.run({
            force: true,
            approveCountDrop: command.approveCountDrop,
          }),
        ),
      );
    } finally {
      process.off("SIGTERM", abort);
      process.off("SIGINT", abort);
      await service.close();
    }
    return;
  }
  const client = backupClient(config);
  const stopped = new AbortController();
  const abort = () => stopped.abort();
  client.on("error", abort);
  process.once("SIGTERM", abort);
  process.once("SIGINT", abort);
  const storage = createBackupStorage(config);
  try {
    await client.connect();
    const result = await runOperatorAction(command, {
      client,
      storage,
      config,
      enabled,
      signal: stopped.signal,
    });
    print(
      typeof result === "string" ? result : JSON.stringify(result, null, 2),
    );
  } finally {
    process.off("SIGTERM", abort);
    process.off("SIGINT", abort);
    try {
      await client.end();
    } finally {
      storage.close();
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${backupErrorCode(error)}\n`);
  process.exitCode = 1;
});
