import * as Yaml from "jsr:@std/yaml";
import * as Fmt from "jsr:@std/fmt/colors";

import { ConfigParam } from "./Config.ts";

export function Console() {
    return { ...console, print, mask, pitch, expect, die, ask };
}

function print(obj: any, format: string = "yaml"): void {
    if (format === "json") return console.log(JSON.stringify(obj, null, 2));
    return console.log(Yaml.stringify(obj));
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
