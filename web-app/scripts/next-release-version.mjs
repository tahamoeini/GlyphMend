import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function git(args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

function parseVersion(tag) {
  const version = tag.replace(/^(?:glyphmend|companion)-v/, "");
  const match = version.match(/^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/);
  if (!match) return null;
  const prerelease = match.groups.prerelease?.split(".") || [];
  if (prerelease.some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"))) {
    return null;
  }
  return {
    tag,
    major: BigInt(match.groups.major),
    minor: BigInt(match.groups.minor),
    patch: BigInt(match.groups.patch),
    prerelease,
  };
}

function compareVersions(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1;
  if (right.prerelease.length === 0) return -1;
  const sharedLength = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return BigInt(leftIdentifier) < BigInt(rightIdentifier) ? -1 : 1;
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return left.prerelease.length - right.prerelease.length;
}

function latestBaseline() {
  const tags = git(["tag", "--list", "glyphmend-v*"])
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseVersion)
    .filter(Boolean)
    .sort(compareVersions);
  if (tags.length) return tags.at(-1);

  const baseVersion = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")).version;
  const version = parseVersion(`glyphmend-v${baseVersion}`);
  if (!version) throw new Error(`Root package.json has an invalid baseline version: ${baseVersion}`);

  const firstPackageHistoryEntry = git(["log", "--reverse", "--format=%H%x00%P", "--", "package.json"])
    .split(/\r?\n/)
    .find(Boolean);
  const firstPackageCommitParents = firstPackageHistoryEntry?.split("\x00")[1] || "";
  const baselineCommit = firstPackageCommitParents.split(/\s+/).find(Boolean) || "";
  return { ...version, tag: baselineCommit };
}

function commitsSince(baseline) {
  const range = baseline.tag ? `${baseline.tag}..HEAD` : "HEAD";
  const output = git(["log", "--no-merges", "--format=%s%x00%b%x1e", range]);
  return output.split("\x1e").filter(Boolean).map((record) => {
    const [subject = "", ...body] = record.split("\x00");
    return { subject: subject.trim(), body: body.join("\x00").trim() };
  });
}

function releaseImpact(commit) {
  if (/^BREAKING(?:-| )CHANGE:\s*\S+/m.test(commit.body)) return "major";
  const match = commit.subject.match(/^(?<type>[a-z][a-z0-9-]*)(?:\([^()\r\n]+\))?(?<breaking>!)?: .+$/i);
  if (!match) return "minor";
  if (match.groups.breaking) return "major";
  const type = match.groups.type.toLowerCase();
  if (type === "feat") return "minor";
  if (["fix", "perf"].includes(type)) return "patch";
  if (["build", "chore", "ci", "docs", "refactor", "revert", "style", "test"].includes(type)) return null;
  return "minor";
}

const baseline = latestBaseline();
const commits = commitsSince(baseline);
if (!commits.length) {
  throw new Error(`No commits exist after the latest version marker (${baseline.tag || "the initial workspace version"}).`);
}
const impacts = commits.map(releaseImpact).filter(Boolean);
if (!impacts.length) {
  throw new Error("No release-bearing commits exist since the latest version. Use feat/fix/perf or a breaking change.");
}

const level = impacts.includes("major") ? "major" : impacts.includes("minor") ? "minor" : "patch";
const next = { ...baseline };
if (level === "major") {
  next.major += 1n;
  next.minor = 0n;
  next.patch = 0n;
} else if (level === "minor") {
  next.minor += 1n;
  next.patch = 0n;
} else {
  next.patch += 1n;
}

console.log(`${next.major}.${next.minor}.${next.patch}-beta.1`);
