import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(
  new URL("../../../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const guide = readFileSync(
  new URL("../../../docs/26-ec2-and-expo-deployment.md", import.meta.url),
  "utf8",
);
const remote = workflow.split(
  "          set -euo pipefail\n          umask 077\n          export IMAGE_TAG=",
)[1];
if (!remote) throw new Error("Deployment block was not found");
const start = remote.indexOf("          check_retention() {");
const end = remote.indexOf("          check_retention\n", start);
const guards = remote.slice(start, end).replace(/^ {10}/gm, "");
const bash =
  process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";

function runGuards(mode: string) {
  const script = `
set -euo pipefail
mode=${mode}
mock_phase=before
docker_root=/docker
postgres_path=/postgres
redis_path=/redis
IMAGE_TAG=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
DOCKERHUB_USERNAME=fixture
timeout() { shift; "$@"; }
find() {
  if [[ "$*" == *partial* ]]; then
    if [[ "$mode" == partial ]]; then printf 'backups/predeploy-test.dump.partial\\n'; fi
  elif [[ "$mode" == dumps ]]; then printf 'one\\ntwo\\nthree\\n'; fi
}
docker() {
  if [[ "$mode" == images ]]; then printf '%s\\n' bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb cccccccccccccccccccccccccccccccccccccccc dddddddddddddddddddddddddddddddddddddddd; fi
}
sudo() {
  shift
  if [[ "$1" == du ]]; then
    if [[ "$mode" == du-failure ]]; then return 1; fi
    printf '8192 /postgres\\n'
  else
    if [[ "$mode" == df-failure ]]; then return 1; fi
    available=999999999
    if [[ "$mode" == low-before || ( "$mode" == low-after && "$mock_phase" == after ) || ( "$mode" == low-dump && "$mock_phase" == dump ) ]]; then available=1; fi
    if [[ "$mode" == boundary ]]; then
      available=5259264
      if [[ "$mock_phase" == before ]]; then available=17842176; fi
    fi
    printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\n/dev/test 999999999 1 %s 1%% /\\n' "$available"
  fi
}
${guards}
check_retention
check_space before-pull $((12 * 1024 * 1024))
printf 'PULL\\n'
mock_phase=after
check_space after-pull 0
printf 'PAUSE\\n'
mock_phase=dump
check_space before-dump 0
printf 'DUMP\\n'
`;
  return spawnSync(bash, ["--noprofile", "--norc", "-s"], {
    input: script,
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("manual and automated deployment use identical guards before irreversible steps", () => {
  expect(guide).toContain(guards.trim());
  expect(remote.indexOf("check_space before-pull")).toBeLessThan(
    remote.indexOf('"${compose[@]}" pull'),
  );
  expect(remote.indexOf("check_space after-pull")).toBeLessThan(
    remote.indexOf("writers_stopped=true"),
  );
  expect(remote.indexOf("check_space before-dump")).toBeLessThan(
    remote.indexOf("pg_dump"),
  );
  expect(remote).not.toMatch(/(?:system|volume|image) prune|down --volumes/);
});

for (const mode of ["success", "boundary"])
  test(`disk checks accept ${mode}`, () => {
    const result = runGuards(mode);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("PULL\nPAUSE\nDUMP\n");
  });

for (const mode of [
  "low-before",
  "df-failure",
  "du-failure",
  "dumps",
  "partial",
  "images",
])
  test(`${mode} stops before pulling or pausing writers`, () => {
    const result = runGuards(mode);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("PULL");
    expect(result.stdout).not.toContain("PAUSE");
  });

test("space lost during pull prevents pausing writers", () => {
  const result = runGuards("low-after");
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("PULL\n");
});

test("space lost after the pause prevents starting a partial dump", () => {
  const result = runGuards("low-dump");
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("PULL\nPAUSE\n");
});
