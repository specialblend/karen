# KAREN

**KAREN** is an AI-assisted tool that helps you refine your JIRA backlog.

The recursive backronym stands for **KAREN: Assisted Review, Estimation, &
Nitpicking**.

## Features

- Edit JIRA Software issues using markdown
  - [x] from your command line
  - [x] from your favorite editor
- Interactively prune old issues from your backlog
  - [x] List old issues using a threshold of age
  - [ ] Delete old issues
- Use Local AI to review your backlog
  - [x] Review and score issues for clear acceptance criteria and expected
        outcomes
  - [x] Estimate story points
  - [ ] Suggest improvements

## Installation

- Install [Ollama](https://ollama.com)
- Install [Deno](https://docs.deno.com/runtime/getting_started/installation/)
- Run this command to install `karen`:
  ```shell
  deno install --global --allow-run --allow-env --allow-read --allow-write --allow-net --unstable-kv https://raw.githubusercontent.com/specialblend/karen/main/karen.ts
  ```

## Usage

### Quick Start

#### Setup Ollama

- Ensure Ollama is running on your local machine. By default, KAREN will look
  for Ollama at `http://localhost:11434`

- Review `.karen/settings.json` in your home directory.

**Important!** Check the models in `.karen/settings.json` and make sure you
**choose a model size that will fit into your VRAM**.

#### Configure KAREN with your JIRA credentials:

```shell
karen config setup
```

#### Pull issues from a JIRA project into your local storage:

If your tickets look like EXAMPLE-1234, you can pull them like this:

```shell
karen pull project EXAMPLE
```

#### Review, estimate, and generate a report for an issue using AI:

```shell
karen report EXAMPLE-1234
```

You can also generate a report for all issues

```shell
karen report --all
```

#### Publish your report to JIRA as a comment:

```shell
karen report EXAMPLE-1234 --publish
```

You can also publish all reports:

```shell
karen report --all --publish
```

### Command Line Reference

#### Configuration

- `karen config setup` - Interactive setup of JIRA credentials
- `karen config show` - List all configuration values
- `karen config remove [key]` - Remove configuration value(s)
  - `--all` Remove all configuration values
  - `--force` Remove without confirmation

#### Project Management

- `karen pull project <project-key>` - Pull all issues for a project
- `karen pull issue <issue-key>` - Pull a specific issue from JIRA
- `karen push <issue-key>` - Push local changes to JIRA

#### Issue Management

- `karen edit <issue-key>` - Edit an issue in your preferred editor
- `karen diff <issue-key>` - Show differences between local and remote versions
- `karen prune <days>` - List old issues
  - `--created` Filter by created date instead of updated date

#### AI Features

- `karen review [issue-key]` - Review issue(s) using AI
  - `--all` Review all stored issues
  - `--force` Force new review even if cached
  - `--model <model>` Specify Ollama model
- `karen estimate [issue-key]` - Estimate story points using AI
  - `--all` Estimate all stored issues
  - `--reviewed` Estimate only previously reviewed issues
  - `--force` Force new estimate even if cached
  - `--model <model>` Specify Ollama model
- `karen report [issue-key]` - Generate AI review and estimate report
  - `--all` Report on all stored issues
  - `--publish` Post report as JIRA comment
  - `--force` Force new review and estimate
  - `--model <model>` Specify Ollama model

#### Data Management

- `karen list|ls` - List stored data
  - `projects` List stored projects
  - `boards` List stored boards
  - `issues` List stored issues
  - `comments` List stored comments
  - `edits` List stored edits
  - `reviews` List stored reviews
  - `estimates` List stored estimates
  - `reports` List stored reports
  - Options:
    - `--details` Show full details
    - `--format <format>` Output as json or yaml

- `karen get <key>` - Get stored data
  - `issue <issue-key>` Get stored issue
  - `edit <issue-key>` Get stored edit
  - `project <project-key>` Get stored project
  - `board <board-name>` Get stored board
  - `review <issue-key>` Get stored review
  - `estimate <issue-key>` Get stored estimate
  - `report <issue-key>` Get stored report

- `karen remove|rm` - Remove stored data
  - Same subcommands as `get`, with options:
    - `--all` Remove all items of that type
    - `--force` Remove without confirmation

#### System

- `karen path` - Show storage directory path
  - `--storage` Show storage DB file path
  - `--settings` Show settings file path
- `karen settings` - Show current settings
  - `--edit` Open settings in editor
- `karen info` - Show summary of stored data

Common Options:

- Most commands support `--format yaml|json|markdown` for output formatting
- Use `karen --help` or `karen [command] --help` for detailed help
