import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const candidates = process.platform === "win32"
  ? [["py", "-3"], ["python"], ["python3"]]
  : [["python3"], ["python"], ["py", "-3"]];

for (const candidate of candidates) {
  const check = spawnSync(candidate[0], [...candidate.slice(1), "-c", "import sys"], { stdio: "ignore" });
  if (check.status === 0) {
    const child = spawnSync(candidate[0], [...candidate.slice(1), ...args], { stdio: "inherit" });
    process.exit(child.status ?? 1);
  }
}

console.error("Python 3 was not found. Install Python 3.10+ and try again.");
process.exit(1);
