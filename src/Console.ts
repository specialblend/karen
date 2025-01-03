import * as Yaml from "jsr:@std/yaml";
import * as Diff from "npm:diff";
import * as Fmt from "jsr:@std/fmt/colors";

import { ConfigParam } from "./Config.ts";

export function Console() {
    return {
        ...console,
        ...{ serialize, print, mask, diff },
        ...{ trap, pitch, expect, die, ask },
    };
}

function serialize(obj: any, format: string = "yaml") {
    const json = JSON.stringify(obj);
    if (format === "json") return json;
    const data = JSON.parse(json);
    return Yaml.stringify(data);
}

function print(obj: any, format: string = "yaml"): void {
    console.log(serialize(obj, format));
}

function mask(param: ConfigParam, value: string) {
    if (param.secret) return "<hidden>";
    return value;
}

function pitch(msg: string) {
    return () => {
        throw new Error(msg);
    };
}

function expect(msg: string) {
    return () => die(msg);
}

function die(msg: string): never {
    console.error(msg);
    Deno.exit(1);
}

function ask(param: ConfigParam, currentValue?: string | null) {
    const msg = `${param.key} (${param.name}):`;
    if (param.secret) return prompt(msg) ?? currentValue;
    return prompt(msg, currentValue || param.defaultValue);
}

async function trap<T>(fn: () => Promise<T> | T): Promise<T> {
    return await fn();
}

export function diff(
    filename: string,
    original: string,
    updated: string,
): string | null {
    if (original === updated) return null;
    const patch = Diff.createPatch(filename, original, updated);
    function fmtLine(line: string) {
        if (line.startsWith("+")) return Fmt.green(line);
        if (line.startsWith("-")) return Fmt.red(line);
        return line;
    }
    return patch.split("\n").map(fmtLine).join("\n");
}
