// Build-time override. Development builds have no updater signing key.
const pubkey = process.env.SWARM_AGENT_UPDATER_PUBLIC_KEY?.trim()
if (!pubkey) {
  console.error('Set SWARM_AGENT_UPDATER_PUBLIC_KEY to the SwarmAgent updater public key.')
  process.exit(1)
}

process.stdout.write(JSON.stringify({
  bundle: { createUpdaterArtifacts: true },
  plugins: {
    updater: {
      pubkey,
      endpoints: ['https://github.com/ThanhMiLa/swarm-agent/releases/latest/download/latest.json']
    }
  }
}))
