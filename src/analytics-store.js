import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const ANALYTICS_EVENTS = new Set([
  "digest_requested",
  "digest_viewed",
  "paper_impression",
  "paper_expanded",
  "paper_collapsed",
  "full_report_requested",
  "full_report_viewed",
  "source_link_clicked",
  "paper_vote",
  "chat_started",
  "chat_message_sent",
  "chat_recommendation_requested",
]);

function optionalId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
}

function safePosition(value) {
  return Number.isInteger(value) && value >= 0 && value < 100 ? value : null;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

export class AnalyticsStore {
  constructor(dataDirectory) {
    this.dataDirectory = dataDirectory;
    this.eventsPath = join(dataDirectory, "analytics.ndjson");
    this.feedbackPath = join(dataDirectory, "feedback.json");
    this.events = [];
    this.feedback = new Map();
    this.writeChain = Promise.resolve();
  }

  async init() {
    await mkdir(this.dataDirectory, { recursive: true });
    try {
      const contents = await readFile(this.eventsPath, "utf8");
      this.events = contents.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    try {
      const rows = JSON.parse(await readFile(this.feedbackPath, "utf8"));
      for (const row of rows) this.feedback.set(row.key, row);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  async track(input) {
    if (!ANALYTICS_EVENTS.has(input?.type)) throw new Error("Unsupported analytics event");
    const userId = optionalId(input.userId ?? input.visitorId);
    if (!userId) throw new Error("userId is required");
    const event = {
      id: randomUUID(),
      type: input.type,
      at: new Date().toISOString(),
      userId,
      digestId: optionalId(input.digestId),
      chatId: optionalId(input.chatId),
      reportJobId: optionalId(input.reportJobId),
      arxivId: optionalId(input.arxivId),
      position: safePosition(input.position),
      value: [-1, 0, 1].includes(input.value) ? input.value : null,
    };
    this.events.push(event);
    this.writeChain = this.writeChain.then(() => appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, { mode: 0o600 }));
    await this.writeChain;
    return event;
  }

  async vote({ userId, visitorId, digestId, arxivId, value }) {
    if (![-1, 0, 1].includes(value)) throw new Error("Vote must be -1, 0, or 1");
    const user = optionalId(userId ?? visitorId);
    const digest = optionalId(digestId);
    const paper = optionalId(arxivId);
    if (!user || !digest || !paper) throw new Error("userId, digestId, and arxivId are required");
    const key = `${user}|${digest}|${paper}`;
    if (value === 0) this.feedback.delete(key);
    else this.feedback.set(key, { key, userId: user, digestId: digest, arxivId: paper, value, updatedAt: new Date().toISOString() });
    await this.persistFeedback();
    await this.track({ type: "paper_vote", userId: user, digestId: digest, arxivId: paper, value });
    return this.feedbackSummary(digest, paper, user);
  }

  feedbackSummary(digestId, arxivId, visitorId = null) {
    let up = 0;
    let down = 0;
    let mine = 0;
    for (const row of this.feedback.values()) {
      if (row.digestId !== digestId || row.arxivId !== arxivId) continue;
      if (row.value === 1) up += 1;
      if (row.value === -1) down += 1;
      if (visitorId && (row.userId ?? row.visitorId) === visitorId) mine = row.value;
    }
    return { up, down, mine };
  }

  metrics() {
    const counts = Object.fromEntries([...ANALYTICS_EVENTS].map((type) => [type, 0]));
    const visitors = new Set();
    const userStats = new Map();
    const paperStats = new Map();
    const positionStats = new Map();
    for (const event of this.events) {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
      const eventUserId = event.userId ?? event.visitorId;
      if (eventUserId) {
        visitors.add(eventUserId);
        const user = userStats.get(eventUserId) ?? {
          userId: eventUserId,
          firstSeenAt: event.at,
          lastSeenAt: event.at,
          events: 0,
          digestRequests: 0,
          expansions: 0,
          fullReportOpens: 0,
          sourceClicks: 0,
          votes: 0,
          chatMessages: 0,
          chatRecommendations: 0,
        };
        user.events += 1;
        if (event.at < user.firstSeenAt) user.firstSeenAt = event.at;
        if (event.at > user.lastSeenAt) user.lastSeenAt = event.at;
        if (event.type === "digest_requested") user.digestRequests += 1;
        if (event.type === "paper_expanded") user.expansions += 1;
        if (event.type === "full_report_requested") user.fullReportOpens += 1;
        if (event.type === "source_link_clicked") user.sourceClicks += 1;
        if (event.type === "paper_vote") user.votes += 1;
        if (event.type === "chat_message_sent") user.chatMessages += 1;
        if (event.type === "chat_recommendation_requested") user.chatRecommendations += 1;
        userStats.set(eventUserId, user);
      }
      if (event.position !== null) {
        const position = positionStats.get(event.position) ?? { position: event.position, impressions: 0, expansions: 0 };
        if (event.type === "paper_impression") position.impressions += 1;
        if (event.type === "paper_expanded") position.expansions += 1;
        positionStats.set(event.position, position);
      }
      if (event.arxivId) {
        const paper = paperStats.get(event.arxivId) ?? {
          arxivId: event.arxivId,
          impressions: 0,
          expansions: 0,
          fullReports: 0,
          sourceClicks: 0,
          up: 0,
          down: 0,
        };
        if (event.type === "paper_impression") paper.impressions += 1;
        if (event.type === "paper_expanded") paper.expansions += 1;
        if (event.type === "full_report_requested") paper.fullReports += 1;
        if (event.type === "source_link_clicked") paper.sourceClicks += 1;
        paperStats.set(event.arxivId, paper);
      }
    }
    for (const row of this.feedback.values()) {
      const paper = paperStats.get(row.arxivId) ?? {
        arxivId: row.arxivId, impressions: 0, expansions: 0, fullReports: 0, sourceClicks: 0, up: 0, down: 0,
      };
      if (row.value === 1) paper.up += 1;
      if (row.value === -1) paper.down += 1;
      paperStats.set(row.arxivId, paper);
    }
    const papers = [...paperStats.values()].map((paper) => ({
      ...paper,
      expansionRate: ratio(paper.expansions, paper.impressions),
      fullReportRate: ratio(paper.fullReports, paper.impressions),
    })).sort((a, b) => b.impressions - a.impressions || b.expansions - a.expansions);
    const positions = [...positionStats.values()].map((position) => ({
      ...position,
      expansionRate: ratio(position.expansions, position.impressions),
    })).sort((a, b) => a.position - b.position);
    return {
      generatedAt: new Date().toISOString(),
      totalEvents: this.events.length,
      uniqueVisitors: visitors.size,
      counts,
      funnel: {
        digestViews: counts.digest_viewed,
        paperImpressions: counts.paper_impression,
        paperExpansions: counts.paper_expanded,
        fullReportRequests: counts.full_report_requested,
        expansionRate: ratio(counts.paper_expanded, counts.paper_impression),
        fullReportRate: ratio(counts.full_report_requested, counts.paper_impression),
      },
      papers,
      positions,
      users: [...userStats.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)),
    };
  }

  persistFeedback() {
    this.writeChain = this.writeChain.then(async () => {
      const temporary = `${this.feedbackPath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify([...this.feedback.values()], null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.feedbackPath);
    });
    return this.writeChain;
  }
}
