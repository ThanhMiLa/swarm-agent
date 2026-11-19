import logo from '@/assets/swarm-agent.svg'

export function Logo({ className }: { className?: string }) {
  return <img src={logo} alt="" draggable={false} className={className} />
}
