// Post-sign-up onboarding answers. Option ids for helpdesks and tools are the
// Connections catalog ids, so answers map straight to a connection.
export const ROLES = [
    'support',
    'lead',
    'developer',
    'founder',
    'success',
    'other',
];
export const MODES = ['solo', 'team', 'invited'];
export const TEAM_SIZES = ['1', '2-5', '6-20', '21-50', '51+'];
export const HELPDESKS = [
    'zendesk',
    'intercom',
    'front',
    'helpscout',
    'freshdesk',
    'hubspot-service',
    'jsm',
    'plain',
    'pylon',
    'salesforce-service',
    'zoho-desk',
    'other',
    'none',
];
export const TOOLS = [
    'stripe',
    'chargebee',
    'newrelic',
    'sentry',
    'datadog',
    'linear',
    'jira',
    'github-issues',
    'notion',
    'confluence',
    'google-drive',
    'hubspot',
    'salesforce',
    'attio',
    'slack',
    'teams',
];
export const PAINS = ['context', 'bounce', 'before', 'fix', 'sla'];
export const SOURCES = [
    'search',
    'ai',
    'x',
    'linkedin',
    'reddit',
    'hacker-news',
    'video',
    'friend',
    'blog',
    'other',
];
const fail = () => {
    throw Error('Check the onboarding answers.');
};
const one = (list, value) => list.includes(value) ? value : fail();
const some = (list, value, max) => {
    if (!Array.isArray(value) || value.length > max)
        fail();
    const items = value.map((item) => one(list, item));
    return new Set(items).size === items.length ? items : fail();
};
const note = (value, limit) => {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'string' || /[\0\r\n]/.test(value))
        fail();
    const text = value.trim();
    return text.length > limit ? fail() : text || undefined;
};
// Pure structural validation shared by desktop and API; callers enforce access.
export function parseOnboarding(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail();
    const v = value;
    const mode = one(MODES, v.mode);
    const answers = {
        role: one(ROLES, v.role),
        mode,
        helpdesk: one(HELPDESKS, v.helpdesk),
        tools: some(TOOLS, v.tools ?? [], TOOLS.length),
        pains: some(PAINS, v.pains ?? [], 2),
    };
    const roleOther = answers.role === 'other' ? note(v.roleOther, 80) : undefined;
    const helpdeskOther = answers.helpdesk === 'other' ? note(v.helpdeskOther, 80) : undefined;
    const sourceDetail = note(v.sourceDetail, 200);
    if (roleOther)
        answers.roleOther = roleOther;
    if (mode === 'team' && v.teamSize !== undefined)
        answers.teamSize = one(TEAM_SIZES, v.teamSize);
    if (helpdeskOther)
        answers.helpdeskOther = helpdeskOther;
    if (v.source !== undefined)
        answers.source = one(SOURCES, v.source);
    if (sourceDetail)
        answers.sourceDetail = sourceDetail;
    return answers;
}
