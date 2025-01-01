import { Ollama } from "npm:ollama";
import * as JSONSchema from "npm:jsonschema";
import * as Yaml from "jsr:@std/yaml";

import { AuthoringService } from "./Authoring.ts";
import {
    ChecklistEntry,
    ChecklistResult,
    Review,
    ReviewStore,
} from "./Review.ts";
import { Estimate, EstimateStore } from "./Estimate.ts";
import { Issue } from "./Issue.ts";
import { SettingsV1 } from "./Settings.ts";

export function AssistantService(
    ollama: Ollama,
    storage: Deno.Kv,
    settings: SettingsV1,
) {
    const authoring = AuthoringService(settings);
    const reviewStore = ReviewStore(storage);
    const estimateStore = EstimateStore(storage);

    return { status, review, estimate, nitpick };

    async function status() {
        await ollama.ps();
    }

    async function review(
        issue: Issue,
        options: { model?: string } = {},
    ): Promise<Review> {
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
        const checklist: ChecklistResult[] = settings1
            .checklist
            .map((entry) => ({ entry, value: data[entry.key] }));
        const score = calculateScore(checklist);
        const checksum = await authoring.checksum(issue);
        const review = {
            issueKey: issue.key,
            model,
            score,
            checklist,
            checksum,
            issue,
        };

        return await reviewStore.put(issue.key, review);

        function fmtEntry(entry: ChecklistEntry) {
            return [entry.key, {
                type: "boolean",
                description: entry.description,
            }];
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
    }

    async function estimate(
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

        const estimate = {
            issueKey: issue.key,
            model,
            confidence: res.confidence,
            storyPoints: res.storyPoints,
        };
        return await estimateStore.put(issue.key, estimate);
    }

    async function nitpick(issue: Issue): Promise<Issue> {
        const settings1 = settings.assistant.nitpick;
        const { model, task, instructions, template } = settings1;
        const prompt = JSON.stringify({
            task,
            instructions,
            template,
            malformed_or_badly_formatted_text: issue.fields.description!,
        });

        const format: JSONSchema.Schema = {
            type: "object",
            required: ["markdown"],
            properties: {
                markdown: {
                    type: "string",
                    description:
                        "prettified markdown version of the malformed or badly formatted text",
                },
            },
        };

        const { markdown } = await ollama
            .generate({ model, prompt, format })
            .then(({ response }) => JSON.parse(response));

        const fields = { ...issue.fields, description: markdown };
        return { ...issue, fields };
    }
}
