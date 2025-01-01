import * as JSONSchema from "npm:jsonschema";

type ReviewSettings = {
    model: string;
    comment: string;
    checklist: {
        key: string;
        description: string;
        weight: number;
    }[];
};

type EstimateSettings = {
    model: string;
    confidence: {
        comment: string;
        description: string;
    };
    storyPoints: {
        comment: string;
        description: string;
        scale: {
            points: number;
            examples: string[];
        }[];
    };
};

type NitpickSettings = {
    model: string;
    task: string;
    instructions: string[];
    template: string;
};

export type SettingsV1 = {
    version: 1;
    printer: { format: "yaml" | "json" };
    ollama: { host: string };
    assistant: {
        review: ReviewSettings;
        estimate: EstimateSettings;
        nitpick: NitpickSettings;
    };
};

export function SettingsSchemaV1(): JSONSchema.Schema {
    const checklist = {
        type: "array",
        items: {
            type: "object",
            required: ["key", "description", "weight"],
            properties: {
                key: { type: "string" },
                description: { type: "string" },
                weight: { type: "number" },
            },
        },
    };
    const review = {
        type: "object",
        required: ["model", "comment", "checklist"],
        properties: {
            model: { type: "string" },
            comment: { type: "string" },
            checklist,
        },
    };
    const scale = {
        type: "array",
        items: {
            type: "object",
            required: ["points", "examples"],
            properties: {
                points: { type: "number" },
                examples: { type: "array", items: { type: "string" } },
            },
        },
    };
    const storyPoints = {
        type: "object",
        required: ["comment", "description", "scale"],
        properties: {
            comment: { type: "string" },
            description: { type: "string" },
            scale,
        },
    };
    const confidence = {
        type: "object",
        required: ["comment", "description"],
        properties: {
            comment: { type: "string" },
            description: { type: "string" },
        },
    };
    const estimate = {
        type: "object",
        required: ["model", "storyPoints", "confidence"],
        properties: {
            model: { type: "string" },
            storyPoints,
            confidence,
        },
    };
    const nitpick = {
        type: "object",
        required: ["model", "task", "instructions", "template"],
        properties: {
            model: { type: "string" },
            task: { type: "string" },
            instructions: { type: "array", items: { type: "string" } },
            template: { type: "string" },
        },
    };
    const assistant = {
        type: "object",
        required: ["review", "estimate", "nitpick"],
        properties: {
            review,
            estimate,
            nitpick,
        },
    };
    const ollama = {
        type: "object",
        required: ["host"],
        properties: {
            host: { type: "string" },
        },
    };
    const printer = {
        type: "object",
        required: ["format"],
        properties: {
            format: {
                type: "string",
                enum: ["yaml", "json"],
            },
        },
    };
    const version = { type: "number", enum: [1] };
    return {
        type: "object",
        required: ["version", "printer", "ollama", "assistant"],
        properties: {
            version,
            printer,
            ollama,
            assistant,
        },
    };
}

export function validateSettings(settings: any) {
    const validator = new JSONSchema.Validator();
    const result = validator.validate(settings, SettingsSchemaV1());
    if (!result.valid) throw new Error(result.toString());
}

export function DefaultSettings(): SettingsV1 {
    const model = "llama3.3";
    const checklist = [
        {
            key: "clear_subject",
            description: "Does the ticket have a clear subject?",
            weight: 1.0,
        },
        {
            key: "expected_outcomes",
            description: "Does the ticket body contain expected outcome(s)?",
            weight: 4.0,
        },
        {
            key: "considerations",
            description:
                "Does the ticket body contain any notable considerations?",
            weight: 1.0,
        },
        {
            key: "examples",
            description:
                "Does the ticket contain, reference, or link to any code snippets or example code?",
            weight: 1.0,
        },
        {
            key: "documentation",
            description:
                "Does the ticket body contain any http links to resources such as documentation, another ticket, article, wiki, github, etc.?",
            weight: 1.0,
        },
    ];

    const scale = [
        {
            points: 1,
            examples: [
                "One line bug fix that doesn't need any updated tests or only 1 or 2 updated tests",
                "Configuration change",
                "Changes to strapi content types",
                "Turning a feature flag on and off",
            ],
        },
        {
            points: 2,
            examples: [
                "Smaller bug fix or feature that requires testing (e.g. adding a new button to the cases page)",
                "More complicated config changes that require validation",
                "Creating a new strapi content type",
                "Vulnerability tasks",
                "Documentation",
            ],
        },
        {
            points: 3,
            examples: [
                "Implementing a small feature and testing",
                "Small investigations (e.g. figuring out how to add a small feature that already exists)",
            ],
        },
        {
            points: 5,
            examples: [
                "Medium investigation tasks (POC)",
                "Detailed technical analysis with multiple options",
                "Medium to large features requiring significant code changes",
                "Features requiring comprehensive end-to-end testing",
                "Tasks with many unknowns/uncertainties",
                "Work requiring coordination across multiple teams",
            ],
        },
        {
            points: 8,
            examples: [
                "Large investigations with multiple potential solutions and POCs",
                "Tasks requiring extensive research and exploration",
                "Features requiring mob programming sessions",
                "Large features affecting multiple system components",
                "Complex features that ideally should be broken down into smaller tasks",
                "Work requiring significant architectural changes",
            ],
        },
    ];

    return {
        version: 1,
        printer: { format: "yaml" },
        ollama: { host: "http://localhost:11434" },
        assistant: {
            review: {
                model,
                comment:
                    "Review the provided ticket according to this checklist",
                checklist,
            },
            estimate: {
                model,
                confidence: {
                    comment:
                        "Based on the amount of detail provided, what is your confidence in the ability of a human to accurately estimate the story points? Return a number between 0 and 100%?",
                    description: "A percentage number between 0 and 100",
                },
                storyPoints: {
                    comment:
                        "Estimate the story points for the provided ticket using the provided scale.",
                    description:
                        "The story points for the ticket as a fibonacci number between 1 and 8",
                    scale,
                },
            },
            nitpick: {
                model,
                task:
                    "Fill the template with the provided text, preserving the meaning but improving structure.",
                instructions: [
                    "Markdown output should exactly match the template",
                    "If provided text is missing any information required for a section, add a TODO note to the empty section.",
                ],
                template:
                    "## Summary\n\n## Considerations\n\n## Expected Outcomes",
            },
        },
    };
}
