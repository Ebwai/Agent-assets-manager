export function issueIncluded(issue) {
  return !!issue.completedAt && (issue.versions || []).some(version => version.completedAt === issue.completedAt);
}

export function appendIssueText(message, text) {
  return `${message}${message && !message.endsWith('\n') ? '\n\n' : ''}${text}`;
}
