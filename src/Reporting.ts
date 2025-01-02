import Jira2Md from "npm:jira2md";

import { Issue, IssueService, IssueStore } from "./Issue.ts";
import { Review, ReviewStore } from "./Review.ts";
import { Estimate, EstimateStore } from "./Estimate.ts";
import { Store } from "./Store.ts";
import { AssistantService } from "./Assistant.ts";
import { Ollama } from "npm:ollama";
import { SettingsV1 } from "./Settings.ts";

export type IssueReport = {
    issue: Issue;
    review: Review;
    estimate: NormalizedEstimate;
};

export type NormalizedEstimate = Estimate & { normalizedConfidence: number };

export function IssueReportStore(storage: Deno.Kv) {
    return Store<IssueReport>(
        ["issue-reports"],
        storage,
        function summarize(report) {
            const { issue, review, estimate } = report;
            return {
                issue: IssueStore(storage).summarize(issue),
                review: ReviewStore(storage).summarize(review),
                estimate: EstimateStore(storage).summarize(estimate),
            };
        },
    );
}

export function ReportingService(storage: Deno.Kv, settings: SettingsV1) {
    const reviewStore = ReviewStore(storage);
    const estimateStore = EstimateStore(storage);
    const issueService = IssueService(storage);
    const ollama = new Ollama(settings.ollama);
    const assistant = AssistantService(ollama, storage, settings);

    return { collect, format, publish };

    async function collect(
        issue_: Issue,
        options: { force?: boolean; model?: string } = {},
    ): Promise<IssueReport> {
        try {
            const issue = await issueService.pullIssue(issue_.key);
            const review = options.force
                ? await assistant.review(issue, options)
                : await reviewStore
                    .get(issue.key)
                    .catch(async () => await assistant.review(issue, options));
            const estimate = options.force
                ? await assistant.estimate(issue, options)
                : await estimateStore
                    .get(issue.key)
                    .catch(async () =>
                        await assistant.estimate(issue, options)
                    );
            const report = {
                issue,
                review,
                estimate: normalizeEstimate(estimate, review),
            };

            return await IssueReportStore(storage).put(issue.key, report);
        } catch (error) {
            console.error(error);
            console.log({ issue_ });
            throw error;
        }
    }

    async function publish(report: IssueReport) {
        const text = await format(report, { format: "jira" });
        return await issueService.upsertComment(report.issue, text);
    }

    async function format(report: IssueReport, options: { format: string }) {
        const markdown = fmtReportMarkdown(report);
        if (options.format === "markdown") return markdown;
        return await Jira2Md.to_jira(markdown);
    }

    function normalizeEstimate(estimate: Estimate, review: Review) {
        const normalizedConfidence = Math.round(
            estimate.confidence * review.score,
        );
        return { ...estimate, normalizedConfidence };
    }
}

function fmtReportMarkdown(report: IssueReport) {
    const { review, estimate } = report;
    const score = `${Math.round(review.score * 100)}%`;
    const checklist = review.checklist.map(
        function fmtChecklistEntry({ entry, value }) {
            if (value) return `{color:green}**✓**{color} ${entry.description}`;
            return `{color:red}**✗**{color} ${entry.description}`;
        },
    );

    return `

#### ${report.issue.key}

- ${checklist.join("\n- ")}

\`\`\`markdown
Refinement Score: ${score}
Estimated Story Points: ${estimate.storyPoints}
Confidence (Base / Normalized): ${estimate.confidence}% / ${estimate.normalizedConfidence}%
Models: ${review.model} / ${estimate.model}
\`\`\`

*Generated with {color:red}♥{color} by [KAREN](https://github.com/specialblend/karen)*
`;
}
