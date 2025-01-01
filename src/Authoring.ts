// @deno-types="npm:@types/diff"
import * as Diff from "npm:diff";
import * as Fmt from "jsr:@std/fmt/colors";
import * as Yaml from "jsr:@std/yaml";
import Jira2Md from "npm:jira2md";
import { assert } from "jsr:@std/assert";

import { Issue, IssueMeta } from "./Issue.ts";
import { SettingsV1 } from "./Settings.ts";
import { Console } from "./Console.ts";

const console = Console();

export type Edit = {
    meta: Pick<IssueMeta, "key" | "summary">;
    description: string;
};

export function AuthoringService(settings: SettingsV1) {
    return { hash, serialize, deserialize, checksum, diff };
    async function checksum(issue: Issue) {
        const { model } = settings.assistant.estimate;
        const issueHash = await hash(serialize(issue));
        return await hash([model, issueHash].join(":"));
    }
}

function serialize(issue: Issue) {
    const { id, key, self } = issue;
    const { summary, description, created, updated, creator } = issue.fields;
    const meta: IssueMeta = {
        ...{ id, key, summary },
        ...{ self, created, updated, creator },
    };
    const header = Yaml.stringify(meta);
    const body = Jira2Md.to_markdown(description || "");
    return `---\n${header}---${body}`;
}

async function deserialize(text: string): Promise<Edit> {
    const parseYaml = async (text: string) => await Yaml.parse(text) as JSON;
    async function parseHeader(text: string) {
        const meta = await parseYaml(text)
            .catch(console.pitch("header is not valid YAML"));
        assert(typeof meta === "object", "header is not a YAML object");
        assert("id" in meta, "header missing id");
        assert("key" in meta, "header missing key");
        assert("summary" in meta, "header missing summary");
        assert(typeof meta.id === "string", "header missing id");
        assert(typeof meta.key === "string", "header missing key");
        assert(typeof meta.summary === "string", "header missing summary");
        const { id, key, summary } = meta;
        return { id, key, summary };
    }
    const [, header, body] = text.split("---");
    const meta = await parseHeader(header);
    const description = Jira2Md.to_jira(body);
    return { meta, description };
}

async function hash(text: string) {
    const data = new TextEncoder().encode(text);
    return await crypto
        .subtle
        .digest("SHA-512", data)
        .then((hash) => new Uint8Array(hash))
        .then((hash) => Array.from(hash))
        .then((hash) =>
            hash.map((b) => b.toString(16).padStart(2, "0")).join("")
        );
}

function diff(issue: Issue, edited: Issue) {
    const original = serialize(issue);
    const updated = serialize(edited);
    const filename = `${issue.key}.md`;
    const patch = Diff.createPatch(filename, original, updated);
    function fmtLine(line: string) {
        if (line.startsWith("+")) return Fmt.green(line);
        if (line.startsWith("-")) return Fmt.red(line);
        return line;
    }
    return patch.split("\n").map(fmtLine).join("\n");
}
