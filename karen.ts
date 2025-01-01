#! /usr/bin/env -S deno run --allow-run --allow-env --allow-read --allow-write --allow-net --unstable-kv

import { Ollama } from "npm:ollama";
import { Command } from "npm:commander";
import * as Fmt from "jsr:@std/fmt/colors";

import { AssistantService } from "./src/Assistant.ts";
import { AuthoringService, Edit } from "./src/Authoring.ts";
import { ConfigStore, KnownConfigParams, remember } from "./src/Config.ts";
import { Console } from "./src/Console.ts";
import { EstimateStore } from "./src/Estimate.ts";
import { ReviewStore } from "./src/Review.ts";
import { SettingsV1 } from "./src/Settings.ts";
import { Store } from "./src/Store.ts";

import {
  BoardStore,
  EditStore,
  Issue,
  IssueService,
  IssueStore,
  MyCommentStore,
  ProjectStore,
} from "./src/Issue.ts";

import {
  getSettings,
  getSettingsPath,
  getStorage,
  getStorageDir,
  getStoragePath,
  relativeDate,
  touchStorageDir,
} from "./src/System.ts";

import { ReportingService, ReportStore } from "./src/Reporting.ts";

const console = Console();

export function ListResource<T>(store: Store<T>) {
  return async function listResource(
    options: { details?: boolean; format?: string } = {},
  ) {
    if (options.details) {
      return await Array
        .fromAsync(store.list())
        .then((data) => console.print(data, options.format))
        .catch(console.die);
    }
    return await Array
      .fromAsync(store.keys())
      .then((data) => console.print(data, options.format))
      .catch(console.die);
  };
}

export function GetResource<T>(store: Store<T>) {
  return async function getResource(
    key: string,
    options: { format?: string } = {},
  ) {
    if (!key) return console.die("key required");
    return await store
      .get(key)
      .then((data) => console.print(data, options?.format))
      .catch(console.expect("Not found"));
  };
}

export function RemoveResource<T>(store: Store<T>) {
  return async function removeResource(
    key: string,
    options: { all?: boolean; force?: boolean } = {},
  ) {
    if (!options.all) {
      if (key) return await store.remove(key);
      return console.die("key required when not using --all");
    }
    if (options.force || confirm("Delete all items?")) {
      return await store.removeAll();
    }
    return console.warn("aborted");
  };
}

export async function main() {
  const storageDir = await touchStorageDir();
  const storage = await getStorage(storageDir)
    .catch((err) => {
      console.error(err);
      console.error("Failed to initialize storage");
      Deno.exit(1);
    });

  const settings = await getSettings(storageDir)
    .catch((err) => {
      console.error(err);
      console.die("Failed to load settings");
    });

  const program = new Command();

  program
    .name("karen")
    .description("KAREN: Assisted Review, Estimation, and Nitpicking")
    .version("1.0.0");

  program
    .command("path")
    .description("Show the path to local storage directory")
    .option("--storage", "Show the path to local storage DB file")
    .option("--settings", "Show the path to local settings.json file")
    .action(
      function printPath(options: { storage?: boolean; settings?: boolean }) {
        if (options.storage) {
          return console.log(getStoragePath(storageDir).pathname);
        }
        if (options.settings) {
          return console.log(getSettingsPath(storageDir).pathname);
        }
        return console.log(storageDir.pathname);
      },
    );

  const config_ = program
    .command("config")
    .description("Manage configuration");

  config_.addCommand(
    new Command("setup")
      .description("Interactive setup of user configuration")
      .action(
        async function setupConfig() {
          for (const param of KnownConfigParams.values()) {
            await remember(param, { force: true }, storage);
          }
        },
      ),
  );

  config_.addCommand(
    new Command("show")
      .description("List all configuration values")
      .option("-o, --format <format>", "json or yaml", "yaml")
      .action(
        async function showConfig(options: { format?: string }) {
          const config = ConfigStore(storage);
          const data = new Map<string, string>();
          for (const param of KnownConfigParams.values()) {
            const value = await config.get(param.key);
            data.set(param.key, console.mask(param, value));
          }
          if (data.size === 0) return console.warn("No config values found");
          const configObj = Object.fromEntries(data);
          return console.print(configObj, options.format);
        },
      ),
  );

  config_.addCommand(
    new Command("remove")
      .description("Remove configuration value(s)")
      .argument("[key]", "Configuration key to delete")
      .option("--all", "Delete all configuration values")
      .option("--force", "Delete without confirmation")
      .action(RemoveResource(ConfigStore(storage))),
  );

  program
    .command("settings")
    .description("Show or edit settings")
    .option("--edit", "Open settings file in $EDITOR")
    .option("-o, --format <format>", "json or yaml", "yaml")
    .action(
      async function showSettings(
        settings: SettingsV1,
        options: { edit?: boolean; format?: string },
      ) {
        if (options.edit) {
          const storageDir = getStorageDir();
          const settingsPath = getSettingsPath(storageDir);
          const editor = Deno.env.get("EDITOR") || "nano";
          const inherit = {
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
          } as const;
          const args = [settingsPath.pathname];
          const options = { args, ...inherit };
          const process = new Deno.Command(editor, options);
          await process.output();
          return;
        }
        console.print(settings, options.format);
        return console.info(
          Fmt.blue("Note: you can edit settings with `karen settings --edit`"),
        );
      },
    );

  program
    .command("info")
    .description("Show summary information about the locally stored data")
    .option("-o, --format <format>", "json or yaml", "yaml")
    .action(
      async function info(options = settings.printer) {
        const id = await storage.get(["meta", "id"])
          .then((id) => id.value)
          .catch(() => "none");
        const issues = await Array.fromAsync(IssueStore(storage).keys());
        const projects = await Array.fromAsync(ProjectStore(storage).keys());
        const boards = await Array.fromAsync(BoardStore(storage).keys());
        const reviews = await Array.fromAsync(ReviewStore(storage).keys());
        const estimates = await Array.fromAsync(EstimateStore(storage).keys());
        const edits = await Array.fromAsync(EditStore(storage).keys());
        const output = {
          id,
          issues: {
            total: issues.length,
            reviewed: reviews.length,
            estimated: estimates.length,
            edited: edits.length,
          },
          projects: { total: projects.length },
          boards: { total: boards.length },
        };
        console.print(output, options.format);
      },
    );

  const list = program
    .command("list")
    .alias("ls")
    .description("List stored data");

  list
    .addCommand(
      new Command("projects")
        .description("List all stored projects")
        .option("--details", "Show full project details")
        .option("-o, --format <format>", "json or yaml", "yaml")
        .action(ListResource(ProjectStore(storage))),
    );

  list
    .addCommand(
      new Command("boards")
        .description("List all stored boards")
        .option("--details", "Show full board details")
        .option("-o, --format <format>", "json or yaml", "yaml")
        .action(ListResource(BoardStore(storage))),
    );

  list
    .addCommand(
      new Command("issues")
        .description("List all stored issues")
        .option("--details", "Show full issue details")
        .option("-o, --format <format>", "json or yaml", "yaml")
        .action(ListResource(IssueStore(storage))),
    );

  list
    .addCommand(
      new Command("my-comments")
        .description("List all stored comments")
        .option("--details", "Show full comment details")
        .option("-o, --format <format>", "json or yaml", "yaml")
        .action(ListResource(MyCommentStore(storage))),
    );

  list
    .addCommand(
      new Command("edits")
        .description("List all stored edits")
        .option("--details", "Show full edit details")
        .option("-o, --format <format>", "json or yaml", "yaml")
        .action(ListResource(EditStore(storage))),
    );

  list
    .addCommand(
      new Command("reviews")
        .description("List all stored reviews")
        .option("--details", "Show full review details")
        .option("-o, --format <format>", "json or yaml", "yaml")
        .action(ListResource(ReviewStore(storage))),
    );

  list
    .addCommand(
      new Command("estimates")
        .description("List all stored estimates")
        .option("--details", "Show full estimate details")
        .option("-o, --format <format>", "json or yaml", "yaml")
        .action(ListResource(EstimateStore(storage))),
    );

  list
    .addCommand(
      new Command("reports")
        .description("List all stored reports")
        .option("--details", "Show full report details")
        .option("-o, --format <format>", "json or yaml", "yaml")
        .action(ListResource(ReportStore(storage))),
    );

  const get = program
    .command("get")
    .description("Get stored data")
    .argument("[key]", "Key to get");

  get.addCommand(
    new Command("issue")
      .description("Get stored issue")
      .argument("[issue-key]", "JIRA issue key")
      .option("-o, --format <format>", "json or yaml", "yaml")
      .action(
        async function getIssue(
          key: string,
          options: { format?: string } = {},
        ) {
          const authoring = AuthoringService(settings);
          const issue = await IssueStore(storage)
            .get(key)
            .catch(console.expect("Issue not found"));
          if (options.format === "markdown") {
            return console.log(authoring.serialize(issue));
          }
          return console.print(issue, options.format);
        },
      ),
  );

  get.addCommand(
    new Command("edit")
      .description("Get stored edit")
      .argument("[issue-key]", "JIRA issue key")
      .option("-o, --format <format>", "json, yaml, or markdown", "yaml")
      .action(
        async function getEdit(
          key: string,
          options: { format?: string } = {},
        ) {
          const authoring = AuthoringService(settings);
          const edit = await EditStore(storage)
            .get(key)
            .catch(console.expect("Edit not found"));
          if (options.format === "markdown") {
            return console.log(authoring.serialize(edit));
          }
          return console.print(edit, options.format);
        },
      ),
  );

  get.addCommand(
    new Command("project")
      .description("Get stored project")
      .argument("[project-key]", "JIRA project key")
      .option("-o, --format <format>", "Output format (json or yaml)", "yaml")
      .action(GetResource(ProjectStore(storage))),
  );

  get.addCommand(
    new Command("board")
      .description("Get stored board")
      .argument("[board-name]", "JIRA board name")
      .option("-o, --format <format>", "Output format (json or yaml)", "yaml")
      .action(GetResource(BoardStore(storage))),
  );

  get.addCommand(
    new Command("review")
      .description("Get stored review")
      .argument("[issue-key]", "JIRA issue key")
      .option("-o, --format <format>", "Output format (json or yaml)", "yaml")
      .action(GetResource(ReviewStore(storage))),
  );

  get.addCommand(
    new Command("estimate")
      .description("Get stored estimate")
      .argument("[issue-key]", "JIRA issue key")
      .option("-o, --format <format>", "Output format (json or yaml)", "yaml")
      .action(GetResource(EstimateStore(storage))),
  );

  get.addCommand(
    new Command("report")
      .description("Get stored report")
      .argument("[issue-key]", "JIRA issue key")
      .option("-o, --format <format>", "Output format (json or yaml)", "yaml")
      .action(GetResource(ReportStore(storage))),
  );

  const remove = program
    .command("remove")
    .alias("rm")
    .description("Remove stored data");

  remove.addCommand(
    new Command("issue")
      .description("Remove stored issue(s)")
      .argument("[issue-key]", "JIRA issue key")
      .option("--all", "Delete all issues")
      .option("--force", "Delete without confirmation")
      .action(RemoveResource(IssueStore(storage))),
  );

  remove.addCommand(
    new Command("edit")
      .description("Remove stored edit(s)")
      .argument("[issue-key]", "JIRA issue key")
      .option("--all", "Delete all edits")
      .option("--force", "Delete without confirmation")
      .action(RemoveResource(EditStore(storage))),
  );

  remove.addCommand(
    new Command("project")
      .description("Remove stored project(s)")
      .argument("[project-key]", "JIRA project key")
      .option("--all", "Delete all projects")
      .option("--force", "Delete without confirmation")
      .action(RemoveResource(ProjectStore(storage))),
  );

  remove.addCommand(
    new Command("board")
      .description("Remove stored board(s)")
      .argument("[board-name]", "JIRA board name")
      .option("--all", "Delete all boards")
      .option("--force", "Delete without confirmation")
      .action(RemoveResource(BoardStore(storage))),
  );

  remove.addCommand(
    new Command("review")
      .description("Remove stored review(s)")
      .argument("[issue-key]", "JIRA issue key")
      .option("--all", "Delete all reviews")
      .option("--force", "Delete without confirmation")
      .action(RemoveResource(ReviewStore(storage))),
  );

  remove.addCommand(
    new Command("estimate")
      .description("Remove stored estimate(s)")
      .argument("[issue-key]", "JIRA issue key")
      .option("--all", "Delete all estimates")
      .option("--force", "Delete without confirmation")
      .action(RemoveResource(EstimateStore(storage))),
  );

  remove.addCommand(
    new Command("report")
      .description("Remove stored report(s)")
      .argument("[issue-key]", "JIRA issue key")
      .option("--all", "Delete all reports")
      .option("--force", "Delete without confirmation")
      .action(RemoveResource(ReportStore(storage))),
  );

  const pull = program
    .command("pull")
    .description("Pull issues from JIRA");

  pull.addCommand(
    new Command("project")
      .description("Pull all issues for a specific project")
      .argument("<project-key>", "JIRA project key")
      .option("-o, --format <format>", "Output format (json or yaml)", "yaml")
      .action(
        async function pullProject(projectKey: string) {
          const issueService = IssueService(storage);
          await issueService.pullProjects();
          const project = await ProjectStore(storage)
            .get(projectKey)
            .catch(console.expect("Project not found"));
          const boards = await issueService
            .pullBoards(project)
            .catch(console.expect("Failed to pull boards"));
          const projectBoards = boards
            .filter((b) => b.location?.projectKey === projectKey)
            .map((board) => board.name);
          if (projectBoards.length === 0) {
            return console.warn("No boards found");
          }
          let total = 0;
          for (const boardName of projectBoards) {
            const board = await BoardStore(storage)
              .get(boardName)
              .catch(console.expect("Board not found"));
            const issues = await issueService
              .pullIssues(board)
              .catch(console.expect("Failed to pull issues"));
            total += issues.length;
          }
          return console.info(`${total} issues`);
        },
      ),
  );

  pull.addCommand(
    new Command("issue")
      .description("Pull a specific issue from JIRA")
      .argument("<issue-key>", "JIRA issue key")
      .option("-o, --format <format>", "Output format (json or yaml)", "yaml")
      .action(
        async function pullIssue(issueKey: string, options = settings.printer) {
          const issueService = IssueService(storage);
          const issue = await issueService
            .pullIssue(issueKey)
            .catch(console.expect("Issue not found"));
          await IssueStore(storage).put(issue.key, issue);
          return console.print(issue, options?.format);
        },
      ),
  );

  async function push(key: string) {
    const edits = EditStore(storage);
    const issues = IssueStore(storage);
    const issueService = IssueService(storage);
    const authoring = AuthoringService(settings);
    const remote = await issueService.pullIssue(key);
    const local = await edits.get(key).catch(() => null);
    if (!local) return console.warn("Up to date");
    const localChecksum = await authoring.hash(authoring.serialize(local));
    const remoteChecksum = await authoring.hash(authoring.serialize(remote));
    if (localChecksum === remoteChecksum) return console.warn("Up to date");
    await issueService.pushIssue(local);
    await issues.put(local.key, local);
    await edits.remove(key);
    return console.info(Fmt.green(`Changes pushed to ${local.self}`));
  }

  program
    .command("push")
    .description("Publish an issue edit to JIRA")
    .argument("<issue-key>", "JIRA issue key")
    .action(push);

  async function review(
    key: string,
    options = { ...settings.printer, model: settings.ollama.model },
  ) {
    const reviews = ReviewStore(storage);
    const issueStore = IssueStore(storage);
    const ollama = new Ollama({ ...settings.ollama, model: options.model });
    const assistant = AssistantService(ollama, storage, settings);
    await assistant
      .status()
      .catch(console.expect("Failed to connect to Ollama"));
    if (options.all) return await reviewAll(options);
    if (!key) return console.die("issue key required when not using --all");

    const review = await reviews.get(key).catch(
      console.expect("Issue not found"),
    );

    if (!options.force && review) return console.print(review);

    return await issueStore
      .get(key)
      .catch(console.expect("Issue not found"))
      .then((issue) => reviewIssue(issue, options));

    async function reviewIssue(issue: Issue, options = settings.printer) {
      console.log("reviewing", issue.key);
      return await assistant
        .review(issue)
        .then((data) => console.print(data, options.format))
        .catch(console.error);
    }

    async function reviewAll(options = settings.printer) {
      const keys = await Array
        .fromAsync(reviews.keys())
        .then((keys) => new Set(keys));
      const issues = issueStore.list();
      for await (const issue of issues) {
        if (keys.has(issue.key) && !options.force) continue;
        await reviewIssue(issue, options);
      }
      return console.info("done");
    }
  }

  program
    .command("review")
    .description("Review an issue using AI")
    .argument("[issue-key]", "JIRA issue key")
    .option("--force", "Force a new review even if cached")
    .option("--all", "Review all locally stored issues")
    .option("-o, --format <format>", "Output format (json or yaml)", "yaml")
    .option("--model <model>", "Ollama model to use", settings.ollama.model)
    .action(review);

  async function estimate(
    key: string,
    options: {
      reviewed?: boolean;
      all?: boolean;
      force?: boolean;
      model?: string;
    } = {},
  ) {
    const estimateStore = EstimateStore(storage);
    const issueStore = IssueStore(storage);
    const reviewStore = ReviewStore(storage);
    const ollama = new Ollama(settings.ollama);
    const assistant = AssistantService(ollama, storage, settings);
    await assistant
      .status()
      .catch(console.expect("Failed to connect to Ollama"));

    if (options.reviewed) return await estimateReviewed(options);
    if (options.all) return await estimateAll(options);

    const estimate = await estimateStore
      .get(key)
      .catch(() => null);

    if (!options.force && estimate) return console.print(estimate);

    return await issueStore
      .get(key)
      .catch(console.expect("Issue not found"))
      .then((issue) => estimateIssue(issue, options));

    async function estimateIssue(
      issue: Issue,
      options: { model?: string } = {},
    ) {
      console.log("estimating", issue.key);
      return await assistant
        .estimate(issue, options)
        .then((estimate) => estimateStore.put(issue.key, estimate))
        .then(console.print)
        .catch(console.error);
    }

    async function estimateReviewed(
      options: { force?: boolean; model?: string } = {},
    ) {
      const estimatedKeys = await Array
        .fromAsync(estimateStore.keys())
        .then((keys) => new Set(keys));

      for await (const key of reviewStore.keys()) {
        if (!options.force && estimatedKeys.has(key)) continue;
        await issueStore
          .get(key)
          .then((issue) => estimateIssue(issue, options))
          .catch(console.expect("Issue not found"));
      }

      return console.info("done");
    }

    async function estimateAll(
      options: { force?: boolean; model?: string } = {},
    ) {
      const keys = await Array
        .fromAsync(estimateStore.keys())
        .then((keys) => new Set(keys));
      const issues = issueStore.list();
      for await (const issue of issues) {
        if (keys.has(issue.key) && !options.force) continue;
        await estimateIssue(issue, options);
      }
      return console.info("done");
    }
  }

  program
    .command("estimate")
    .description("Estimate story points for an issue using AI")
    .argument("[issue-key]", "JIRA issue key")
    .option("--force", "Force a new estimate even if cached")
    .option("--all", "Estimate all locally stored issues")
    .option("--reviewed", "Estimate only previously reviewed issues")
    .option("-o, --format <format>", "Output format (json or yaml)", "yaml")
    .option("--model <model>", "Ollama model to use")
    .action(estimate);

  async function edit(key: string) {
    const editStore = EditStore(storage);
    const issueStore = IssueStore(storage);
    const authoring = AuthoringService(settings);
    const wip = await editStore.get(key).catch(() => null);
    const issue = wip || await issueStore
      .get(key)
      .catch(console.expect("Issue not found"));
    const content = authoring.serialize(issue);
    const checksum = await authoring.hash(content);
    const tempFile = await Deno.makeTempFile({ suffix: ".md" });
    await Deno.writeTextFile(tempFile, content);
    const editor = Deno.env.get("EDITOR") || "nano";
    const process = new Deno.Command(editor, {
      args: [tempFile],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const result = await process.output();
    if (!result.success) {
      await Deno.remove(tempFile);
      return console.die("Editor failed to start");
    }
    let edit: Edit | null = null;
    let msg: string | null = "Press Enter when done editing.";
    while (msg) {
      console.log(Fmt.yellow(`Editing ${key}...`));
      prompt(msg);
      const content1 = await Deno.readTextFile(tempFile);
      const checksum1 = await authoring.hash(content1);
      if (checksum1 === checksum) {
        console.warn(Fmt.yellow("No changes."));
        return await Deno.remove(tempFile);
      }
      try {
        edit = await authoring.deserialize(content1);
        msg = null;
      } catch (err) {
        const message = (err as Error).message;
        console.error(Fmt.yellow(`Error: ${message}`));
        msg = Fmt.red("Please fix any errors and press Enter to continue.");
      }
    }
    await Deno.remove(tempFile);
    const { meta, description } = edit!;
    const fields = { ...issue.fields, summary: meta.summary, description };
    const issue1 = { ...issue, fields };
    await editStore.put(meta.key, issue1);
    console.log(Fmt.green("Changes saved"));
    console.log(Fmt.blue("Note: `karen diff <issue-key>`"));
    console.log(Fmt.blue("Note: `karen push <issue-key>`"));
  }

  program
    .command("edit")
    .description("Edit an issue in your preferred editor")
    .argument("<issue-key>", "JIRA issue key")
    .action(edit);

  async function diff(issueKey: string) {
    const issueStore = IssueStore(storage);
    const editStore = EditStore(storage);
    const authoring = AuthoringService(settings);
    const original = await issueStore.get(issueKey).catch(
      console.expect("Issue not found"),
    );
    const edited = await editStore.get(issueKey).catch(() => null);
    if (!edited) return console.warn("No local changes found");
    console.log(authoring.diff(original, edited));
  }

  program
    .command("diff")
    .description("Show differences between local and original versions")
    .argument("<issue-key>", "JIRA issue key")
    .action(diff);

  async function prune(
    days: string,
    options: { created?: boolean; format?: string } = {},
  ) {
    const issueStore = IssueStore(storage);
    const now = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const thresholdDays = parseInt(days);
    const threshold = new Date(now.getTime() - (thresholdDays * msPerDay));
    const issues = await Array.fromAsync(issueStore.list());
    const prunable = issues
      .filter((issue) => {
        const created = new Date(issue.fields.created);
        const updated = new Date(issue.fields.updated);
        return options.created ? created < threshold : updated < threshold;
      })
      .sort((a, b) => {
        const aDate = new Date(a.fields.created);
        const bDate = new Date(b.fields.created);
        return aDate.getTime() - bDate.getTime();
      })
      .map((issue) => ({
        key: issue.key,
        summary: issue.fields.summary,
        created: {
          date: issue.fields.created,
          relative: relativeDate(new Date(issue.fields.created)),
        },
        updated: {
          date: issue.fields.updated,
          relative: relativeDate(new Date(issue.fields.updated)),
        },
      }));

    if (prunable.length === 0) return console.warn("No issues to prune");
    console.print(prunable, options.format);
  }

  program
    .command("prune")
    .description("List old issues filtered by last updated date")
    .argument("<days>", "threshold in days")
    .option("-o, --format <format>", "Output format (json or yaml)", "yaml")
    .option("--created", "Filter by created date")
    .action(prune);

  async function report(
    key: string,
    options: {
      publish?: boolean;
      force?: boolean;
      all?: boolean;
      format?: string;
      model?: string;
    } = {},
  ) {
    const issueStore = IssueStore(storage);
    const reporting = ReportingService(storage, settings);

    if (options.all) return await reportAll(options);
    if (!key) return console.die("issue key required when not using --all");

    const issue = await issueStore
      .get(key)
      .catch(console.expect("Issue not found"));
    const report = await reporting.collect(issue, options);
    if (["markdown", "jira"].includes(options.format ?? "markdown")) {
      const markdown = await reporting.format(report, {
        format: options.format ?? "markdown",
      });
      console.log(markdown);
    } else {
      console.print(report, options.format);
    }

    if (options.publish) {
      await reporting.publish(report);
      console.info(Fmt.green("Report published"));
    }

    async function reportIssue(
      issue: Issue,
      options: {
        publish?: boolean;
        format?: string;
        force?: boolean;
        model?: string;
      } = {},
    ) {
      console.log("Collecting report for", issue.key);
      const report = await reporting.collect(issue, options);
      if (options.publish) {
        await reporting.publish(report);
        return console.info(Fmt.green(`Published report for ${issue.key}`));
      }
      if (options.format === "markdown") {
        const markdown = await reporting.format(report, { format: "markdown" });
        return console.log(markdown);
      }
      return console.print(report, options.format);
    }

    async function reportAll(
      options: {
        publish?: boolean;
        force?: boolean;
        format?: string;
        model?: string;
      } = {},
    ) {
      const issues = issueStore.list();
      for await (const issue of issues) await reportIssue(issue, options);
      return console.info("done");
    }
  }

  program
    .command("report")
    .description("Generate a report for an issue using AI review and estimate")
    .argument("[issue-key]", "JIRA issue key")
    .option("--publish", "Publish report as a comment on the issue")
    .option("--force", "Force a new review and estimate")
    .option("--all", "Report on all locally stored issues")
    .option(
      "-o, --format <format>",
      "Output format (json, yaml, markdown)",
      "yaml",
    )
    .option("--model <model>", "Ollama model to use")
    .action(report);

  await program.parseAsync();
}

if (import.meta.main) await main();
