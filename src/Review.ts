import { Issue } from "./Issue.ts";
import { Store } from "./Store.ts";

export type Review = {
    issueKey: string;
    model: string;
    score: number;
    checklist: ChecklistResult[];
    checksum: string;
    issue: Issue;
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
    return Store<Review>(
        ["reviews"],
        storage,
        function summarize(review: Review) {
            const { issueKey, score, issue: { fields: { summary } } } = review;
            return { issueKey, score, issue: { fields: { summary } } };
        },
    );
}
