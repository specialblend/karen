import { Ollama } from "npm:ollama";
import * as JSONSchema from "npm:jsonschema";
import * as Yaml from "jsr:@std/yaml";

import { Issue } from "./Issue.ts";
import { Store } from "./Store.ts";
import { AuthoringService } from "./Authoring.ts";
import { SettingsV1 } from "./Settings.ts";

export type Review = {
    key: string;
    model: string;
    checksum: string;
    score: number;
    checklist: ChecklistResult[];
    estimate: Estimate;
    normalizedEstimate: NormalizedEstimate;
    issue: Issue;
};

export type ReviewSummary = {
    key: string;
    score: number;
    normalizedEstimate: NormalizedEstimate;
    issue: {
        summary: string;
    };
};

export type Estimate = {
    confidence: number;
    storyPoints: number;
};

export type NormalizedEstimate = {
    confidence: number;
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

export function ReviewStore(storage: Deno.Kv): Store<Review> {
    return Store<Review>(["reviews"], storage);
}

export function ReviewService(
    ollama: Ollama,
    storage: Deno.Kv,
    settings: SettingsV1,
) {
    const authoring = AuthoringService(settings);
    const reviewStore = ReviewStore(storage);

    return { status, review };

    async function status() {
        await ollama.ps();
    }

    async function review(
        issue: Issue,
        options: { model?: string } = {},
    ): Promise<Review> {
        const model = options.model ?? settings.assistant.review.model;
        const options1 = { ...options, model };
        const [checklist, estimate] = await Promise.all([
            runChecklist(issue, options1),
            runEstimate(issue, options1),
        ]);
        const score = calculateScore(checklist);
        const normalizedEstimate = normalizeEstimate(score, estimate);
        const checksum = await authoring.checksum(issue);
        const review = {
            key: issue.key,
            model,
            score,
            checklist,
            estimate,
            normalizedEstimate,
            checksum,
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
            authoring.serialize(issue),
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
            authoring.serialize(issue),
        ].join("\n\n");

        const res = await ollama
            .generate({ model, prompt, format })
            .then(({ response }) => JSON.parse(response));

        return {
            confidence: res.confidence,
            storyPoints: res.storyPoints,
        };
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

    function normalizeEstimate(
        score: number,
        estimate: Estimate,
    ): NormalizedEstimate {
        const { confidence, storyPoints } = estimate;
        return {
            confidence: confidence * score,
            storyPointsRange: [storyPoints * score, storyPoints],
        };
    }
}
