// Remote MCP servers the server itself talks to (§10.1, §10.2): Figma's official one lives at Figma, not on a
// computer, so it works in every topic even with all computers off. The server's Claude profile holds the
// sign-in (`npm run login -- mcp`); the SDK reports these servers with source "dynamic"
export type RemoteServers = Record<string, string>

export const DEFAULT_REMOTE: RemoteServers = { figma: 'https://mcp.figma.com/mcp' }

// REMOTE_MCP=figma=https://mcp.figma.com/mcp,other=https://…; empty or "none" switches them off
export function parseRemote(s: string | undefined): RemoteServers {
  if (s === undefined) return { ...DEFAULT_REMOTE }
  const out: RemoteServers = {}
  for (const pair of s.split(',').map(x => x.trim()).filter(x => x && x !== 'none')) {
    const i = pair.indexOf('=')
    const name = pair.slice(0, i)
    const url = pair.slice(i + 1)
    if (i > 0 && /^[\w-]{1,40}$/.test(name) && /^https:\/\//.test(url)) out[name] = url
  }
  return out
}

export const remotePrefix = (name: string) => `mcp__${name}__`

// A tool of one of our remote servers, as the SDK reported its origin: trust is keyed on the source
// and the registered name, never on the tool name alone
export function isRemoteTool(tool: string, server: { name: string, source?: string } | undefined, remote: RemoteServers) {
  return !!server && server.source === 'dynamic' && server.name in remote && tool.startsWith(remotePrefix(server.name))
}
