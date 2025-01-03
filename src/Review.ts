import { Ollama } from "npm:ollama";
import * as JSONSchema from "npm:jsonschema";
import * as Diff from "npm:diff";
import * as Yaml from "jsr:@std/yaml";
import Jira2Md from "npm:jira2md";

import { diffIssue, Issue, IssueService, serializeIssue } from "./Issue.ts";
import { Store } from "./Store.ts";
import { SettingsV1 } from "./Settings.ts";
import { Printer, PrinterOptions } from "./Printer.ts";
import { Console } from "./Console.ts";

export type Review = {
    key: string;
    model: string;
    score: number;
    checklist: ChecklistResult[];
    estimate: Estimate;
    normalizedEstimate: Estimate;
    issue: Issue;
};

export type Estimate = {
    confidence: number;
    storyPoints: number;
};

export type NormalizedEstimate = {
    confidenceRange: [number, number];
    storyPointsRange: [number, number];
};

export type ChecklistResult = {
    entry: ChecklistEntry;
    value: boolean;
};

export type ChecklistEntry = {
    key: string;
    description: string;
    weight: number;
};

export type ReviewDiff = {
    key: string;
    hasReview: boolean;
    isOutdated: boolean;
    patch: string;
};

export function ReviewStore(storage: Deno.Kv): Store<Review> {
    return Store<Review>(["reviews"], storage);
}

export function ReviewPrinter(options: PrinterOptions): Printer<Review> {
    const console = Console();
    function summary(review: Review) {
        const { key, issue, score, normalizedEstimate } = review;
        const { confidence, storyPoints } = normalizedEstimate;
        const { summary } = issue.fields;
        return { key, summary, score, confidence, storyPoints };
    }
    return {
        format(review) {
            if (options.format === "markdown") return fmtMarkdown(review);
            if (options.details) {
                return console.serialize(review, options.format);
            }
            return console.serialize(summary(review), options.format);
        },
        list(reviews) {
            if (options.format === "markdown") {
                return reviews.map(fmtMarkdown).join("\n---\n");
            }
            if (options.details) {
                return console.serialize(reviews, options.format);
            }
            return console.serialize(reviews.map(summary), options.format);
        },
    };
}

export function ReviewService(
    ollama: Ollama,
    storage: Deno.Kv,
    settings: SettingsV1,
) {
    const reviewStore = ReviewStore(storage);
    const issueService = IssueService(storage);

    return { status, review, publish, diff };

    async function status() {
        await ollama.ps();
    }

    async function diff(issue: Issue): Promise<ReviewDiff> {
        const review = await reviewStore
            .get(issue.key)
            .catch(() => null);
        if (!review) {
            return {
                key: issue.key,
                hasReview: false,
                isOutdated: true,
                patch: "",
            };
        }
        const patch = diffIssue(review.issue, issue);
        if (patch) {
            return {
                key: issue.key,
                hasReview: true,
                isOutdated: true,
                patch,
            };
        }
        return {
            key: issue.key,
            hasReview: true,
            isOutdated: false,
            patch: "",
        };
    }

    async function review(
        issue: Issue,
        options: { force?: boolean; model?: string } = {},
    ): Promise<Review> {
        const existing = await reviewStore.get(issue.key).catch(() => null);
        if (existing && !options.force) return existing;
        const model = options.model ?? settings.assistant.review.model;
        const options1 = { ...options, model };
        const [checklist, estimate] = await Promise.all([
            runChecklist(issue, options1),
            runEstimate(issue, options1),
        ]);
        const score = calculateScore(checklist);
        const normalizedEstimate = normalizeEstimate(score, estimate, settings);
        const review = {
            key: issue.key,
            model,
            score,
            checklist,
            estimate,
            normalizedEstimate,
            issue,
        };
        return await reviewStore.put(issue.key, review);
    }

    async function runChecklist(
        issue: Issue,
        options: { model?: string } = {},
    ): Promise<ChecklistResult[]> {
        const settings1 = settings.assistant.review;
        const model = options.model ?? settings1.model;
        const format: JSONSchema.Schema = {
            type: "object",
            required: settings1.checklist.map(({ key }) => key),
            properties: Object.fromEntries(
                settings1.checklist.map(fmtEntry),
            ),
        };
        const instructions = Yaml.stringify({
            comment: settings1.comment,
            checklist: settings1.checklist.map((c) => c.description),
        });
        const prompt = [
            instructions,
            "---",
            serializeIssue(issue),
        ].join("\n\n");
        const data = await ollama
            .generate({ model, prompt, format })
            .then(({ response }) => JSON.parse(response));
        return settings1
            .checklist
            .map((entry) => ({ entry, value: data[entry.key] }));

        function fmtEntry(entry: ChecklistEntry) {
            return [entry.key, {
                type: "boolean",
                description: entry.description,
            }];
        }
    }

    async function runEstimate(
        issue: Issue,
        options: { model?: string } = {},
    ): Promise<Estimate> {
        const { confidence, storyPoints } = settings.assistant.estimate;
        const model = options.model ?? settings.assistant.estimate.model;
        const format: JSONSchema.Schema = {
            type: "object",
            required: ["confidence", "storyPoints"],
            properties: {
                confidence: {
                    type: "number",
                    description: confidence.description,
                },
                storyPoints: {
                    type: "number",
                    description: storyPoints.description,
                },
            },
        };

        const instructions = Yaml.stringify({
            comments: [storyPoints.comment, confidence.comment],
            scale: storyPoints.scale,
        });

        const prompt = [
            instructions,
            "---",
            serializeIssue(issue),
        ].join("\n\n");

        return await ollama
            .generate({ model, prompt, format })
            .then(({ response }) => JSON.parse(response));
    }

    async function publish(review: Review) {
        const text = fmtJira(review);
        return await issueService.upsertComment(review.issue, text);
    }
}

function calculateScore(checklist: ChecklistResult[]): number {
    const totalWeight = checklist
        .map(({ entry: { weight } }) => weight)
        .reduce((a, b) => a + b, 0);
    const score = checklist
        .map(({ value, entry: { weight } }) => value ? weight : 0)
        .reduce((a, b) => a + b, 0);
    return score / totalWeight;
}

function roundScale(value: number, scale: number[]) {
    // find scale value closest to value
    return scale.reduce(
        (a, b) => Math.abs(a - value) < Math.abs(b - value) ? a : b,
        scale[0],
    );
}

function normalizeEstimate(
    score: number,
    estimate: Estimate,
    settings: SettingsV1,
): Estimate {
    const { confidence, storyPoints } = estimate;
    const scale = settings.assistant.estimate.storyPoints.scale.map((
        { points },
    ) => points);
    const averageConfidence = ((confidence * score) + confidence) / 2;
    const averageStoryPoints = ((storyPoints * score) + storyPoints) / 2;
    return {
        confidence: Math.round(averageConfidence),
        storyPoints: roundScale(averageStoryPoints, scale),
    };
}

function fmtConfidence(review: Review) {
    return `${Math.round(review.normalizedEstimate.confidence)}%`;
}

function fmtStoryPoints(review: Review) {
    return `${review.normalizedEstimate.storyPoints}`;
}

function fmtScore(review: Review) {
    return `${Math.round(review.score * 100)}%`;
}

function fmtJira(review: Review) {
    return Jira2Md.to_jira(fmtMarkdown(review));
}

function fmtMarkdown(review: Review) {
    const checklist = review.checklist.map(
        function fmtChecklistEntry({ entry, value }) {
            if (value) return `{color:green}**✓**{color} ${entry.description}`;
            return `{color:red}**✗**{color} ${entry.description}`;
        },
    );

    return `

#### ${review.issue.key}

- ${checklist.join("\n- ")}

\`\`\`markdown
Refinement Score: ${fmtScore(review)}
Estimated Story Points: ${fmtStoryPoints(review)}
Confidence: ${fmtConfidence(review)}
Model: ${review.model}
\`\`\`

*Generated with {color:purple}♥{color} by [KAREN](https://github.com/specialblend/karen)*
`;
}
