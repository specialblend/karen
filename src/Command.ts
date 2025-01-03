import * as Fmt from "jsr:@std/fmt/colors";
import { Ollama } from "npm:ollama";
import { Command } from "npm:commander";

import { ConfigStore, KnownConfigParams, remember } from "./Config.ts";
import { Console } from "./Console.ts";
import { DefaultPrinter, Printer, PrinterOptions } from "./Printer.ts";
import { Review, ReviewPrinter, ReviewService, ReviewStore } from "./Review.ts";
import { SettingsV1 } from "./Settings.ts";
import { Store } from "./Store.ts";

import {
    getSettingsPath,
    getStorageDir,
    getStoragePath,
    hash,
    relativeDate,
} from "./System.ts";

import {
    BoardStore,
    deserializeEdit,
    diffIssue,
    Edit,
    EditStore,
    Issue,
    IssuePrinter,
    IssueService,
    IssueStore,
    MyCommentStore,
    ProjectStore,
    serializeIssue,
} from "./Issue.ts";

const console = Console();

export type SettingsOptions = {
    edit?: boolean;
    format?: string;
};

export function SettingsCommand(settings: SettingsV1): Command {
    return new Command("settings")
        .description("Show or edit settings")
        .option("--edit", "Open settings file in $EDITOR")
        .option("-o, --format <format>", "json or yaml", "yaml")
        .action(handleSettings);

    async function handleSettings(options: SettingsOptions) {
        if (options.edit) return editSettings();
        return showSettings(options);
    }

    async function showSettings(options: SettingsOptions) {
        console.print(settings, options.format);
        return console.info(
            Fmt.blue(
                "Note: you can edit settings with `karen settings --edit`",
            ),
        );
    }

    async function editSettings() {
        const storageDir = getStorageDir();
        const settingsPath = getSettingsPath(storageDir);
        const editor = Deno.env.get("EDITOR") || "nano";
        const inherit = {
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
        } as const;
        const args = [settingsPath];
        const options = { args, ...inherit };
        const process = new Deno.Command(editor, options);
        await process.output();
    }
}

export function ConfigCommand(storage: Deno.Kv): Command {
    return new Command("config")
        .description("Manage configuration")
        .addCommand(
            new Command("show")
                .description("List all configuration values")
                .option("-o, --format <format>", "json or yaml", "yaml")
                .action(showConfig),
        )
        .addCommand(
            new Command("setup")
                .description("Interactive setup of user configuration")
                .action(setup),
        )
        .addCommand(
            new Command("remove")
                .description("Remove configuration value(s)")
                .argument("[key]", "Configuration key to delete")
                .option("--all", "Delete all configuration values")
                .option("--force", "Delete without confirmation")
                .action(RemoveResource(ConfigStore(storage))),
        );

    async function setup() {
        const options = { force: true };
        const params = KnownConfigParams.values();
        for (const param of params) {
            await remember(param, options, storage);
        }
    }

    async function showConfig(options: { format?: string }) {
        const config = ConfigStore(storage);
        const data = new Map<string, string>();
        const params = KnownConfigParams.values();
        for (const param of params) {
            const value = await config.get(param.key);
            const value1 = console.mask(param, value);
            data.set(param.key, value1);
        }
        if (data.size === 0) return console.warn("No config values found");
        const configObj = Object.fromEntries(data);
        return console.print(configObj, options.format);
    }
}

export function InfoCommand(storage: Deno.Kv): Command {
    return new Command("info")
        .description("Show summary information about the locally stored data")
        .option("-o, --format <format>", "json or yaml", "yaml")
        .action(showInfo);

    async function showInfo(options: { format?: string }) {
        const id = await storage.get(["meta", "id"])
            .then((id) => id.value)
            .catch(() => "none");
        const issues = await Array.fromAsync(IssueStore(storage).keys());
        const projects = await Array.fromAsync(ProjectStore(storage).keys());
        const reviews = await Array.fromAsync(ReviewStore(storage).keys());
        const edits = await Array.fromAsync(EditStore(storage).keys());
        const output = {
            id,
            issues: {
                total: issues.length,
                reviewed: reviews.length,
                edited: edits.length,
            },
            projects: { total: projects.length },
        };
        console.print(output, options.format);
    }
}

export type PathOptions = {
    storage?: boolean;
    settings?: boolean;
};

export function PathCommand(storageDir: string): Command {
    return new Command("path")
        .description("Show the path to local storage directory")
        .option("--storage", "Show the path to local storage DB file")
        .option("--settings", "Show the path to local settings.json file")
        .action(printPath);

    function printPath(options: PathOptions) {
        const storagePath = getStoragePath(storageDir);
        const settingsPath = getSettingsPath(storageDir);
        if (options.storage) return console.log(storagePath);
        if (options.settings) return console.log(settingsPath);
        return console.log(storageDir);
    }
}

export function ListCommand(storage: Deno.Kv, settings: SettingsV1): Command {
    return new Command("list")
        .alias("ls")
        .description("List stored data")
        .addCommand(
            new Command("projects")
                .description("List all stored projects")
                .option("--details", "Show full project details")
                .option("-o, --format <format>", "json or yaml", "yaml")
                .action(ListResource(ProjectStore(storage))),
        )
        .addCommand(
            new Command("issues")
                .description("List all stored issues")
                .option("--details", "Show full issue details")
                .option("-o, --format <format>", "json or yaml", "yaml")
                .action(ListResource(IssueStore(storage), IssuePrinter)),
        )
        .addCommand(
            new Command("comments")
                .description("List all stored comments published by KAREN")
                .option("--details", "Show full comment details")
                .option("-o, --format <format>", "json or yaml", "yaml")
                .action(ListResource(MyCommentStore(storage))),
        )
        .addCommand(
            new Command("edits")
                .description("List all stored edits")
                .option("--details", "Show full edit details")
                .option("-o, --format <format>", "json or yaml", "yaml")
                .action(ListResource(EditStore(storage), IssuePrinter)),
        )
        .addCommand(ListReviewsCommand(storage, settings));
}

export function GetCommand(storage: Deno.Kv): Command {
    return new Command("get")
        .description("Get stored data")
        .argument("[key]", "Key to get")
        .addCommand(
            new Command("issue")
                .description("Get stored issue")
                .argument("[issue-key]", "JIRA issue key")
                .option("--details", "Show full issue details")
                .option("-o, --format <format>", "json or yaml", "yaml")
                .action(GetResource(IssueStore(storage), IssuePrinter)),
        )
        .addCommand(
            new Command("edit")
                .description("Get stored edit")
                .argument("[issue-key]", "JIRA issue key")
                .option("--details", "Show full edit details")
                .option(
                    "-o, --format <format>",
                    "json, yaml, or markdown",
                    "yaml",
                )
                .action(GetResource(EditStore(storage), IssuePrinter)),
        )
        .addCommand(
            new Command("project")
                .description("Get stored project")
                .argument("[project-key]", "JIRA project key")
                .option("--details", "Show full project details")
                .option(
                    "-o, --format <format>",
                    "Output format (json or yaml)",
                    "yaml",
                )
                .action(GetResource(ProjectStore(storage))),
        )
        .addCommand(
            new Command("review")
                .description("Get stored review")
                .argument("[issue-key]", "JIRA issue key")
                .option(
                    "-o, --format <format>",
                    "Output format (json or yaml)",
                    "yaml",
                )
                .option("--details", "Show full review details")
                .action(GetResource(ReviewStore(storage), ReviewPrinter)),
        );
}

export function RemoveCommand(storage: Deno.Kv): Command {
    return new Command("remove")
        .alias("rm")
        .description("Remove stored data")
        .addCommand(
            new Command("issue")
                .description("Remove stored issue(s)")
                .argument("[issue-key]", "JIRA issue key")
                .option("--all", "Delete all issues")
                .option("--force", "Delete without confirmation")
                .action(RemoveResource(IssueStore(storage))),
        )
        .addCommand(
            new Command("edit")
                .description("Remove stored edit(s)")
                .argument("[issue-key]", "JIRA issue key")
                .option("--all", "Delete all edits")
                .option("--force", "Delete without confirmation")
                .action(RemoveResource(EditStore(storage))),
        )
        .addCommand(
            new Command("project")
                .description("Remove stored project(s)")
                .argument("[project-key]", "JIRA project key")
                .option("--all", "Delete all projects")
                .option("--force", "Delete without confirmation")
                .action(RemoveResource(ProjectStore(storage))),
        )
        .addCommand(
            new Command("review")
                .description("Remove stored review(s)")
                .argument("[issue-key]", "JIRA issue key")
                .option("--all", "Delete all reviews")
                .option("--force", "Delete without confirmation")
                .action(RemoveResource(ReviewStore(storage))),
        );
}

export function PushCommand(storage: Deno.Kv): Command {
    const edits = EditStore(storage);
    const issues = IssueStore(storage);
    const issueService = IssueService(storage);

    return new Command("push")
        .description("Publish an issue edit to JIRA")
        .argument("<issue-key>", "JIRA issue key")
        .action(push);

    async function push(key: string) {
        const remote = await issueService.pullIssue(key);
        const local = await edits.get(key).catch(() => null);
        if (!local) return console.warn("Up to date");

        const localChecksum = await hash(serializeIssue(local));
        const remoteChecksum = await hash(serializeIssue(remote));
        if (localChecksum === remoteChecksum) return console.warn("Up to date");

        await issueService.pushIssue(local);
        await issues.put(local.key, local);
        await edits.remove(key);
        return console.info(Fmt.green(`Changes pushed to ${local.self}`));
    }
}

export function PullCommand(storage: Deno.Kv): Command {
    const issueService = IssueService(storage);

    return new Command("pull")
        .description("Pull issues from JIRA")
        .addCommand(
            new Command("project")
                .description("Pull all issues for a specific project")
                .argument("<project-key>", "JIRA project key")
                .option(
                    "-o, --format <format>",
                    "Output format (json or yaml)",
                    "yaml",
                )
                .action(pullProject),
        )
        .addCommand(
            new Command("issue")
                .description("Pull a specific issue from JIRA")
                .argument("<issue-key>", "JIRA issue key")
                .option(
                    "-o, --format <format>",
                    "Output format (json or yaml)",
                    "yaml",
                )
                .action(pullIssue),
        );

    async function pullIssue(issueKey: string, options: { format?: string }) {
        const issue = await issueService
            .pullIssue(issueKey)
            .catch(console.expect("Issue not found"));
        await IssueStore(storage).put(issue.key, issue);
        return console.print(issue, options?.format);
    }

    async function pullProject(projectKey: string) {
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
    }
}

export type ReviewOptions = {
    format: "markdown" | "json" | "yaml" | "jira";
    details?: boolean;
    model?: string;
    force?: boolean;
    outdated?: boolean;
    all?: boolean;
    publish?: boolean;
};

export function ReviewCommand(storage: Deno.Kv, settings: SettingsV1): Command {
    const reviewStore = ReviewStore(storage);
    const issueStore = IssueStore(storage);
    const ollama = new Ollama(settings.ollama);
    const service = ReviewService(ollama, storage, settings);

    return new Command("review")
        .description("Review an issue using AI")
        .argument("[issue-key]", "JIRA issue key")
        .option("--force", "Force a new review even if cached")
        .option("--outdated", "Review only issues with outdated reviews")
        .option("--all", "Review all locally stored issues")
        .option(
            "-o, --format <format>",
            "Output format (json, yaml, markdown)",
            "markdown",
        )
        .option("--details", "Show full review details")
        .option("--model <model>", "Ollama model to use")
        .option("--publish", "Publish the review to JIRA")
        .action(review);

    async function review(key: string, options: ReviewOptions) {
        await service
            .status()
            .catch(console.expect("Failed to connect to Ollama"));
        if (options.outdated) return await reviewOutdated(options);
        if (options.all) return await reviewAll(options);
        if (!key) {
            return console.die("issue key required when not using --all");
        }

        return await issueStore
            .get(key)
            .catch(console.expect("Issue not found"))
            .then((issue) => reviewOne(issue, options));
    }

    async function reviewOne(issue: Issue, options: ReviewOptions) {
        console.log("reviewing", issue.key, "...");
        const printer = ReviewPrinter(options);
        const review = await service.review(issue, options);
        if (options.publish) {
            const { published, link } = await service.publish(review);
            if (published) {
                return console.info(
                    Fmt.green(`Published ${issue.key}: ${link}`),
                );
            }
            return console.error(
                Fmt.yellow(`Already published ${issue.key}: ${link}`),
            );
        }
        return console.log(printer.format(review));
    }

    async function reviewOutdated(options: ReviewOptions) {
        for await (const key of reviewStore.keys()) {
            const issue = await issueStore
                .get(key)
                .catch(console.expect("Issue not found"));
            const diff = await service.diff(issue);
            if (diff.outdated || options.force) {
                await reviewOne(issue, options);
            }
        }
        return console.info("done");
    }

    async function reviewAll(options: ReviewOptions) {
        for await (const issue of issueStore.list()) {
            const diff = await service.diff(issue);
            if (diff.outdated || options.force) {
                await reviewOne(issue, { ...options, force: true });
            }
        }
        return console.info("done");
    }
}

export function EditCommand(storage: Deno.Kv): Command {
    return new Command("edit")
        .description("Edit an issue in your preferred editor")
        .argument("<issue-key>", "JIRA issue key")
        .action(edit);

    async function edit(key: string) {
        const editStore = EditStore(storage);
        const issueStore = IssueStore(storage);
        const wip = await editStore.get(key).catch(() => null);
        const issue = wip || await issueStore
            .get(key)
            .catch(console.expect("Issue not found"));
        const content = serializeIssue(issue);
        const checksum = await hash(content);
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
            const checksum1 = await hash(content1);
            if (checksum1 === checksum) {
                console.warn(Fmt.yellow("No changes."));
                return await Deno.remove(tempFile);
            }
            try {
                edit = await deserializeEdit(content1);
                msg = null;
            } catch (err) {
                const message = (err as Error).message;
                console.error(Fmt.yellow(`Error: ${message}`));
                msg = Fmt.red(
                    "Please fix any errors and press Enter to continue.",
                );
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
}

export function DiffCommand(storage: Deno.Kv): Command {
    const issueStore = IssueStore(storage);
    const editStore = EditStore(storage);

    return new Command("diff")
        .description("Show differences between local and original versions")
        .argument("<issue-key>", "JIRA issue key")
        .action(diff);

    async function diff(issueKey: string) {
        const original = await issueStore.get(issueKey).catch(
            console.expect("Issue not found"),
        );
        const edited = await editStore.get(issueKey).catch(() => null);
        if (!edited) return console.warn("No local changes found");
        console.log(diffIssue(original, edited));
    }
}

export type PruneOptions = {
    created?: boolean;
    format?: string;
};

export function PruneCommand(storage: Deno.Kv): Command {
    const issueStore = IssueStore(storage);

    return new Command("prune")
        .description("List old issues filtered by last updated date")
        .argument("<days>", "threshold in days")
        .option("-o, --format <format>", "Output format (json or yaml)", "yaml")
        .option("--created", "Filter by created date")
        .action(prune);

    async function prune(days: string, options: PruneOptions) {
        const now = new Date();
        const msPerDay = 24 * 60 * 60 * 1000;
        const thresholdDays = parseInt(days);
        const threshold = new Date(now.getTime() - (thresholdDays * msPerDay));
        const issues = await Array.fromAsync(issueStore.list());
        const prunable = issues
            .filter((issue) => {
                const created = new Date(issue.fields.created);
                const updated = new Date(issue.fields.updated);
                return options.created
                    ? created < threshold
                    : updated < threshold;
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
}

export type ListReviewsOptions = {
    format: string;
    details?: boolean;
    threshold?: string;
    outdated?: boolean;
    diff?: boolean;
};

export function ListReviewsCommand(
    storage: Deno.Kv,
    settings: SettingsV1,
): Command {
    const issueService = IssueService(storage);
    const ollama = new Ollama(settings.ollama);
    const reviewService = ReviewService(ollama, storage, settings);

    return new Command("reviews")
        .description("List all stored reviews sorted by score (lowest first)")
        .option("--threshold <score>", "Filter reviews below threshold score")
        .option("--details", "Show full review details")
        .option("--outdated", "Show only outdated reviews")
        .option("--diff", "Show diffs when listing outdated reviews")
        .option("-o, --format <format>", "json or yaml", "yaml")
        .action(listReviews);

    async function listReviews(options: ListReviewsOptions) {
        const store = ReviewStore(storage);
        const printer = ReviewPrinter(options);
        const threshold = await getThreshold(options).catch(() => 1);
        const reviews = await Array
            .fromAsync(store.list())
            .then((data) => data.sort((a, b) => a.score - b.score))
            .then((data) => data.filter(({ score }) => score <= threshold));
        if (!options.outdated) return console.log(printer.list(reviews));
        const outdated = await keepOutdated(reviews);
        return console.log(printer.list(outdated));
    }

    async function keepOutdated(reviews: Review[]): Promise<Review[]> {
        const outdated = [];
        for await (const review of reviews) {
            const issue = await issueService
                .pullIssue(review.key)
                .catch(() => null);
            if (issue) {
                const diff = await reviewService.diff(issue);
                if (diff.outdated) outdated.push(review);
            }
        }
        return outdated;
    }

    async function getThreshold(options: ListReviewsOptions): Promise<number> {
        if (!options.threshold) throw new Error("No threshold provided");
        const parsed = parseFloat(options.threshold);
        if (Number.isNaN(parsed)) throw new Error("Invalid threshold");
        if (parsed < 0) throw new Error("Threshold must be positive");
        if (parsed > 1) throw new Error("Threshold must be less than 1");
        return parsed;
    }
}

function ListResource<T>(
    store: Store<T>,
    Printer1: (options: PrinterOptions) => Printer<T> = DefaultPrinter,
    defaultOptions = { format: "yaml" },
) {
    return async function listResource(options: PrinterOptions) {
        const printer = Printer1({ ...defaultOptions, ...options });
        return await Array
            .fromAsync(store.list())
            .then(printer.list)
            .then(console.log)
            .catch(console.die);
    };
}

function GetResource<T>(
    store: Store<T>,
    Printer1: (options: PrinterOptions) => Printer<T> = DefaultPrinter,
    defaultOptions = { format: "yaml" },
) {
    return async function getResource(key: string, options: PrinterOptions) {
        const printer = Printer1({ ...defaultOptions, ...options });
        if (!key) return console.die("key required");
        return await store
            .get(key)
            .then(printer.format)
            .then(console.log)
            .catch(console.expect("Not found"));
    };
}

function RemoveResource<T>(store: Store<T>) {
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
