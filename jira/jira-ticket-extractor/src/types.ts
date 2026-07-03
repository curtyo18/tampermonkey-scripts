export type JiraFlavor = 'cloud' | 'server';

export interface TicketLink {
  type: string;    // "blocks", "is blocked by", "relates to", "parent", "subtask"
  key: string;     // "PROJ-42"
  summary: string;
}

export interface Ticket {
  key: string;
  url: string;
  summary: string;
  type: string;
  status: string;
  priority: string | null;
  assignee: string | null;
  reporter: string | null;
  labels: string[];
  components: string[];
  description: string;               // Markdown
  acceptanceCriteria: string | null; // Markdown, null if none
  links: TicketLink[];
  attachments: string[];             // filenames
  source: 'api' | 'dom';
}

// Minimal Atlassian Document Format node shape.
export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfNode {
  type: string;
  text?: string;
  marks?: AdfMark[];
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

// Shape of the subset of GET /rest/api/{v}/issue/{key}?expand=names,renderedFields
// that we consume. Fields we don't map are ignored.
export interface RawIssue {
  key: string;
  fields: Record<string, unknown> & {
    summary?: string;
    description?: AdfNode | string | null;
    issuetype?: { name?: string };
    status?: { name?: string };
    priority?: { name?: string } | null;
    assignee?: { displayName?: string } | null;
    reporter?: { displayName?: string } | null;
    labels?: string[];
    components?: { name?: string }[];
    issuelinks?: RawIssueLink[];
    subtasks?: { key?: string; fields?: { summary?: string } }[];
    parent?: { key?: string; fields?: { summary?: string } };
    attachment?: { filename?: string }[];
  };
  renderedFields?: Record<string, string | null>;
  names?: Record<string, string>; // fieldId -> human label
}

export interface RawIssueLink {
  type?: { inward?: string; outward?: string };
  inwardIssue?: { key?: string; fields?: { summary?: string } };
  outwardIssue?: { key?: string; fields?: { summary?: string } };
}
