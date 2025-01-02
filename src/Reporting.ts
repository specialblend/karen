import Jira2Md from "npm:jira2md";
import { Ollama } from "npm:ollama";
import {
  Issue,
  IssueService,
  IssueStore,
  Project,
  ProjectStore,
} from "./Issue.ts";
import {
  ChecklistEntry,
  ChecklistResult,
  Review,
  ReviewStore,
} from "./Review.ts";
import { Estimate, EstimateStore } from "./Estimate.ts";
import { Store } from "./Store.ts";
import { AssistantService } from "./Assistant.ts";
import { SettingsV1 } from "./Settings.ts";
import { Console } from "./Console.ts";

export type IssueReport = {
  issue: Issue;
  review: Review;
  estimate: NormalizedEstimate;
};

export type ProjectReport = {
  project: Project;
  issues: IssueReport[];
};

export type NormalizedEstimate = Estimate & { normalizedConfidence: number };

const console = Console();

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

function fmtChecklistResult({ entry, value }: ChecklistResult) {
  if (value) return `{color:green}**✓**{color} ${entry.description}`;
  return `{color:red}**✗**{color} ${entry.description}`;
}

function fmtChecklist(
  checklist: ChecklistResult[],
  options = { indent: 0, bullet: "-" },
) {
  const padding = " ".repeat(options.indent);
  return padding + options.bullet + " " +
    checklist.map(fmtChecklistResult).join(
      "\n" + padding + options.bullet + " ",
    );
}

function fmtSignature() {
  return `*Generated with {color:purple}♥{color} by [KAREN](https://github.com/specialblend/karen)*`;
}

function fmtIssueReportDetails(report: IssueReport) {
  const { review, estimate } = report;
  const score = `${Math.round(review.score * 100)}%`;
  return `
  \`\`\`markdown
  Refinement Score: ${score}
  Estimated Story Points: ${estimate.storyPoints}
  Confidence (Base / Normalized): ${estimate.confidence}% / ${estimate.normalizedConfidence}%
  Models: ${review.model} / ${estimate.model}
  \`\`\`
`;
}

function fmtIssueHeader(report: IssueReport) {
  return `#### ${report.issue.key}`;
}

type FmtIssueReportOptions = {
  fmtIssueHeader: (report: IssueReport) => string;
  signature: string;
  indent: number;
  bullet: string;
};

function IssueReportOptions(
  options: Partial<FmtIssueReportOptions> = {},
): FmtIssueReportOptions {
  return {
    fmtIssueHeader,
    signature: SIGNATURE,
    indent: 0,
    bullet: "-",
    ...options,
  };
}

const SIGNATURE =
  "*Generated with {color:purple}♥{color} by [KAREN](https://github.com/specialblend/karen)*";

function fmtIssueReportMarkdown(
  report: IssueReport,
  options = IssueReportOptions(),
) {
  const { review } = report;
  const header = options.fmtIssueHeader(report);
  const checklist = fmtChecklist(review.checklist, options);
  const signature = options.signature ? fmtSignature() : "";
  const details = fmtIssueReportDetails(report);
  return [header, checklist, details, signature].join("\n\n");
}

export function IssueReportingService(storage: Deno.Kv, settings: SettingsV1) {
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
          .catch(async () => await assistant.estimate(issue, options));
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
    const markdown = fmtIssueReportMarkdown(report);
    if (options.format === "markdown") return markdown;
    return await Jira2Md.to_jira(markdown);
  }

  function normalizeEstimate(
    estimate: Estimate,
    review: Review,
  ): NormalizedEstimate {
    const normalizedConfidence = Math.round(
      estimate.confidence * review.score,
    );
    return { ...estimate, normalizedConfidence };
  }
}

export function ProjectReportStore(storage: Deno.Kv) {
  return Store<ProjectReport>(
    ["project-reports"],
    storage,
    function summarize(report) {
      const issueStore = IssueStore(storage);
      const { project, issues } = report;
      return {
        project: ProjectStore(storage).summarize(project),
        issues: issues.map((issue) => issueStore.summarize(issue.issue)),
      };
    },
  );
}

export function fmtProjectReportMarkdown(report: ProjectReport) {
  const { project, issues } = report;

  const issueReports = issues.map((r) =>
    fmtIssueReportMarkdown(r, IssueReportOptions({ indent: 2, signature: "" }))
  );

  return `
#### ${project.key} ${project.name}

Backlog sorted by refinement score:

${issueReports.join("\n")}
`;
}

export function ProjectReportingService(storage: Deno.Kv) {
  const issueStore = IssueStore(storage);
  const issueReportStore = IssueReportStore(storage);
  const projectReportStore = ProjectReportStore(storage);

  return { collect, format };

  async function collect(project: Project): Promise<ProjectReport> {
    const issueReports = [];
    for await (const report of issueReportStore.list()) {
      const issue = await issueStore
        .get(report.issue.key)
        .catch(console.expect("Issue not found"));
      if (issue.fields.project.key === project.key) issueReports.push(report);
    }
    const issues = issueReports.sort((a, b) => a.review.score - b.review.score);
    const report = { project, issues };
    // return await projectReportStore.put(project.key, report);
    return report;
  }

  async function format(report: ProjectReport, options: { format: string }) {
    const markdown = fmtProjectReportMarkdown(report);
    if (options.format === "markdown") return markdown;
    return await Jira2Md.to_jira(markdown);
  }
}
