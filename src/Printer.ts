import { Console } from "./Console.ts";
import { Json } from "./System.ts";

export interface Printer<T> {
    format(value: T): string;
    list(value: T[]): string;
}

export type PrinterOptions = { format?: string; details?: boolean };

export function DefaultPrinter<T>(
    options: PrinterOptions,
): Printer<T> {
    const console = Console();
    function toJson(value: T): Json {
        return JSON.parse(JSON.stringify(value));
    }
    function summary(value: T): Json {
        return toJson(value);
    }
    function detail(value: T): Json {
        return toJson(value);
    }
    return {
        format(value) {
            return console.serialize(toJson(value), options.format);
        },
        list(values) {
            if (options.details) {
                const data = values.map(detail);
                return console.serialize(data, options.format);
            }
            const data = values.map(summary);
            return console.serialize(data, options.format);
        },
    };
}
