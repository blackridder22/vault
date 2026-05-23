#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import fs from "fs-extra";
import ignore, { type Ignore } from "ignore";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

const DEFAULT_IGNORE = `__pycache__/
.agents/
.claude/
.codex/
.cursor/
.DS_Store
.env
.env.*
.env.local
.env.*.local
.next/
.opencode/
.pnp/
.pnp.js
.turbo/
.vercel/
.yarn/install-state.gz
*.log
*.pem
*.pyc
*.tsbuildinfo
.git/
build/
coverage/
node_modules/
out/
dist/
logs/
next-env.d.ts
npm-debug.log*
yarn-debug.log*
yarn-error.log*
video/node_modules/
`;

type BackupResult = {
  source: string;
  destination: string;
  overwritten: boolean;
};

function vaultDir(): string {
  return path.join(os.homedir(), ".vault");
}

function projectsDir(): string {
  return path.join(vaultDir(), "projects");
}

function tmpDir(): string {
  return path.join(vaultDir(), "tmp");
}

function configDir(): string {
  return path.join(vaultDir(), "config");
}

function globalIgnorePath(): string {
  return path.join(configDir(), "ignore.txt");
}

function toPosix(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

function displayHome(filePath: string): string {
  const home = os.homedir();

  if (filePath === home) {
    return "~";
  }

  if (filePath.startsWith(`${home}${path.sep}`)) {
    return `~${filePath.slice(home.length)}`;
  }

  return filePath;
}

function detectGitRoot(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

async function resolveSourceRoot(inputPath?: string): Promise<string> {
  const source = inputPath
    ? path.resolve(inputPath)
    : detectGitRoot() ?? process.cwd();

  const exists = await fs.pathExists(source);

  if (!exists) {
    throw new Error(`Source not found: ${source}`);
  }

  const stats = await fs.stat(source);

  if (!stats.isDirectory()) {
    throw new Error(`Source is not a directory: ${source}`);
  }

  return source;
}

async function ensureGlobalIgnoreFile(): Promise<void> {
  const ignorePath = globalIgnorePath();
  await fs.ensureDir(path.dirname(ignorePath));

  if (!(await fs.pathExists(ignorePath))) {
    await fs.outputFile(ignorePath, DEFAULT_IGNORE, "utf8");
  }
}

async function loadIgnoreFile(ignorePath: string): Promise<Ignore> {
  const matcher = ignore();

  if (await fs.pathExists(ignorePath)) {
    matcher.add(await fs.readFile(ignorePath, "utf8"));
  }

  return matcher;
}

function isIgnored(matcher: Ignore, relativePath: string, isDirectory: boolean): boolean {
  if (matcher.ignores(relativePath)) {
    return true;
  }

  return isDirectory && matcher.ignores(`${relativePath}/`);
}

async function createCopyFilter(sourceRoot: string): Promise<(sourcePath: string) => Promise<boolean>> {
  await ensureGlobalIgnoreFile();

  const globalMatcher = await loadIgnoreFile(globalIgnorePath());
  const projectMatcher = await loadIgnoreFile(path.join(sourceRoot, ".gitignore"));

  return async (sourcePath: string): Promise<boolean> => {
    const relativePath = path.relative(sourceRoot, sourcePath);

    if (!relativePath) {
      return true;
    }

    const normalizedPath = toPosix(relativePath);
    const stats = await fs.lstat(sourcePath);

    return !(
      isIgnored(globalMatcher, normalizedPath, stats.isDirectory()) ||
      isIgnored(projectMatcher, normalizedPath, stats.isDirectory())
    );
  };
}

async function backupProject(inputPath?: string): Promise<BackupResult> {
  const sourceRoot = await resolveSourceRoot(inputPath);
  const projectName = path.basename(sourceRoot);
  const destination = path.join(projectsDir(), projectName);
  const temporaryDestination = path.join(tmpDir(), `${projectName}-tmp`);
  const filter = await createCopyFilter(sourceRoot);

  await fs.ensureDir(projectsDir());
  await fs.ensureDir(tmpDir());
  await fs.remove(temporaryDestination);

  try {
    await fs.copy(sourceRoot, temporaryDestination, {
      filter,
      overwrite: true,
      errorOnExist: false,
      dereference: false
    });
  } catch (error) {
    await fs.remove(temporaryDestination).catch(() => undefined);
    throw error;
  }

  const overwritten = await fs.pathExists(destination);

  await fs.remove(destination);
  await fs.move(temporaryDestination, destination, {
    overwrite: false
  });

  return {
    source: sourceRoot,
    destination,
    overwritten
  };
}

async function listProjects(): Promise<string[]> {
  const dir = projectsDir();

  if (!(await fs.pathExists(dir))) {
    return [];
  }

  const entries = await fs.readdir(dir, {
    withFileTypes: true
  });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function isValidProjectName(projectName: string): boolean {
  return (
    projectName.length > 0 &&
    projectName !== "." &&
    projectName !== ".." &&
    !projectName.includes("/") &&
    !projectName.includes("\\")
  );
}

async function deleteProject(projectName: string): Promise<boolean> {
  if (!isValidProjectName(projectName)) {
    return false;
  }

  const target = path.join(projectsDir(), projectName);

  if (!(await fs.pathExists(target))) {
    return false;
  }

  await fs.remove(target);
  return true;
}

function createProgram(): Command {
  return new Command()
    .name("vault")
    .description("Minimal local project backup CLI.")
    .version(packageJson.version, "-v, --version", "display version")
    .helpOption("-h, --help", "display help")
    .option("-b, --backup [path]", "backup the current project or a project path")
    .option("-l, --list", "list saved projects")
    .option("--delete <project-name>", "delete a saved project");
}

async function main(): Promise<void> {
  const program = createProgram();
  program.parse(process.argv);

  const options = program.opts<{
    backup?: true | string;
    list?: boolean;
    delete?: string;
  }>();

  const selectedActions = [
    options.backup !== undefined,
    options.list === true,
    options.delete !== undefined
  ].filter(Boolean).length;

  if (selectedActions === 0) {
    program.outputHelp();
    return;
  }

  if (selectedActions > 1) {
    throw new Error("Use one command at a time.");
  }

  if (options.backup !== undefined) {
    const backupPath = options.backup === true ? undefined : options.backup;
    const result = await backupProject(backupPath);

    console.log("Vault backup");
    console.log(`Source: ${result.source}`);
    console.log(`Destination: ${displayHome(result.destination)}`);
    console.log(`Status: backup ${result.overwritten ? "overwritten" : "created"}`);
    return;
  }

  if (options.list) {
    const projects = await listProjects();

    if (projects.length === 0) {
      console.log("No saved projects found.");
      return;
    }

    console.log("Saved projects:");
    for (const project of projects) {
      console.log(`- ${project}`);
    }
    return;
  }

  if (options.delete !== undefined) {
    const deleted = await deleteProject(options.delete);
    console.log(deleted ? `Deleted: ${options.delete}` : `Project not found: ${options.delete}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
