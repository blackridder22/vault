# Vault

Minimal local project backup CLI.

Vault copies a development project into a hidden local folder:

```text
~/.vault/projects/<project-name>/
```

It is not Git. It does not create version history, archives, cloud backups, or restore workflows.

## Installation

```bash
npm install -g @blackridder22/vault
```

For local development from this repository:

```bash
npm install
npm run build
npm link
```

## Commands

Backup the current project:

```bash
vault --backup
vault -b
```

Backup a specific project:

```bash
vault --backup /path/to/project
vault -b /path/to/project
```

List saved projects:

```bash
vault --list
vault -l
```

Delete a saved project:

```bash
vault --delete sonoa-search
```

Show help:

```bash
vault --help
vault -h
```

Show version:

```bash
vault --version
vault -v
```

## How Backups Work

When you run `vault -b`, Vault uses this source:

1. The path passed after `--backup` or `-b`, if provided.
2. The Git root from `git rev-parse --show-toplevel`, if the current folder is inside a Git repo.
3. The current folder from `process.cwd()`.

The project name is the source folder name. For example:

```text
/Users/me/projects/sonoa-search
```

is saved to:

```text
~/.vault/projects/sonoa-search/
```

If a backup with the same project name already exists, Vault overwrites it. It first copies the project into `~/.vault/tmp/<project-name>-tmp`. Only after that copy succeeds does it remove the previous backup and move the temporary copy into `~/.vault/projects/<project-name>/`.

## Ignore Rules

Vault respects the project's root `.gitignore`.

Vault also uses a global ignore file:

```text
~/.vault/config/ignore.txt
```

If that file does not exist, Vault creates it automatically with default rules for common folders and files such as `.git/`, `node_modules/`, `.next/`, `dist/`, `build/`, `.env`, logs, and caches.

The ignore file supports gitignore-style rules, including `!` negation rules.
