import * as Yaml from "jsr:@std/yaml";

import { ConfigParam } from "./Config.ts";

export function Console() {
    return { ...console, print, mask, pitch, expect, die, ask };
}

function print(obj: any, format: string = "yaml"): void {
    const json = JSON.stringify(obj);
    if (format === "json") return console.log(json);
    const data = JSON.parse(json);
    return console.log(Yaml.stringify(data));
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
