import { Plugin } from '@opencode/plugin/tui'

export default Plugin.define({
  id: 'swarmagent.session-restore',
  setup(context) {
    const token = process.env.SWARM_AGENT_SESSION
    const endpoint = process.env.SWARM_AGENT_MCP_URL
    if (!token || !endpoint || !/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(endpoint)) return
    let last
    context.ui.slot({
      append: 'session.composer.top',
      render: (props) => {
        const sessionId = props.sessionID
        if (sessionId && sessionId !== last) {
          last = sessionId
          const location = context.location ?? context.data.location.default()
          void fetch(new URL('/conversation', endpoint), {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: 'opencode', sessionId, cwd: location?.directory })
          }).catch(() => {})
        }
        return null
      }
    })
  }
})
